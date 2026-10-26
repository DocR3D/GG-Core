// src/application/match/sandbox/sandbox.service.ts
import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import * as path from 'path';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst, REDIS_CHANNELS } from '../state/redis.keys';
import { MatchStateService } from '../state/match-state.service';
import { SidesScoreService, type CoreSide, type Logical } from '../state/sides-score.service';
import { SnapshotQuery } from '../state/snapshot.query';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { MatchPhase, Phase, RoundPhase } from '@domain/phase.types';
import { GameSide, normalizeSide } from '@domain/side.types';
import { RoundBackupService, ValveBackupOptions, ValveBackupPlayer } from '../backup/round-backup.service';
import { InjectStateDto, InGameRestoreDto } from './sandbox.dto';

export type { InjectStateDto, InGameRestoreDto };

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
        name: 'Regulation Climax (11 - 12)',
        description: 'Balle de match ou prolongations (round 23). Teste la victoire 13-11 ou l\'égalisation 12-12.',
        phase: MatchPhase.LIVE_MAIN,
        round: 23,
        score: { ct: 11, t: 12, home: 11, away: 12 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: true,
        overtimeCount: 0,
        lastScoredRound: 23,
        suggestedTest: 'Si T gagne -> 11-13 (Victoire T / postgame). Si CT gagne -> 12-12 (Déclenche l\'Overtime).',
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

    // 1. Liaison serveur si fourni
    if (dto.serverId) {
      await this.state.setServerIdToMatchId(dto.serverId, mid);
      await this.redis.set(redisConst.matchServer(mid), dto.serverId);
    }

    // 2. Sides
    if (dto.sides) {
      await this.state.setSides(mid, dto.sides);
    }

    // 3. Teams
    if (dto.teams) {
      await this.state.setTeams(mid, dto.teams);
    }

    // 4. Phase globale & RoundPhase
    if (dto.phase) {
      await this.state.setPhase(mid, dto.phase as Phase);
    }
    if (dto.roundPhase) {
      await this.redis.set(redisConst.roundPhase(mid), dto.roundPhase);
    }

    // 5. Score
    if (dto.score) {
      const ct = dto.score.ct ?? 0;
      const t = dto.score.t ?? 0;
      const sides = dto.sides ?? (await this.state.getSides(mid)) ?? { home: 'CT', away: 'T' };
      const home = dto.score.home ?? (sides.home === 'CT' ? ct : t);
      const away = dto.score.away ?? (sides.away === 'CT' ? ct : t);
      const round = dto.score.round ?? (ct + t);

      await this.redis.hset(redisConst.score(mid), {
        ct: String(ct),
        t: String(t),
        home: String(home),
        away: String(away),
        round: String(round),
      });
    }

    // 6. Anti-eBug Guards & Overtime
    if (dto.halftimePlayed !== undefined) {
      await this.state.setHalftimePlayed(mid, dto.halftimePlayed);
    }
    if (dto.overtimeCount !== undefined) {
      await this.state.setOvertimeCount(mid, dto.overtimeCount);
    }
    if (dto.lastScoredRound !== undefined) {
      await this.state.setLastScoredRound(mid, dto.lastScoredRound);
    }

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

    const round = dto.round;
    const team1 = dto.team1Name || 'Home Team';
    const team2 = dto.team2Name || 'Away Team';
    const map = dto.map || 'de_inferno';

    // Nom de fichier de backup (format standard Valve e.g. sandbox_round12.txt)
    const fileName = dto.backupFileName || `sandbox_round${String(round).padStart(2, '0')}.txt`;

    // Détermination du répertoire de destination
    // CS2 recherche les fichiers de backup dans son sous-dossier csgo/
    const backupDir = process.env.CS2_BACKUP_DIR || path.resolve(process.cwd(), 'temp/backups/sandbox');
    const filePath = path.join(backupDir, fileName);

    const vdfContent = this.backupService.generateValveBackup({
      round,
      team1Name: team1,
      team2Name: team2,
      map,
      scoreTeam1: dto.scoreTeam1,
      scoreTeam2: dto.scoreTeam2,
      firstHalfScore: dto.firstHalfScore,
      secondHalfScore: dto.secondHalfScore,
      overtimeScore: dto.overtimeScore,
      playersTeam1: dto.playersTeam1,
      playersTeam2: dto.playersTeam2,
    });

    await this.backupService.writeBackupFile(filePath, vdfContent);

    const rconCommand = `mp_backup_restore_load_file ${fileName}`;

    if (dto.applyViaRcon !== false) {
      // Envoyer la commande RCON native Valve via l'agent
      await this.cmds.rcon({
        serverId,
        matchId,
        command: rconCommand,
      });
      this.logger.log(`[Sandbox] Commande RCON envoyée à l'agent (${serverId}): ${rconCommand}`);
    }

    // Également injecter l'état dans Redis pour cohérence immédiate du scoreboard backend
    await this.injectState({
      matchId,
      serverId,
      score: {
        ct: dto.scoreTeam1,
        t: dto.scoreTeam2,
        round,
      },
      lastScoredRound: round,
      halftimePlayed: round > 12,
      overtimeCount: round > 24 ? 1 : 0,
      phase: round > 24 ? MatchPhase.OVERTIME : MatchPhase.LIVE_MAIN,
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
    const event = {
      type: 'team_round_win',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        team: winner,
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
    sender: { name: string; steamId?: string; team: 'CT' | 'T' },
  ): Promise<{ ok: boolean }> {
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
          team: sender.team,
        },
      },
    };

    await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(event));
    this.logger.log(`[Sandbox] Commande simulée publiée: ${command} par ${sender.name} (${sender.team})`);
    return { ok: true };
  }

  /**
   * Récupère le snapshot complet d'un match
   */
  async getState(matchId: string): Promise<any> {
    return this.snapshotQ.getSnapshot(matchId);
  }
}
