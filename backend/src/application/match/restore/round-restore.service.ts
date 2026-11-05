// src/application/match/restore/round-restore.service.ts
import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';
import {
  RoundRestoreCandidate,
  RestoreProposal,
} from './round-restore.types';

const RESTORE_PROPOSAL_TTL_SEC = 60; // 60s TTL dans Redis
const PROPOSAL_WINDOW_MS = 45_000;   // 45s de fenêtre pour répondre
const RESUME_DELAY_MS = 5_000;       // 5s de sécurité avant reprise

@Injectable()
export class RoundRestoreService implements OnModuleDestroy {
  private readonly logger = new Logger(RoundRestoreService.name);
  private readonly unpauseTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly state: MatchStateService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly cmds: MatchCommandsService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  onModuleDestroy() {
    for (const timer of this.unpauseTimers.values()) {
      clearTimeout(timer);
    }
    this.unpauseTimers.clear();
  }

  hasPendingUnpause(matchId: string): boolean {
    return this.unpauseTimers.has(matchId);
  }

  clearUnpauseTimer(matchId: string): boolean {
    const timer = this.unpauseTimers.get(matchId);
    if (timer) {
      clearTimeout(timer);
      this.unpauseTimers.delete(matchId);
      return true;
    }
    return false;
  }

  private proposalKey(matchId: string): string {
    return `match:${matchId}:restore_proposal`;
  }

  /**
   * Retourne les checkpoints disponibles (round en cours + jusqu'à 4 rounds précédents)
   * avec les scores et la possibilité de restore direct.
   */
  async getRestoreCandidates(matchId: string): Promise<RoundRestoreCandidate[]> {
    const snapshot = await this.state.getSnapshot(matchId);
    const currentRound = snapshot?.score?.round ?? 0;
    if (currentRound < 1) {
      return [];
    }

    const sides = snapshot?.sides ?? { home: 'CT', away: 'T' };
    const candidates: RoundRestoreCandidate[] = [];

    // Limiter aux 5 rounds les plus récents (round en cours + 4 précédents)
    const minRound = Math.max(1, currentRound - 4);
    for (let r = currentRound; r >= minRound; r--) {
      const backupFile = `backup_round${String(r - 1).padStart(2, '0')}.txt`;
      const isCurrent = r === currentRound;
      const canDirectRestore = r >= currentRound - 2;

      // Estimations de scores (actuel ou calculé)
      const scoreCt = snapshot?.score?.ct ?? 0;
      const scoreT = snapshot?.score?.t ?? 0;
      const scoreHome = sides?.home === 'CT' ? scoreCt : scoreT;
      const scoreAway = sides?.away === 'CT' ? scoreCt : scoreT;

      candidates.push({
        round: r,
        backupFile,
        scoreHome,
        scoreAway,
        scoreCt,
        scoreT,
        isCurrent,
        canDirectRestore,
      });
    }

    return candidates;
  }

  /**
   * Récupère la proposition active s'il y en a une (non expirée).
   */
  async getProposal(matchId: string): Promise<RestoreProposal | null> {
    const raw = await this.redis.get(this.proposalKey(matchId));
    if (!raw) return null;

    try {
      const proposal = JSON.parse(raw) as RestoreProposal;
      if (Date.now() > proposal.expiresAt) {
        await this.redis.del(this.proposalKey(matchId));
        return null;
      }
      return proposal;
    } catch {
      return null;
    }
  }

  /**
   * Initie une proposition de restauration de round par une équipe.
   */
  async proposeRestore(
    matchId: string,
    targetRound: number,
    by: { team: 'home' | 'away'; steamId?: string; name: string },
  ): Promise<RestoreProposal> {
    const serverId = await this.state.getServerIdFromMatchId(matchId);
    if (!serverId) {
      throw new NotFoundException(`Aucun serveur lié au match ${matchId}`);
    }

    const snapshot = await this.state.getSnapshot(matchId);
    const currentRound = snapshot?.score?.round ?? 0;

    if (!Number.isInteger(targetRound) || targetRound < 1 || targetRound > currentRound) {
      throw new BadRequestException(
        `Numéro de round invalide (${targetRound}). Doit être compris entre 1 et ${currentRound}.`,
      );
    }

    this.clearUnpauseTimer(matchId);

    // Vérifier si une proposition est déjà en cours
    const existing = await this.getProposal(matchId);
    if (existing) {
      throw new BadRequestException('Une proposition de restauration est déjà en cours pour ce match');
    }

    const requiresAdmin = targetRound < currentRound - 2;
    const backupFile = `backup_round${String(targetRound - 1).padStart(2, '0')}.txt`;
    const now = Date.now();

    const proposal: RestoreProposal = {
      matchId,
      serverId,
      targetRound,
      backupFile,
      proposingTeam: by.team,
      proposingPlayer: { name: by.name, steamId: by.steamId },
      proposedAt: now,
      expiresAt: now + PROPOSAL_WINDOW_MS,
      requiresAdmin,
      opponentAgreed: false,
      adminApproved: false,
      status: 'pending',
    };

    // 1) Figer le jeu avec une pause technique pour que tout le monde s'arrête
    await this.cmds.pause({ serverId, matchId });

    // 2) Sauvegarder dans Redis
    await this.redis.set(this.proposalKey(matchId), JSON.stringify(proposal), 'EX', RESTORE_PROPOSAL_TTL_SEC);

    // 3) Informer in-game
    const teamName = by.team === 'home' ? snapshot?.teams?.home_name || 'Home' : snapshot?.teams?.away_name || 'Away';
    if (!requiresAdmin) {
      await this.cmds.say(
        serverId,
        `[GG-Core] L'équipe ${teamName} propose de rejouer le round ${targetRound}.`,
      );
      await this.cmds.say(
        serverId,
        `[GG-Core] L'autre équipe a 45s pour taper !restore ${targetRound} (ou !cancel pour refuser).`,
      );
    } else {
      await this.cmds.say(
        serverId,
        `[GG-Core] L'équipe ${teamName} demande de rejouer le round ${targetRound} (> 2 rounds).`,
      );
      await this.cmds.say(
        serverId,
        `[GG-Core] Demande transmise aux admins pour arbitrage.`,
      );
    }

    // 4) Émettre l'événement WebSocket pour le site web et l'interface admin
    this.emitter.emitBoth(matchId, 'restore:proposed', proposal);
    this.logger.log(`[RoundRestore] Proposition créée pour le round ${targetRound} par ${by.team} (${by.name})`);

    return proposal;
  }

  /**
   * Valide la proposition de restauration (par l'équipe adverse ou par un admin).
   */
  async confirmRestore(
    matchId: string,
    by: { team?: 'home' | 'away'; steamId?: string; name: string; isAdmin?: boolean },
  ): Promise<RestoreProposal> {
    const proposal = await this.getProposal(matchId);
    if (!proposal) {
      throw new BadRequestException('Aucune proposition de restauration active ou la demande a expiré');
    }

    // Si c'est un joueur qui valide
    if (!by.isAdmin) {
      if (by.team === proposal.proposingTeam) {
        throw new BadRequestException('Vous ne pouvez pas valider votre propre proposition');
      }
      proposal.opponentAgreed = true;
    } else {
      proposal.adminApproved = true;
    }

    // Si la demande nécessite l'accord admin et que seul l'adversaire a validé
    if (proposal.requiresAdmin && !proposal.adminApproved) {
      await this.redis.set(this.proposalKey(matchId), JSON.stringify(proposal), 'EX', RESTORE_PROPOSAL_TTL_SEC);
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Accord des deux équipes reçu pour le round ${proposal.targetRound} ! En attente de validation admin...`,
      );
      this.emitter.emitBoth(matchId, 'restore:proposed', proposal);
      return proposal;
    }

    // Condition remplie : soit restore direct (< N-2) avec accord mutuel, soit admin approuvé
    const file = proposal.backupFile;
    await this.cmds.say(
      proposal.serverId,
      `[GG-Core] Restauration du round ${proposal.targetRound} validée ! Chargement...`,
    );

    // Exécuter la commande native Valve
    await this.cmds.rcon({
      serverId: proposal.serverId,
      matchId,
      command: CS2_RCON_COMMANDS.RESTORE_LOAD(file),
    });

    proposal.status = 'accepted';
    await this.redis.del(this.proposalKey(matchId));

    this.emitter.emitBoth(matchId, 'restore:executed', proposal);
    this.logger.log(`[RoundRestore] Round ${proposal.targetRound} restauré avec succès (${file})`);

    return proposal;
  }

  /**
   * Annule ou refuse la proposition de restauration.
   */
  async cancelRestore(
    matchId: string,
    by: { team?: 'home' | 'away'; steamId?: string; name: string; isAdmin?: boolean; reason?: string },
  ): Promise<boolean> {
    const proposal = await this.getProposal(matchId);
    if (!proposal) {
      return false;
    }

    this.clearUnpauseTimer(matchId);
    await this.redis.del(this.proposalKey(matchId));

    const isRefusal = !by.isAdmin && !!(by.team && by.team !== proposal.proposingTeam);
    proposal.status = isRefusal ? 'refused' : 'cancelled';
    proposal.cancelledBy = {
      team: by.team,
      name: by.name,
      steamId: by.steamId,
      isAdmin: by.isAdmin,
      isRefusal,
      reason: by.reason,
    };

    if (isRefusal) {
      // Notification in-game : refus explicite et rappel de la commande !tech
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Restauration du round ${proposal.targetRound} refusée par l'adversaire (${by.name}).`,
      );
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Reprise dans 5s (tapez !tech si votre problème technique persiste).`,
      );
      // Émission d'alerte spécifique pour les admins et le match
      this.emitter.emitBoth(matchId, 'restore:refused', proposal);
    } else {
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Proposition de restauration du round ${proposal.targetRound} annulée (${by.name}). Reprise dans 5s.`,
      );
    }

    this.emitter.emitBoth(matchId, 'restore:cancelled', proposal);
    this.logger.log(
      `[RoundRestore] Proposition ${isRefusal ? 'refusée' : 'annulée'} pour le match ${matchId} par ${by.name}`,
    );

    // Décompte de sécurité de 5 secondes avant unpause effectif
    const timer = setTimeout(() => {
      void (async () => {
        this.unpauseTimers.delete(matchId);
        try {
          await this.cmds.unpause({ serverId: proposal.serverId, matchId });
          await this.cmds.say(proposal.serverId, '[GG-Core] Match repris !');
        } catch (err: unknown) {
          this.logger.error(`[cancelRestore] Erreur lors du unpause différé match=${matchId}`, err);
        }
      })();
    }, RESUME_DELAY_MS);

    this.unpauseTimers.set(matchId, timer);
    return true;
  }
}
