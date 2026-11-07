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
import { PauseMatchService } from '@app/match/pause/pause.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';
import { PrismaService } from '@adapters/database/prisma.service';
import { EventTypes } from '@domain/events/event.types';
import { roundsFromEvents } from '@app/tournament/game-rounds.service';
import {
  RoundRestoreCandidate,
  RestoreProposal,
} from './round-restore.types';

const RESTORE_PROPOSAL_TTL_SEC = 60; // 60s TTL dans Redis
const PROPOSAL_WINDOW_MS = 45_000;   // 45s de fenêtre pour répondre
const RESUME_DELAY_MS = 5_000;       // 5s de sécurité avant reprise

/**
 * The round being played, or about to start in the freeze time. `score.round` is the last round that started, so
 * during the freeze time between two rounds it still names the round just finished: counting the rounds played
 * (both scores) is right in both cases.
 */
export function currentRoundOf(score: { ct?: number; t?: number; round?: number } | undefined): number {
  if (typeof score?.ct === 'number' && typeof score?.t === 'number') return score.ct + score.t + 1;
  return score?.round ?? 0;
}

@Injectable()
export class RoundRestoreService implements OnModuleDestroy {
  private readonly logger = new Logger(RoundRestoreService.name);
  private readonly unpauseTimers = new Map<string, NodeJS.Timeout>();
  /** One timer per pending proposal: nobody reads Redis when the 45 s run out, so something has to announce it. */
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly state: MatchStateService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly cmds: MatchCommandsService,
    private readonly emitter: RealtimeEmitter,
    private readonly prisma: PrismaService,
    // forwardRef: the pause service and this one import each other somewhere down the line
    @Inject(forwardRef(() => PauseMatchService))
    private readonly pauseSvc: PauseMatchService,
  ) {}

  onModuleDestroy() {
    for (const timer of this.unpauseTimers.values()) {
      clearTimeout(timer);
    }
    this.unpauseTimers.clear();
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
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
    const currentRound = currentRoundOf(snapshot?.score);
    if (currentRound < 1) {
      return [];
    }

    const sides = snapshot?.sides ?? { home: 'CT', away: 'T' };
    const candidates: RoundRestoreCandidate[] = [];

    // A checkpoint is the state at the start of round r, i.e. the score after round r - 1 (0-0 for round 1), read from
    // the rounds already won. Without that history, the current score is the only figure left.
    const rows = await this.prisma.eventPrimary.findMany({
      where: { matchId, type: EventTypes.TEAM_ROUND_WIN },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, payload: true },
    });
    const scoreAfter = new Map(roundsFromEvents(rows).map((r) => [r.number, r]));

    // Limiter aux 5 rounds les plus récents (round en cours + 4 précédents)
    const minRound = Math.max(1, currentRound - 4);
    for (let r = currentRound; r >= minRound; r--) {
      const backupFile = `backup_round${String(r - 1).padStart(2, '0')}.txt`;
      const isCurrent = r === currentRound;
      const canDirectRestore = r >= currentRound - 2;

      // Score at the start of round r. Home / away follow the current sides (exact within the same half).
      const before = r === 1 ? { ct: 0, t: 0 } : scoreAfter.get(r - 1);
      const scoreCt = before?.ct ?? snapshot?.score?.ct ?? 0;
      const scoreT = before?.t ?? snapshot?.score?.t ?? 0;
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
    const currentRound = currentRoundOf(snapshot?.score);

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

    // 1) Freeze the game with a technical pause of GG-Core (the console shows it and offers "Reprendre", !unpause works):
    // started now in the freeze time, armed for the next freeze time when a round is being played.
    const duringRound = ['live', 'bomb_planted', 'end'].includes((await this.pauseSvc.getPhase(matchId)) ?? '');
    await this.pauseSvc.pause(matchId, serverId, {
      reason: 'technical',
      team: 'system',
      armOnly: duringRound,
      customReason: `restauration du round ${targetRound}`,
    });
    if (!duringRound) await this.cmds.pause({ serverId, matchId });

    // 2) Sauvegarder dans Redis
    await this.redis.set(this.proposalKey(matchId), JSON.stringify(proposal), 'EX', RESTORE_PROPOSAL_TTL_SEC);
    this.scheduleExpiry(matchId, proposal);

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
    this.clearExpiryTimer(matchId);
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
    this.clearExpiryTimer(matchId);
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

    const paused = await this.isGamePaused(matchId);
    if (isRefusal) {
      // Notification in-game : refus explicite et rappel de la commande !tech
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Restauration du round ${proposal.targetRound} refusée par l'adversaire (${by.name}).`,
      );
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] ${paused ? 'Reprise dans 5s' : 'Le round continue'} (tapez !tech si votre problème technique persiste).`,
      );
      // Émission d'alerte spécifique pour les admins et le match
      this.emitter.emitBoth(matchId, 'restore:refused', proposal);
    } else {
      await this.cmds.say(
        proposal.serverId,
        `[GG-Core] Proposition de restauration du round ${proposal.targetRound} annulée (${by.name}).${paused ? ' Reprise dans 5s.' : ' Le round continue.'}`,
      );
    }

    this.emitter.emitBoth(matchId, 'restore:cancelled', proposal);
    this.logger.log(
      `[RoundRestore] Proposition ${isRefusal ? 'refusée' : 'annulée'} pour le match ${matchId} par ${by.name}`,
    );

    this.scheduleResume(matchId, proposal.serverId, paused);
    return true;
  }

  /** Safety countdown of 5 seconds before the game is really unpaused. */
  private scheduleResume(matchId: string, serverId: string, announce = true): void {
    const timer = setTimeout(() => {
      void (async () => {
        this.unpauseTimers.delete(matchId);
        try {
          // Always done: it also cancels a pause the proposal armed in the middle of a round. Only announced when the
          // game really was paused, otherwise "Match repris !" would be said about a game that never stopped.
          await this.pauseSvc.clearArmed(matchId);
          await this.pauseSvc.resume(matchId);
          await this.cmds.unpause({ serverId, matchId });
          if (announce) await this.cmds.say(serverId, '[GG-Core] Match repris !');
        } catch (err: unknown) {
          this.logger.error(`[RoundRestore] Erreur lors du unpause différé match=${matchId}`, err);
        }
      })();
    }, RESUME_DELAY_MS);

    this.unpauseTimers.set(matchId, timer);
  }

  /**
   * Whether the game is paused right now. A proposal made in the middle of a round only arms its pause, which starts
   * at the next freeze time: the pause service says "paused" only once it really is.
   */
  private isGamePaused(matchId: string): Promise<boolean> {
    return this.pauseSvc.isPaused(matchId);
  }

  private clearExpiryTimer(matchId: string): void {
    const timer = this.expiryTimers.get(matchId);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(matchId);
  }

  private scheduleExpiry(matchId: string, proposal: RestoreProposal): void {
    this.clearExpiryTimer(matchId);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(matchId);
      void this.expireIfPending(matchId, proposal.proposedAt).catch((err: unknown) =>
        this.logger.error(`[RoundRestore] Erreur à l'expiration de la proposition match=${matchId}`, err),
      );
    }, PROPOSAL_WINDOW_MS);
    this.expiryTimers.set(matchId, timer);
  }

  /**
   * The 45 s are over. If this very proposal is still waiting (not accepted, not cancelled, not replaced by a newer one),
   * say it out loud and resume the game, which the proposal had paused.
   */
  private async expireIfPending(matchId: string, proposedAt: number): Promise<void> {
    const raw = await this.redis.get(this.proposalKey(matchId));
    if (!raw) return;
    let proposal: RestoreProposal;
    try {
      proposal = JSON.parse(raw) as RestoreProposal;
    } catch {
      return;
    }
    if (proposal.proposedAt !== proposedAt || proposal.status !== 'pending') return;

    await this.redis.del(this.proposalKey(matchId));
    proposal.status = 'expired';
    const paused = await this.isGamePaused(matchId);
    await this.cmds.say(
      proposal.serverId,
      `[GG-Core] Proposition de restauration du round ${proposal.targetRound} expirée (pas de réponse à temps).${paused ? ' Reprise dans 5s.' : ' Le round continue.'}`,
    );
    this.emitter.emitBoth(matchId, 'restore:cancelled', proposal);
    this.logger.log(`[RoundRestore] Proposition expirée pour le round ${proposal.targetRound} (match ${matchId})`);
    this.scheduleResume(matchId, proposal.serverId, paused);
  }
}
