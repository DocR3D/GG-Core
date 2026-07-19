import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';

export interface SeriesMapEntry {
  map: string;
  ctTeamLogical: 'home' | 'away';
}

export interface SeriesConfig {
  bo: 1 | 3 | 5;
  overtimeEnabled: boolean;
  homeId: string;
  awayId: string;
}

@Injectable()
export class SeriesStateService {
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // ── Init ────────────────────────────────────────────────────────────────────

  async initSeries(
    seriesId: string,
    cfg: SeriesConfig & { maps: SeriesMapEntry[] },
  ): Promise<void> {
    await this.redis.hset(redisConst.seriesConfig(seriesId), {
      bo:              String(cfg.bo),
      overtimeEnabled: cfg.overtimeEnabled ? '1' : '0',
      homeId:          cfg.homeId,
      awayId:          cfg.awayId,
    });
    await this.redis.hset(redisConst.seriesScores(seriesId), { home: '0', away: '0' });
    await this.redis.set(redisConst.seriesMaps(seriesId), JSON.stringify(cfg.maps));
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  async getSeriesConfig(seriesId: string): Promise<SeriesConfig | null> {
    const h = await this.redis.hgetall(redisConst.seriesConfig(seriesId));
    if (!h?.bo) return null;
    return {
      bo:              parseInt(h.bo, 10) as 1 | 3 | 5,
      overtimeEnabled: h.overtimeEnabled === '1',
      homeId:          h.homeId ?? '',
      awayId:          h.awayId ?? '',
    };
  }

  async getMaps(seriesId: string): Promise<SeriesMapEntry[]> {
    const raw = await this.redis.get(redisConst.seriesMaps(seriesId));
    if (!raw) return [];
    try { return JSON.parse(raw) as SeriesMapEntry[]; } catch { return []; }
  }

  // ── Scores ──────────────────────────────────────────────────────────────────

  async getScores(seriesId: string): Promise<{ home: number; away: number }> {
    const [home, away] = await this.redis.hmget(
      redisConst.seriesScores(seriesId), 'home', 'away',
    );
    return { home: parseInt(home ?? '0', 10), away: parseInt(away ?? '0', 10) };
  }

  async addWin(
    seriesId: string,
    logical: 'home' | 'away',
  ): Promise<{ home: number; away: number }> {
    const key = redisConst.seriesScores(seriesId);
    await this.redis.hincrby(key, logical, 1);
    return this.getScores(seriesId);
  }

  // ── DB id ───────────────────────────────────────────────────────────────────

  async setDbId(seriesId: string, dbId: number): Promise<void> {
    await this.redis.set(redisConst.seriesDbId(seriesId), String(dbId));
  }

  async getDbId(seriesId: string): Promise<number | null> {
    const v = await this.redis.get(redisConst.seriesDbId(seriesId));
    return v ? parseInt(v, 10) : null;
  }

  // ── Match courant ────────────────────────────────────────────────────────────

  async setCurrentMatch(seriesId: string, mapNumber: number, matchId: string): Promise<void> {
    await this.redis.set(redisConst.seriesMatch(seriesId, mapNumber), matchId);
  }

  async getCurrentMatch(seriesId: string, mapNumber: number): Promise<string | null> {
    return this.redis.get(redisConst.seriesMatch(seriesId, mapNumber));
  }

  // ── Helpers logique ─────────────────────────────────────────────────────────

  /** Retourne true si la série est terminée (victoires suffisantes pour le BoN). */
  isOver(bo: number, scores: { home: number; away: number }): boolean {
    const needed = Math.ceil(bo / 2);
    return scores.home >= needed || scores.away >= needed;
  }

  /** Retourne le gagnant logique, ou null si la série n'est pas terminée. */
  winner(bo: number, scores: { home: number; away: number }): 'home' | 'away' | null {
    const needed = Math.ceil(bo / 2);
    if (scores.home >= needed) return 'home';
    if (scores.away >= needed) return 'away';
    return null;
  }
}
