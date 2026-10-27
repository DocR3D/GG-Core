// src/application/match/sandbox/sandbox.service.ts
import { Injectable, Logger, Inject, BadRequestException, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import * as path from 'path';
import * as fs from 'fs';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst, REDIS_CHANNELS } from '../state/redis.keys';
import { MatchStateService } from '../state/match-state.service';
import { SidesScoreService, type CoreSide, type Logical } from '../state/sides-score.service';
import { SnapshotQuery } from '../state/snapshot.query';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { EventsRouterSubscriber } from '@app/subscribers/events-router.consumer';
import { MatchPhase, Phase, RoundPhase } from '@domain/phase.types';
import { MatchSettings } from '@domain/match-settings.types';
import { CS2_CFG, CS2_RULES, CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';
import { GameSide, normalizeSide } from '@domain/side.types';
import { RoundBackupService, ValveBackupOptions, ValveBackupPlayer } from '../backup/round-backup.service';
import {
  InjectStateDto,
  InGameRestoreDto,
  ReplayRawLogDto,
  ReplayScenarioDto,
  AvailableFixture,
} from './sandbox.dto';

export type { InjectStateDto, InGameRestoreDto, ReplayRawLogDto, ReplayScenarioDto, AvailableFixture };

export interface SandboxPreset {
  id: string;
  name: string;
  description: string;
  phase: MatchPhase;
  round: number;
  score: { ct: number; t: number; home?: number; away?: number };
  sides: { home: 'CT' | 'T'; away: 'CT' | 'T' };
  halftimePlayed: boolean;
  overtimeCount: number;
  lastScoredRound?: number;
  suggestedTest: string;
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly state: MatchStateService,
    private readonly sidesScore: SidesScoreService,
    private readonly snapshotQ: SnapshotQuery,
    private readonly cmds: MatchCommandsService,
    private readonly ws: WsBroadcaster,
    private readonly backupService: RoundBackupService,
    @Optional() private readonly eventsRouter?: EventsRouterSubscriber,
  ) {}

  /**
   * Retourne la liste des presets de test prêts à l'emploi
   */
  getPresets(): SandboxPreset[] {
    return [
      {
        id: 'halftime_pivot',
        name: 'Halftime Pivot (6 - 5)',
        description: 'Fin de 1ère mi-temps (round 11). Teste le swap automatique et la pause/warmup de mi-temps.',
        phase: MatchPhase.LIVE_MAIN,
        round: 11,
        score: { ct: 6, t: 5, home: 6, away: 5 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: false,
        overtimeCount: 0,
        lastScoredRound: 11,
        suggestedTest: 'Simuler une victoire CT ou T pour atteindre le round 12 et vérifier le switch de sides.',
      },
      {
        id: 'regulation_climax',
        name: 'Balle de Match (12 - 11)',
        description: 'Balle de match regulation (round 23). Teste l\'égalisation à 12-12 (Overtime) ou la victoire 13-11.',
        phase: MatchPhase.LIVE_MAIN,
        round: 23,
        score: { ct: 12, t: 11, home: 12, away: 11 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: true,
        overtimeCount: 0,
        lastScoredRound: 23,
        suggestedTest: 'Si T gagne -> 12-12 (Déclenche l\'Overtime). Si CT gagne -> 13-11 (Victoire CT / postgame).',
      },
      {
        id: 'overtime_mr3_start',
        name: 'Overtime MR3 (12 - 12)',
        description: 'Début des prolongations MR3. Score 12-12, OT #1.',
        phase: MatchPhase.OVERTIME,
        round: 24,
        score: { ct: 12, t: 12, home: 12, away: 12 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: true,
        overtimeCount: 1,
        lastScoredRound: 24,
        suggestedTest: 'Vérifier la distribution de l\'économie OT ($10,000 / $16,000) et le format MR3.',
      },
      {
        id: 'overtime_match_point',
        name: 'OT Match Point (15 - 14)',
        description: 'Dernier round de l\'overtime #1 (round 29). Victoire 16-14 ou passage en OT #2 à 15-15.',
        phase: MatchPhase.OVERTIME,
        round: 29,
        score: { ct: 15, t: 14, home: 15, away: 14 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: true,
        overtimeCount: 1,
        lastScoredRound: 29,
        suggestedTest: 'Si CT gagne -> 16-14 Victoire finale. Si T gagne -> 15-15 et passage immédiat en Overtime #2.',
      },
      {
        id: 'warmup_knife',
        name: 'Warmup Knife (Ready -> Knife)',
        description: 'Échauffement avant Knife Round. Taper !ready pour les 2 équipes lance le knife round.',
        phase: MatchPhase.KNIFE_WARMUP,
        round: 0,
        score: { ct: 0, t: 0, home: 0, away: 0 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: false,
        overtimeCount: 0,
        lastScoredRound: 0,
        suggestedTest: 'Simuler la commande !ready pour CT et T pour déclencher le knife round.',
      },
      {
        id: 'knife_live',
        name: 'Knife Round (0 - 0)',
        description: 'Round de couteau actif. Permet de tester le vainqueur et les choix !stay / !switch.',
        phase: MatchPhase.KNIFE_LIVE,
        round: 0,
        score: { ct: 0, t: 0, home: 0, away: 0 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: false,
        overtimeCount: 0,
        lastScoredRound: 0,
        suggestedTest: 'Simuler un team_round_win knife pour passer en knife_choice puis tester !stay ou !switch.',
      },
      {
        id: 'warmup_ready',
        name: 'Warmup Ready Check',
        description: 'Échauffement avant match. Permet de tester les commandes !ready des deux capitaines.',
        phase: MatchPhase.WARMUP_MAIN,
        round: 0,
        score: { ct: 0, t: 0, home: 0, away: 0 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: false,
        overtimeCount: 0,
        lastScoredRound: 0,
        suggestedTest: 'Simuler la commande !ready pour Team Home puis Team Away pour voir le compte à rebours se lancer.',
      },
    ];
  }

  /**
   * Injecte directement un état complet dans Redis et diffuse l'événement WebSocket aux clients
   */
  async injectState(dto: InjectStateDto): Promise<any> {
    const mid = dto.matchId.trim();
    if (!mid) throw new BadRequestException('matchId est requis');

    // 0. Réinitialiser les drapeaux ready et verrous de phase pour repartir sur une base saine
    await this.redis.hset(redisConst.ready(mid), { home: '0', away: '0' });
    await this.redis.del(redisConst.phaseLock(mid), redisConst.phasePending(mid));

    // 1. Liaison serveur si fourni
    if (dto.serverId) {
      await this.state.setServerIdToMatchId(dto.serverId, mid);
      await this.redis.set(redisConst.matchServer(mid), dto.serverId);
    }

    // 2. Sides (défaut: home=CT, away=T si non spécifiés et absents de Redis)
    if (dto.sides) {
      await this.state.setSides(mid, dto.sides);
    } else {
      const existingSides = await this.state.getSides(mid);
      if (!existingSides) {
        await this.state.setSides(mid, { home: 'CT', away: 'T' });
      }
    }

    // 3. Teams
    if (dto.teams) {
      await this.state.setTeams(mid, dto.teams);
    }

    // 4. Phase globale & RoundPhase
    if (dto.phase) {
      await this.state.setPhase(mid, dto.phase as Phase);
      if ((dto.phase === MatchPhase.WARMUP_MAIN || dto.phase === MatchPhase.KNIFE_WARMUP) && dto.serverId) {
        await this.cmds.rcon({
          serverId: dto.serverId,
          matchId: mid,
          command: CS2_RCON_COMMANDS.WARMUP_INFINITE(CS2_CFG.WARMUP),
        }).catch((e) => this.logger.warn(`Warmup RCON failed: ${e.message}`));
      } else if (dto.phase === MatchPhase.KNIFE_LIVE && dto.serverId) {
        await this.cmds.rcon({
          serverId: dto.serverId,
          matchId: mid,
          command: CS2_RCON_COMMANDS.KNIFE_START,
        }).catch((e) => this.logger.warn(`Knife RCON failed: ${e.message}`));
      }
    }
    if (dto.roundPhase) {
      await this.redis.set(redisConst.roundPhase(mid), dto.roundPhase);
    }

    // 5. Score
    let computedRound = 0;
    if (dto.score) {
      const ct = dto.score.ct ?? 0;
      const t = dto.score.t ?? 0;
      const sides = dto.sides ?? (await this.state.getSides(mid)) ?? { home: 'CT', away: 'T' };
      const home = dto.score.home ?? (sides.home === 'CT' ? ct : t);
      const away = dto.score.away ?? (sides.away === 'CT' ? ct : t);
      computedRound = dto.score.round !== undefined ? dto.score.round : (ct + t);

      await this.redis.hset(redisConst.score(mid), {
        ct: String(ct),
        t: String(t),
        home: String(home),
        away: String(away),
        round: String(computedRound),
      });
    }

    // 6. Anti-eBug Guards & Overtime (calculés automatiquement depuis le score si non spécifiés)
    const halftimePlayed = dto.halftimePlayed !== undefined
      ? dto.halftimePlayed
      : computedRound > 12;
    await this.state.setHalftimePlayed(mid, halftimePlayed);

    const overtimeCount = dto.overtimeCount !== undefined
      ? dto.overtimeCount
      : (computedRound > 24 ? Math.max(1, Math.floor((computedRound - 25) / 6) + 1) : 0);
    await this.state.setOvertimeCount(mid, overtimeCount);

    const lastScoredRound = dto.lastScoredRound !== undefined
      ? dto.lastScoredRound
      : computedRound;
    await this.state.setLastScoredRound(mid, lastScoredRound);

    // 7. Settings
    if (dto.settings) {
      await this.state.setSettings(mid, dto.settings);
    }

    // 8. Roster & Players
    if (dto.players && dto.players.length > 0) {
      for (const p of dto.players) {
        const side = normalizeSide(p.side as GameSide);
        const logical: Logical = (p.teamLogical || (await this.state.sideToLogical(mid, side)) || 'home') as Logical;
        await this.state.upsertPlayer(mid, {
          steamId: p.steamId,
          name: p.name,
          logical,
        });

        if (p.cash !== undefined) {
          await this.state.setPlayerMoney(mid, p.steamId, p.cash);
        }
        if (typeof (this.state as any).setPlayerStats === 'function') {
          await this.state.setPlayerStats(mid, p.steamId, {
            name: p.name,
            kills: 0,
            deaths: 0,
            assists: 0,
            headshots: 0,
            score: 0,
          });
        }
      }
    }

    // 9. Diffusion WebSocket temps réel
    const snapshot = await this.snapshotQ.getSnapshot(mid);
    await this.ws.push(mid, 'match:state', snapshot);
    if (dto.score) {
      await this.ws.push(mid, 'score:update', {
        matchId: mid,
        ...dto.score,
      });
    }

    this.logger.log(`[Sandbox] État injecté avec succès pour match=${mid} (phase=${dto.phase}, score=${JSON.stringify(dto.score)})`);
    return snapshot;
  }

  /**
   * Génère un fichier backup natif Valve VDF (.txt) et l'applique in-game via RCON
   */
  async restoreInGame(dto: InGameRestoreDto): Promise<{
    ok: boolean;
    backupFileName: string;
    filePath: string;
    rconCommand: string;
    vdfSnippet: string;
  }> {
    const serverId = dto.serverId.trim();
    const matchId = dto.matchId.trim();
    if (!serverId || !matchId) {
      throw new BadRequestException('serverId et matchId requis pour restoreInGame');
    }

    // S'assurer de la liaison serveur ↔ match
    await this.state.setServerIdToMatchId(serverId, matchId);
    await this.redis.set(redisConst.matchServer(matchId), serverId);

    const scoreCt = dto.scoreCt !== undefined ? dto.scoreCt : dto.scoreTeam1 ?? 0;
    const scoreT = dto.scoreT !== undefined ? dto.scoreT : dto.scoreTeam2 ?? 0;
    const calculatedRound = scoreCt + scoreT;
    const round = dto.round !== undefined && dto.round >= 0 ? dto.round : calculatedRound;
    const map = dto.map || CS2_RULES.DEFAULT_MAP;

    if (round === 0) {
      if (dto.phase === MatchPhase.KNIFE_LIVE) {
        const knifeCmd = CS2_RCON_COMMANDS.KNIFE_START;
        if (dto.applyViaRcon !== false) {
          if (dto.reloadMap) {
            await this.cmds.rcon({ serverId, matchId, command: CS2_RCON_COMMANDS.CHANGELEVEL(map) });
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          await this.cmds.rcon({ serverId, matchId, command: knifeCmd });
        }
        await this.injectState({
          matchId,
          serverId,
          score: { ct: 0, t: 0, round: 0 },
          lastScoredRound: 0,
          halftimePlayed: false,
          overtimeCount: 0,
          phase: MatchPhase.KNIFE_LIVE,
        });
        this.logger.log(`[Sandbox] Phase Knife Round appliquée avec succès sur ${serverId}`);
        return {
          ok: true,
          backupFileName: 'knife_live (aucun checkpoint requis)',
          filePath: '',
          rconCommand: knifeCmd,
          vdfSnippet: 'Knife round CS2 démarré avec succès (couteaux uniquement)',
        };
      }
      const warmupCmd = CS2_RCON_COMMANDS.WARMUP_SANDBOX(CS2_CFG.WARMUP);
      if (dto.applyViaRcon !== false) {
        if (dto.reloadMap) {
          await this.cmds.rcon({ serverId, matchId, command: CS2_RCON_COMMANDS.CHANGELEVEL(map) });
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        await this.cmds.rcon({ serverId, matchId, command: warmupCmd });
      }
      await this.injectState({
        matchId,
        serverId,
        score: { ct: 0, t: 0, round: 0 },
        lastScoredRound: 0,
        halftimePlayed: false,
        overtimeCount: 0,
        phase: MatchPhase.WARMUP_MAIN,
      });
      this.logger.log(`[Sandbox] Phase Warmup appliquée avec succès sur ${serverId}`);
      return {
        ok: true,
        backupFileName: 'warmup (aucun checkpoint requis)',
        filePath: '',
        rconCommand: warmupCmd,
        vdfSnippet: 'Warmup natif CS2 démarré avec succès',
      };
    }

    // Règle d'inversion des côtés Valve CS2 dans les sauvegardes VDF :
    // - En MR12 (règlement CS2) : rounds 1-12 = Team 1 sur CT, Team 2 sur T
    // - Round 13-24 (2ème mi-temps) : Team 1 est sur T, Team 2 est sur CT (mi-temps jouée !)
    // - Overtime MR3 : alterne toutes les 3 manches
    const isTeam1Ct = this.isTeam1OnCt(round);

    let playersCt = dto.playersCt ?? (isTeam1Ct ? dto.playersTeam1 : dto.playersTeam2) ?? [];
    let playersT = dto.playersT ?? (isTeam1Ct ? dto.playersTeam2 : dto.playersTeam1) ?? [];

    // Calculer le nombre de joueurs en vie pour le VDF (minimum 1 pour éviter que CS2 ne force les joueurs en état mort)
    const playersAliveCT = Math.max(1, playersCt.length);
    const playersAliveT = Math.max(1, playersT.length);

    // Mapper fidèlement vers Team 1 et Team 2 dans le VDF selon la mi-temps
    const vdfScoreTeam1 = isTeam1Ct ? scoreCt : scoreT;
    const vdfScoreTeam2 = isTeam1Ct ? scoreT : scoreCt;
    const vdfPlayersTeam1 = isTeam1Ct ? playersCt : playersT;
    const vdfPlayersTeam2 = isTeam1Ct ? playersT : playersCt;
    const vdfTeam1Name = isTeam1Ct ? (dto.team1Name || 'Equipe CT') : (dto.team2Name || 'Equipe T');
    const vdfTeam2Name = isTeam1Ct ? (dto.team2Name || 'Equipe T') : (dto.team1Name || 'Equipe CT');

    // Nom de fichier de backup (format standard Valve e.g. sandbox_round12.txt)
    const fileName = dto.backupFileName || `sandbox_round${String(round).padStart(2, '0')}.txt`;

    // Détermination du répertoire de destination
    // CS2 recherche les fichiers de backup dans son sous-dossier csgo/
    const backupDir = process.env.CS2_BACKUP_DIR || path.resolve(process.cwd(), 'temp/backups/sandbox');
    const filePath = path.join(backupDir, fileName);

    const vdfContent = this.backupService.generateValveBackup({
      round,
      team1Name: vdfTeam1Name,
      team2Name: vdfTeam2Name,
      map,
      scoreTeam1: vdfScoreTeam1,
      scoreTeam2: vdfScoreTeam2,
      firstHalfScore: dto.firstHalfScore,
      secondHalfScore: dto.secondHalfScore,
      overtimeScore: dto.overtimeScore,
      playersTeam1: vdfPlayersTeam1,
      playersTeam2: vdfPlayersTeam2,
      playersAliveCT,
      playersAliveT,
    });

    await this.backupService.writeBackupFile(filePath, vdfContent);

    const rconCommand = CS2_RCON_COMMANDS.RESTORE_LOAD(fileName);

    if (dto.applyViaRcon !== false) {
      // 0. Si demandé (ex: match précédent en "Game Over" complet), recharger la carte proprement sans déconnecter les joueurs
      if (dto.reloadMap) {
        this.logger.log(`[Sandbox] Rechargement préalable de la carte via changelevel ${map}`);
        await this.cmds.rcon({
          serverId,
          matchId,
          command: CS2_RCON_COMMANDS.CHANGELEVEL(map),
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // 1. Désactiver impérativement l'autopause de Valve, activer les prolongations Valve natives
      // et quitter le warmup
      await this.cmds.rcon({
        serverId,
        matchId,
        command: CS2_RCON_COMMANDS.RESTORE_PREPARE,
      });

      // Attendre 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 2. Charger le backup natif Valve par-dessus le match actif
      await this.cmds.rcon({
        serverId,
        matchId,
        command: rconCommand,
      });

      // Attendre 800ms que le checkpoint soit appliqué par le moteur de jeu
      await new Promise((resolve) => setTimeout(resolve, 800));

      // 3. Déterminer l'équilibrage des bots pour le test 1v1 (ne JAMAIS mettre de bot dans l'équipe du joueur)
      // et unpause pour lancer le round. (NE JAMAIS appeler mp_restartgame 1 qui réinitialiserait le score à 0-0 !)
      let botBalanceCmd: string = CS2_RCON_COMMANDS.UNPAUSE;
      if (playersCt.length > 0 && playersT.length === 0) {
        // Le joueur humain est en CT -> aucun bot en CT, 1 bot en T
        botBalanceCmd = CS2_RCON_COMMANDS.BOT_BALANCE_CT;
      } else if (playersT.length > 0 && playersCt.length === 0) {
        // Le joueur humain est en T -> aucun bot en T, 1 bot en CT
        botBalanceCmd = CS2_RCON_COMMANDS.BOT_BALANCE_T;
      }

      await this.cmds.rcon({
        serverId,
        matchId,
        command: botBalanceCmd,
      });
      this.logger.log(`[Sandbox] Séquence RCON exécutée (${serverId}): autopause 0 -> [500ms] -> ${rconCommand} -> [800ms] -> ${botBalanceCmd}`);
    }

    // Également injecter l'état dans Redis pour cohérence immédiate du scoreboard backend
    await this.injectState({
      matchId,
      serverId,
      score: {
        ct: scoreCt,
        t: scoreT,
        round,
      },
      lastScoredRound: round,
      halftimePlayed: round > 12,
      overtimeCount: round > 24 ? Math.max(1, Math.floor((round - 25) / 6) + 1) : 0,
      phase: round > 24 ? MatchPhase.OVERTIME : (dto.phase || MatchPhase.LIVE_MAIN),
    });

    return {
      ok: true,
      backupFileName: fileName,
      filePath,
      rconCommand,
      vdfSnippet: vdfContent.slice(0, 300) + '...',
    };
  }

  /**
   * Simule un événement de victoire de round (team_round_win) envoyé par le serveur de jeu
   */
  async simulateRoundWin(matchId: string, serverId: string, winner: 'CT' | 'T'): Promise<{ ok: boolean }> {
    const currentPhase = typeof (this.state as any).getPhase === 'function'
      ? await (this.state as any).getPhase(matchId)
      : null;
    if (currentPhase && currentPhase === MatchPhase.POSTGAME) {
      if (typeof (this.state as any).setPhase === 'function') {
        await (this.state as any).setPhase(matchId, MatchPhase.LIVE_MAIN);
      }
      await this.ws.push(matchId, 'phase:changed', { matchId, phase: MatchPhase.LIVE_MAIN });
    }

    const event = {
      type: 'team_round_win',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        winner,
        team: winner,
        reason: 'elim',
      },
    };

    await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(event));
    this.logger.log(`[Sandbox] Événement simulé publié: team_round_win (${winner}) pour match=${matchId}`);
    return { ok: true };
  }

  /**
   * Simule une commande joueur dans le chat (ex: !ready, !pause, !unpause, !stay, !switch)
   */
  async simulateCommand(
    matchId: string,
    serverId: string,
    command: string,
    sender: { name: string; steamId?: string; team?: 'CT' | 'T' },
  ): Promise<{ ok: boolean }> {
    let team: 'CT' | 'T' = (sender.team === 'CT' || sender.team === 'T') ? sender.team : 'CT';

    const clean = command.replace(/^[!.]/, '').trim().toLowerCase();
    // Si la commande est !stay ou !switch, s'aligner sur le vainqueur du knife ou passer en knife_choice
    if (clean === 'stay' || clean === 'switch') {
      if (typeof (this.state as any).getKnifeResult === 'function') {
        const knife = await (this.state as any).getKnifeResult(matchId);
        if (knife && (knife.side === 'CT' || knife.side === 'T')) {
          team = knife.side;
        }
      }
      if (typeof (this.state as any).getPhase === 'function') {
        const phase = await (this.state as any).getPhase(matchId);
        if (phase === MatchPhase.KNIFE_LIVE) {
          if (typeof (this.state as any).setPhase === 'function') {
            await (this.state as any).setPhase(matchId, MatchPhase.KNIFE_CHOICE);
          }
          await this.ws.push(matchId, 'phase:changed', { matchId, phase: MatchPhase.KNIFE_CHOICE });
        }
      }
    }

    const event = {
      type: 'command',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        command,
        sender: {
          name: sender.name || 'SandboxTester',
          steamId: sender.steamId || '76561198000000001',
          team,
        },
      },
    };

    await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(event));
    this.logger.log(`[Sandbox] Commande simulée publiée: ${command} par ${sender.name || 'SandboxTester'} (${team})`);
    return { ok: true };
  }

  /**
   * Récupère le snapshot complet d'un match
   */
  async getState(matchId: string): Promise<any> {
    return this.snapshotQ.getSnapshot(matchId);
  }

  /**
   * Exécute une commande RCON directe sur le serveur CS2 ciblé
   */
  async executeRcon(serverId: string, command: string, matchId?: string): Promise<{ ok: boolean; command: string }> {
    const sId = serverId.trim();
    if (!sId) throw new BadRequestException('serverId est requis pour exécuter RCON');
    const mid = matchId || (await this.state.getMatchIdFromServerId(sId)) || 'sandbox';
    await this.cmds.rcon({
      serverId: sId,
      matchId: mid,
      command,
    });
    this.logger.log(`[Sandbox] RCON direct envoyé (${sId}): ${command}`);
    return { ok: true, command };
  }

  /**
   * Détermine si l'entité native Valve "team1" est Counter-Terrorist (CT) ou Terrorist (T)
   * à un round donné.
   * - En MR12 (règlement CS2) : rounds 1-12 = CT, rounds 13-24 = T (inversion mi-temps !)
   * - En Overtime MR3 : alterne toutes les 3 manches
   */
  isTeam1OnCt(round: number, mr = 12, otMr = 3): boolean {
    if (round <= mr) return true;
    if (round <= mr * 2) return false;
    const otRound = round - (mr * 2);
    const otHalfIndex = Math.floor((otRound - 1) / otMr);
    return otHalfIndex % 2 === 0;
  }

  /**
   * Résout le répertoire des fixtures de test / logs archivés
   */
  getFixturesDirectory(): string | null {
    const p1 = path.resolve(process.cwd(), 'test/fixtures');
    if (fs.existsSync(p1)) return p1;
    const p2 = path.resolve(process.cwd(), '../test/fixtures');
    if (fs.existsSync(p2)) return p2;
    return null;
  }

  /**
   * Retourne la liste des fixtures et matchs réels disponibles pour le rejeu
   */
  getAvailableFixtures(): AvailableFixture[] {
    const fixturesDir = this.getFixturesDirectory();
    if (!fixturesDir) return [];

    const result: AvailableFixture[] = [];

    // Fichiers de logs bruts (.log / .txt)
    const rawLogsDir = path.join(fixturesDir, 'raw-logs');
    if (fs.existsSync(rawLogsDir)) {
      const files = fs.readdirSync(rawLogsDir);
      for (const file of files) {
        if (file.endsWith('.log') || file.endsWith('.txt')) {
          const stats = fs.statSync(path.join(rawLogsDir, file));
          result.push({
            id: file,
            name: this.formatFixtureName(file),
            type: 'raw-log',
            sizeBytes: stats.size,
            description: `Fichier brut Valve CS2 (${Math.round(stats.size / 1024)} KB)`,
          });
        }
      }
    }

    // Fichiers de scénarios JSON
    const scenariosDir = path.join(fixturesDir, 'scenarios');
    if (fs.existsSync(scenariosDir)) {
      const files = fs.readdirSync(scenariosDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const stats = fs.statSync(path.join(scenariosDir, file));
          result.push({
            id: file,
            name: this.formatFixtureName(file),
            type: 'scenario',
            sizeBytes: stats.size,
            description: `Scénario d'événements structurés JSON (${Math.round(stats.size / 1024)} KB)`,
          });
        }
      }
    }

    return result;
  }

  private formatFixtureName(filename: string): string {
    const knownLabels: Record<string, string> = {
      'cs2_match_inferno_overtime_anonymized.log': 'Inferno (Overtime CS2, 17-19)',
      'cs2_match_ancient_pauses_anonymized.log': 'Ancient (Pauses CS2, 13-8)',
      'gglan19_sample_match59_anonymized.log': 'Mirage (Match LAN #59, 13-2)',
      'gglan19_match161_ancient_ot2_anonymized.log': 'Ancient (Match LAN #161, 2 OT 16-19)',
      'gglan19_match164_inferno_ot1_anonymized.log': 'Inferno (Match LAN #164, 1 OT 13-16)',
      'gglan19_match165_anubis_stomp_anonymized.log': 'Anubis (Match LAN #165, Stomp 13-1)',
      'gglan19_match167_nuke_24rounds_anonymized.log': 'Nuke (Match LAN #167, 24 rounds 13-11)',
      'scenario-04-cs2-overtime-inferno.json': 'Inferno (Overtime CS2, 36 rounds)',
      'scenario-03-overtime5-match156-inferno.json': 'Inferno (5 Overtimes, 53 rounds)',
      'scenario-01-full-match-mirage.json': 'Mirage (Match standard, 16 rounds)',
      'scenario-02-pauses-match71-ancient.json': 'Ancient (Pauses tactiques & tech)',
    };
    if (knownLabels[filename]) {
      return knownLabels[filename];
    }

    return filename
      .replace(/_anonymized/g, '')
      .replace(/\.log|\.txt|\.json/g, '')
      .replace(/[-_]/g, ' ')
      .replace(/scenario \d+ /i, '')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Rejoue un fichier de logs bruts Valve CS2 (ligne par ligne ou par lot)
   */
  async replayRawLog(dto: ReplayRawLogDto): Promise<{
    ok: boolean;
    totalLines: number;
    linesSent: number;
    mode: 'agent_http' | 'fallback_parser';
    durationMs: number;
  }> {
    const matchId = (dto.matchId || 'm-sandbox-1').trim();
    const serverId = (dto.serverId || 'srv-a').trim();

    // S'assurer de la liaison serveur ↔ matchId
    await this.state.setServerIdToMatchId(serverId, matchId);
    await this.redis.set(redisConst.matchServer(matchId), serverId);

    // Purger les événements en cours avant de réinitialiser l'état
    if (this.eventsRouter && typeof this.eventsRouter.drain === 'function') {
      await this.eventsRouter.drain();
    }

    // Réinitialiser complètement le roster et les statistiques pour un rejeu propre
    if (typeof (this.state as any).clearRoster === 'function') {
      await this.state.clearRoster(matchId);
    }
    if (typeof (this.state as any).resetPlayerStats === 'function') {
      await this.state.resetPlayerStats(matchId);
    }
    if (typeof (this.state as any).resetStreaks === 'function') {
      await (this.state as any).resetStreaks(matchId);
    }

    // Réinitialiser l'état pour garantir un rejeu propre
    await this.injectState({
      matchId,
      serverId,
      sides: { home: 'CT', away: 'T' },
      teams: { home_name: '', away_name: '' },
      score: { ct: 0, t: 0, round: 0 },
      lastScoredRound: 0,
      halftimePlayed: false,
      overtimeCount: 0,
      phase: MatchPhase.LIVE_MAIN,
      settings: {
        overtimeEnabled: true,
        mrFormat: 12,
        overtimeMrFormat: 3,
        warmupAtHalftime: false,
        warmupAtOvertime: false,
        warmupAfterKnife: false,
        knifeEnabled: false,
      },
    });
    if (typeof (this.state as any).resetPlayerStats === 'function') {
      await this.state.resetPlayerStats(matchId);
    }

    let rawText = dto.content || '';
    if (!rawText && dto.fixtureName) {
      const fixturesDir = this.getFixturesDirectory();
      if (!fixturesDir) throw new BadRequestException('Répertoire de fixtures introuvable');
      const filePath = path.join(fixturesDir, 'raw-logs', dto.fixtureName);
      if (!fs.existsSync(filePath)) throw new BadRequestException(`Fichier introuvable: ${dto.fixtureName}`);
      rawText = await fs.promises.readFile(filePath, 'utf8');
    }

    if (!rawText.trim()) {
      throw new BadRequestException('Aucun contenu de log fourni');
    }

    const allLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lines = dto.maxLines && dto.maxLines > 0 ? allLines.slice(0, dto.maxLines) : allLines;

    const start = Date.now();
    const agentUrl = process.env.AGENT_LOGS_URL || 'http://127.0.0.1:8082/logs?token=tonSuperSecret';

    let mode: 'agent_http' | 'fallback_parser' = 'agent_http';
    let linesSent = 0;

    const speed = dto.speed || 'fast';
    const batchSize = speed === 'instant' ? 100 : (speed === 'realtime' ? 1 : 25);
    const delayMs = speed === 'instant' ? 0 : (speed === 'realtime' ? 400 : 25);

    // Tester la connectivité vers l'Agent Go
    let agentAvailable = false;
    try {
      const ping = await fetch(agentUrl, { method: 'POST', body: '' }).catch(() => null);
      if (ping && ping.status !== 502 && ping.status !== 503) {
        agentAvailable = true;
      }
    } catch {
      agentAvailable = false;
    }

    if (agentAvailable) {
      mode = 'agent_http';
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        const cleaned = batch.map(cleanContainerLogPrefix).join('\n');
        await fetch(agentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: cleaned,
        }).catch((err) => {
          this.logger.warn(`Échec envoi batch logs à l'Agent Go: ${err.message}`);
        });
        linesSent += batch.length;
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      // Laisser passer une courte fenêtre pour le ticker de batching de l'Agent Go (50ms)
      await new Promise((r) => setTimeout(r, 80));
    } else {
      mode = 'fallback_parser';
      this.logger.log(`[Sandbox] Agent Go non joignable sur ${agentUrl}, utilisation du fallback parser natif`);
      for (const line of lines) {
        const event = parseCs2LineFallback(line, matchId, serverId);
        if (event) {
          await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(event));
          linesSent++;
        }
        if (delayMs > 0 && event) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    if (this.eventsRouter && typeof this.eventsRouter.drain === 'function') {
      await this.eventsRouter.drain();
    }

    const durationMs = Date.now() - start;
    this.logger.log(`[Sandbox] Replay terminé (${mode}) : ${linesSent}/${lines.length} lignes en ${durationMs}ms`);

    return {
      ok: true,
      totalLines: lines.length,
      linesSent,
      mode,
      durationMs,
    };
  }

  /**
   * Rejoue un scénario complet d'événements structurés JSON
   */
  async replayScenario(dto: ReplayScenarioDto): Promise<{
    ok: boolean;
    totalEvents: number;
    eventsSent: number;
    durationMs: number;
  }> {
    const matchId = (dto.matchId || 'm-sandbox-1').trim();
    const serverId = (dto.serverId || 'srv-a').trim();

    // S'assurer de la liaison serveur ↔ matchId
    await this.state.setServerIdToMatchId(serverId, matchId);
    await this.redis.set(redisConst.matchServer(matchId), serverId);

    // Purger les événements en cours avant de réinitialiser l'état
    if (this.eventsRouter && typeof this.eventsRouter.drain === 'function') {
      await this.eventsRouter.drain();
    }

    // Réinitialiser complètement le roster et les statistiques pour un rejeu propre
    if (typeof (this.state as any).clearRoster === 'function') {
      await this.state.clearRoster(matchId);
    }
    if (typeof (this.state as any).resetPlayerStats === 'function') {
      await this.state.resetPlayerStats(matchId);
    }
    if (typeof (this.state as any).resetStreaks === 'function') {
      await (this.state as any).resetStreaks(matchId);
    }

    let events: any[] = dto.events || [];
    let scenarioSettings: Partial<MatchSettings> = {
      overtimeEnabled: true,
      mrFormat: 12,
      overtimeMrFormat: 3,
      warmupAtHalftime: false,
      warmupAtOvertime: false,
      warmupAfterKnife: false,
      knifeEnabled: false,
    };

    if (events.length === 0 && dto.fixtureName) {
      const fixturesDir = this.getFixturesDirectory();
      if (!fixturesDir) throw new BadRequestException('Répertoire de fixtures introuvable');
      const filePath = path.join(fixturesDir, 'scenarios', dto.fixtureName);
      if (!fs.existsSync(filePath)) throw new BadRequestException(`Scénario introuvable: ${dto.fixtureName}`);
      const content = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      events = Array.isArray(content.events) ? content.events : (Array.isArray(content) ? content : []);
      if (content.metadata?.settings) {
        scenarioSettings = { ...scenarioSettings, ...content.metadata.settings };
      } else if (content.metadata?.mrFormat) {
        scenarioSettings.mrFormat = Number(content.metadata.mrFormat);
      }
    }

    // Réinitialiser l'état pour garantir un rejeu propre
    await this.injectState({
      matchId,
      serverId,
      sides: { home: 'CT', away: 'T' },
      teams: { home_name: '', away_name: '' },
      score: { ct: 0, t: 0, round: 0 },
      lastScoredRound: 0,
      halftimePlayed: false,
      overtimeCount: 0,
      phase: MatchPhase.LIVE_MAIN,
      settings: scenarioSettings,
    });
    if (typeof (this.state as any).resetPlayerStats === 'function') {
      await this.state.resetPlayerStats(matchId);
    }

    if (!Array.isArray(events) || events.length === 0) {
      throw new BadRequestException('Aucun événement à rejouer');
    }

    const start = Date.now();
    const speed = dto.speed || 'fast';
    const delayMs = speed === 'instant' ? 0 : (speed === 'realtime' ? 300 : 20);

    let eventsSent = 0;
    for (const rawEv of events) {
      const ev = {
        ...rawEv,
        matchId: matchId || rawEv.matchId,
        serverId: serverId || rawEv.serverId,
        timestamp: rawEv.timestamp || Date.now(),
      };
      await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(ev));
      eventsSent++;
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (this.eventsRouter && typeof this.eventsRouter.drain === 'function') {
      await this.eventsRouter.drain();
    }

    const durationMs = Date.now() - start;
    this.logger.log(`[Sandbox] Replay de scénario terminé : ${eventsSent} événements en ${durationMs}ms`);

    return {
      ok: true,
      totalEvents: events.length,
      eventsSent,
      durationMs,
    };
  }
}

/**
 * Nettoie les préfixes de conteneurs (ex: Pterodactyl stdout "10/25 09:28:58 [Server] L ...")
 */
export function cleanContainerLogPrefix(line: string): string {
  const lIdx = line.indexOf('L ');
  if (lIdx !== -1 && lIdx < 40) {
    return line.slice(lIdx);
  }
  return line;
}

const fallbackIgnoreNextWorldSuicide = new Set<string>();

/**
 * Parser de secours ultra-léger pour rejouer des logs même sans Agent Go actif
 */
export function parseCs2LineFallback(rawLine: string, matchId: string, serverId: string): any | null {
  let line = cleanContainerLogPrefix(rawLine).trim();
  line = line.replace(/^(?:L\s+)?\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*[-:]\s*/, '').trim();
  if (!line) return null;

  if (line.includes('World triggered "Match_Start"')) {
    fallbackIgnoreNextWorldSuicide.clear();
    return { type: 'match_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  if (line.includes('World triggered "Round_Start"')) {
    fallbackIgnoreNextWorldSuicide.clear();
    return { type: 'round_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  const bombKilledMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+was\s+killed\s+by\s+the\s+bomb\.?/);
  if (bombKilledMatch) {
    if (bombKilledMatch[2]) {
      fallbackIgnoreNextWorldSuicide.add(`${matchId}:${bombKilledMatch[2]}`);
    }
    return null;
  }

  const discMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]*)>"\s+disconnected/);
  if (discMatch && discMatch[2]) {
    fallbackIgnoreNextWorldSuicide.add(`${matchId}:${discMatch[2]}`);
    return null;
  }

  const winMatch = line.match(/^Team "(TERRORIST|CT)" triggered "(SFUI_Notice_[A-Za-z_]+)"(?:\s*\(CT "(\d+)"\)\s*\(T "(\d+)"\))?/);
  if (winMatch) {
    const winner = winMatch[1] === 'TERRORIST' ? 'T' : 'CT';
    const sfui = winMatch[2].toLowerCase();
    const reason = sfui.includes('target_bombed')
      ? 'bomb_exploded'
      : ((sfui.includes('defused') || sfui.includes('target_saved')) ? 'defused' : 'elim');
    const scoreCT = winMatch[3] ? parseInt(winMatch[3], 10) : undefined;
    const scoreT = winMatch[4] ? parseInt(winMatch[4], 10) : undefined;
    const score = (scoreCT !== undefined && scoreT !== undefined) ? { ct: scoreCT, t: scoreT } : undefined;
    return {
      type: 'team_round_win',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: { winner, team: winner, reason, scoreCT, scoreT, ...(score ? { score } : {}) },
    };
  }

  const killMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+killed\s+"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+with\s+"([^"]+)"(.*)$/);
  if (killMatch) {
    const isHeadshot = Boolean(killMatch[8]?.includes('headshot'));
    const isTeamkill = Boolean(killMatch[8]?.includes('friendlyfire')) || (
      killMatch[3] === killMatch[6] && (killMatch[3] === 'CT' || killMatch[3] === 'TERRORIST' || killMatch[3] === 'T')
    );
    return {
      type: 'kill',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        kind: 'player',
        killer: { name: killMatch[1], steamId: killMatch[2], team: killMatch[3] },
        victim: { name: killMatch[4], steamId: killMatch[5], team: killMatch[6] },
        weapon: killMatch[7],
        headshot: isHeadshot,
        ...(isTeamkill ? { teamkill: true } : {}),
      },
    };
  }

  const assistMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+(?:(flash)-)?assisted\s+killing\s+"([^"<]+)<\d+><([^>]*)><([^>]+)>"/);
  if (assistMatch) {
    const isFlash = Boolean(assistMatch[4]);
    return {
      type: 'assist',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: assistMatch[1], steamId: assistMatch[2], team: assistMatch[3] },
        victim: { name: assistMatch[5], steamId: assistMatch[6], team: assistMatch[7] },
        flashAssist: isFlash,
      },
    };
  }

  const suicideMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+committed\s+suicide\s+with\s+"([^"]+)"/);
  if (suicideMatch) {
    const key = `${matchId}:${suicideMatch[2]}`;
    if (suicideMatch[4]?.toLowerCase() === 'world' && fallbackIgnoreNextWorldSuicide.has(key)) {
      fallbackIgnoreNextWorldSuicide.delete(key);
      return null;
    }
    return {
      type: 'kill',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        kind: 'suicide',
        player: { name: suicideMatch[1], steamId: suicideMatch[2], team: suicideMatch[3] },
        weapon: suicideMatch[4],
      },
    };
  }

  const plantedMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Planted_The_Bomb"(?:\s+(?:at\s+bombsite|\(Site\))\s+(A|B)\)?)?/);
  if (plantedMatch) {
    return {
      type: 'bomb_planted',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        planter: { name: plantedMatch[1], steamId: plantedMatch[2], team: plantedMatch[3] },
        ...(plantedMatch[4] ? { site: plantedMatch[4] } : {}),
      },
    };
  }

  const beginPlantMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Bomb_Begin_Plant"\s+at\s+bombsite\s+(A|B)/);
  if (beginPlantMatch) {
    return {
      type: 'begin_bomb_plant',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: beginPlantMatch[1], steamId: beginPlantMatch[2], team: beginPlantMatch[3] },
        site: beginPlantMatch[4],
      },
    };
  }

  const defusedMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Defused_The_Bomb"/);
  if (defusedMatch) {
    return {
      type: 'bomb_defused',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        defuser: { name: defusedMatch[1], steamId: defusedMatch[2], team: defusedMatch[3] },
      },
    };
  }

  const defuseBeginMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Begin_Bomb_Defuse(?:_(With|Without)_Kit)?"/);
  if (defuseBeginMatch) {
    return {
      type: 'defuse_begin',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: defuseBeginMatch[1], steamId: defuseBeginMatch[2], team: defuseBeginMatch[3] },
        hasKit: defuseBeginMatch[4] === 'With',
      },
    };
  }

  if (line.includes('triggered "Aborted_Bomb_Defuse"')) {
    return { type: 'defuse_abort', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  if (line.includes('World triggered "Match_Start"')) {
    return { type: 'match_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  return null;
}
