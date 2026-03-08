import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';
import { SidesScoreService} from './sides-score.service';
import { Phase } from '@domain/phase.types';

type TeamsDoc = {
  ct_id?: string | null;
  t_id?: string | null;
  home_id?: string | null;
  away_id?: string | null;
  ct_name?: string | null;
  t_name?: string | null;
  home_name?: string | null;
  away_name?: string | null;
};

type TeamsHash = Partial<Record<
  'ct_id' | 't_id' | 'home_id' | 'away_id' | 'ct_name' | 't_name' | 'home_name' | 'away_name',
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

    // Résolution ct_id / t_id si non fournis explicitement
    const ctId =
      (teams.ct_id ?? null) ??
      (sides ? (sides.home === 'CT' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

    const tId =
      (teams.t_id ?? null) ??
      (sides ? (sides.home === 'T' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

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

    return {
      matchId,
      sides,
      score: {
        t: toInt(scoreHash?.t),
        ct: toInt(scoreHash?.ct),
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
        ct_id: ctId,
        t_id: tId,
        home_id: teams.home_id ?? null,
        away_id: teams.away_id ?? null,
        ct_name: teams.ct_name ?? 'CT',
        t_name: teams.t_name ?? 'T',
        home_name: teams.home_name ?? null,
        away_name: teams.away_name ?? null,
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
   * Lit le hash teams. Si vide, tente de lire l’ancienne String JSON
   * et migre automatiquement vers le hash.
   */
  private async readTeamsHashWithAutoMigrate(matchId: string): Promise<TeamsHash> {
    const key = redisConst.teams(matchId);

    // 1) Essayer en Hash
    const h = await this.redis.hgetall(key);
    if (Object.keys(h).length > 0) {
      return h as TeamsHash;
    }

    // 2) Fallback migration depuis ancienne String JSON
    const raw = await this.redis.get(key);
    if (!raw) return {};

    try {
      const o = JSON.parse(raw) as any;
      const mapped: TeamsHash = {
        ct_id: o.ct_id ?? o.ct?.id,
        t_id: o.t_id ?? o.t?.id,
        home_id: o.home_id ?? o.home?.id,
        home_name: o.home_name ?? o.home?.name,
        away_id: o.away_id ?? o.away?.id,
        away_name: o.away_name ?? o.away?.name,
        ct_name: o.ct_name ?? o.ct?.name,
        t_name: o.t_name ?? o.t?.name,
      };

      // Supprimer l’ancienne String AVANT d’écrire le Hash (même clé)
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
    ct_id: h.ct_id ?? null,
    t_id: h.t_id ?? null,
    home_id: h.home_id ?? null,
    away_id: h.away_id ?? null,
    ct_name: h.ct_name ?? null,
    t_name: h.t_name ?? null,
    home_name: h.home_name ?? null,
    away_name: h.away_name ?? null,
  };
}
