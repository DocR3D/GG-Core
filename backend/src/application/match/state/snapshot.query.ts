import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';
import { SidesScoreService} from './sides-score.service';
import { Phase } from '@domain/phase.types';

type TeamsDoc = {
  home_id?: string | null;
  away_id?: string | null;
  home_name?: string | null;
  away_name?: string | null;
};

type TeamsHash = Partial<Record<
  'home_id' | 'away_id' | 'home_name' | 'away_name',
  string
>>;

@Injectable()
export class SnapshotQuery {
  private readonly logger = new Logger(SnapshotQuery.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly sidesScore: SidesScoreService,
  ) {}

  /**
   * Lecture snapshot complet (teams en Hash).
   * Migre automatiquement la clé teams si elle est encore stockée en JSON String.
   */
  async getSnapshot(matchId: string) {
    const teamsHash = await this.readTeamsHashWithAutoMigrate(matchId);
    const teams = mapTeamsHashToDoc(teamsHash);

    const [
      sides,
      scoreHash,
      timeoutsHash,
      econTeam,
      playersMoney,
      playersEquip,
      pauseHash,
      homeIds,
      awayIds,
    ] = await Promise.all([
      this.sidesScore.getSides(matchId),
      this.redis.hgetall(redisConst.score(matchId)),
      this.redis.hgetall(redisConst.timeouts(matchId)),
      this.redis.hgetall(redisConst.economyTeam(matchId)),
      this.redis.hgetall(redisConst.moneyHash(matchId)),
      this.redis.hgetall(redisConst.equipHash(matchId)),
      this.redis.hgetall(redisConst.pause(matchId)),
      this.redis.lrange(redisConst.lineupHome(matchId), 0, -1),
      this.redis.lrange(redisConst.lineupAway(matchId), 0, -1),
    ]);

    // Players $ / equip
    const players: Record<string, { money: number; equip: number }> = {};
    const ids = new Set([
      ...Object.keys(playersMoney || {}),
      ...Object.keys(playersEquip || {}),
    ]);
    for (const id of ids) {
      players[id] = {
        money: toInt(playersMoney?.[id]),
        equip: toInt(playersEquip?.[id]),
      };
    }

    // Banks agrégées
    const sum = (arr: string[]) => arr.reduce((acc, id) => acc + (players[id]?.money || 0), 0);
    const homeBank = sum(homeIds);
    const awayBank = sum(awayIds);

    // Pause
    const pauseState = (pauseHash?.state as 'paused' | 'none') || 'none';
    const pauseReason = (pauseHash?.reason as 'tactical' | 'technical' | 'admin' | undefined) || undefined;
    const pauseTeam = (pauseHash?.team as 'home' | 'away' | 'system' | undefined) || undefined;
    const startedAtMs = toInt(pauseHash?.started_at) || 0;

    // Banques tactiques persistées
    const tacHomeSec = toInt(pauseHash?.tac_bank_home) || 0;
    const tacAwaySec = toInt(pauseHash?.tac_bank_away) || 0;

    // Vue effective pendant pause tactique
    const now = Date.now();
    const elapsedSec = (pauseState === 'paused' && pauseReason === 'tactical' && startedAtMs)
      ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
      : 0;

    let effectiveHomeTacSec = tacHomeSec;
    let effectiveAwayTacSec = tacAwaySec;
    if (pauseState === 'paused' && pauseReason === 'tactical') {
      if (pauseTeam === 'home') effectiveHomeTacSec = Math.max(0, tacHomeSec - elapsedSec);
      if (pauseTeam === 'away') effectiveAwayTacSec = Math.max(0, tacAwaySec - elapsedSec);
    }

    const homeIsCt = sides?.home === 'CT';
    const homeSide = sides?.home ?? 'CT';
    const awaySide = sides?.away ?? 'T';

    return {
      matchId,
      homeIsct: homeIsCt,
      score: {
        home: homeIsCt ? toInt(scoreHash?.ct) : toInt(scoreHash?.t),
        away: homeIsCt ? toInt(scoreHash?.t) : toInt(scoreHash?.ct),
        round: toInt(scoreHash?.round) || 1,
        phase: (scoreHash?.phase as Phase) ?? 'freeze',
      },
      timeouts: {
        homeTacSec: tacHomeSec,
        awayTacSec: tacAwaySec,
        effective: {
          homeTacSec: effectiveHomeTacSec,
          awayTacSec: effectiveAwayTacSec,
          elapsedSec,
        },
        // legacy (à déprécier si non utilisé côté UI)
        homeTech: toInt(timeoutsHash?.homeTech),
        awayTech: toInt(timeoutsHash?.awayTech),
      },
      pause: {
        state: pauseState,
        reason: pauseReason,
        team: pauseTeam,
        startedAt: startedAtMs || null,
      },
      teams: {
        home: { id: teams.home_id ?? null, name: teams.home_name ?? null, side: homeSide },
        away: { id: teams.away_id ?? null, name: teams.away_name ?? null, side: awaySide },
      },
      economy: {
        round: toInt(econTeam?.round) || toInt(scoreHash?.round) || 1,
        home_loss_streak: toInt(econTeam?.home_loss_streak),
        away_loss_streak: toInt(econTeam?.away_loss_streak),
        home_loss_bonus: toInt(econTeam?.home_loss_bonus),
        away_loss_bonus: toInt(econTeam?.away_loss_bonus),
        home_bank: homeBank,
        away_bank: awayBank,
        players,
      },
    };
  }

  /**
   * Lit le hash teams. Si vide, tente de lire l'ancienne String JSON
   * et migre automatiquement vers le hash.
   */
  private async readTeamsHashWithAutoMigrate(matchId: string): Promise<TeamsHash> {
    const key = redisConst.teams(matchId);

    // 1) Essayer en Hash (WRONGTYPE si la clé est encore une String)
    let h: TeamsHash = {};
    try {
      h = await this.redis.hgetall(key);
      if (Object.keys(h).length > 0) return h as TeamsHash;
    } catch {
      // clé de type String → migration ci-dessous
    }

    // 2) Fallback migration depuis ancienne String JSON
    const raw = await this.redis.get(key);
    if (!raw) return {};

    try {
      const o = JSON.parse(raw) as any;
      const mapped: TeamsHash = {
        home_id: o.home_id ?? o.home?.id,
        home_name: o.home_name ?? o.home?.name,
        away_id: o.away_id ?? o.away?.id,
        away_name: o.away_name ?? o.away?.name,
      };

      // Supprimer l'ancienne String AVANT d'écrire le Hash (même clé)
      await this.redis.del(key);
      const flatEntries = Object.entries(mapped)
        .filter(([, v]) => v != null) as [string, string][];
      if (flatEntries.length > 0) {
        await this.redis.hset(key, Object.fromEntries(flatEntries));
      }

      this.logger.log(`[teams:migrate] Migrated JSON→Hash for ${key}`);
      return mapped;
    } catch (e) {
      this.logger.warn(`[teams:migrate] Failed to parse JSON for ${key}: ${String(e)}`);
      return {};
    }
  }
}

// ---------------------
// Helpers
// ---------------------

function toInt(v?: string | null): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}

function mapTeamsHashToDoc(h: TeamsHash): TeamsDoc {
  return {
    home_id: h.home_id ?? null,
    away_id: h.away_id ?? null,
    home_name: h.home_name ?? null,
    away_name: h.away_name ?? null,
  };
}
