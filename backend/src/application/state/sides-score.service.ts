import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis-keys';

export type GameSide = 'CT' | 'T';
export type Logical = 'home' | 'away';
export type Phase = 'freeze' | 'live' | 'intermission' | 'paused' | 'timeout' | 'ended' | 'knife' | 'tech_timeout';
export type CoreSide = { home: GameSide; away: GameSide };

@Injectable()
export class SidesScoreService {
  private readonly log = new Logger(SidesScoreService.name);
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Server ↔ Match binding
  // ─────────────────────────────────────────────────────────────────────────────
  private serverMatchKey(serverId: string): string {
    // compat: certains projets avaient serverMatchid
    // @ts-ignore
    if (typeof (redisConst as any).serverMatch === 'function') return (redisConst as any).serverMatch(serverId);
    // @ts-ignore
    if (typeof (redisConst as any).serverMatchid === 'function') return (redisConst as any).serverMatchid(serverId);
    throw new BadRequestException('redisConst.serverMatch(.serverMatchid) manquant');
  }

  async setServerMatch(serverId: string, matchId: string, ttlSec?: number) {
    const key = this.serverMatchKey(serverId);
    if (ttlSec && ttlSec > 0) {
      await this.redis.set(key, matchId, 'EX', ttlSec);
    } else {
      await this.redis.set(key, matchId);
    }
  }
  async getServerMatch(serverId: string): Promise<string | null> {
    const key = this.serverMatchKey(serverId);
    return (await this.redis.get(key)) as string | null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sides (source de vérité) — Hash {home:'CT'|'T', away:'CT'|'T'}
  // Migration depuis legacy String JSON si besoin.
  // ─────────────────────────────────────────────────────────────────────────────
  async setSides(matchId: string, sides: CoreSide) {
    await this.redis.hset(redisConst.sides(matchId), { home: sides.home, away: sides.away });
  }

  async getSides(matchId: string): Promise<CoreSide | null> {
    const key = redisConst.sides(matchId);
    const t = await this.redis.type(key);

    if (t === 'hash') {
      const h = await this.redis.hgetall(key);
      if (isSide(h?.home) && isSide(h?.away)) return { home: h.home, away: h.away };
      this.log.warn(`Invalid sides hash for ${matchId}: ${JSON.stringify(h)}`);
      return null;
    }

    if (t === 'string') {
      const json = await this.redis.get(key);
      if (json) {
        try {
          const obj = JSON.parse(json) as CoreSide;
          if (isSide(obj?.home) && isSide(obj?.away)) {
            await this.redis.del(key); // ✅ DEL d’abord
            await this.redis.hset(key, { home: obj.home, away: obj.away }); // puis HSET
            return obj;
          }
        } catch (e) {
          this.log.warn(`Failed to parse legacy sides for ${matchId}: ${e}`);
        }
      }
    }

    return null;
  }

  async swapSides(matchId: string): Promise<boolean> {
    const key = redisConst.sides(matchId);
    const h = await this.redis.hgetall(key);
    if (!isSide(h?.home) || !isSide(h?.away)) return false;
    await this.redis.hset(key, { home: h.away, away: h.home });
    return true;
  }

  async sideToLogical(matchId: string, side: GameSide): Promise<Logical | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    if (side === s.home) return 'home';
    if (side === s.away) return 'away';
    return null;
  }

  async logicalToSide(matchId: string, logical: Logical): Promise<GameSide | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    return logical === 'home' ? s.home : s.away;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Score & phase
  // ─────────────────────────────────────────────────────────────────────────────
  async initScore(matchId: string) {
    const key = redisConst.score(matchId);
    await this.redis.hset(key, 't', '0', 'ct', '0', 'round', '1', 'phase', 'freeze');
  }

  async setPhase(matchId: string, phase: Phase) {
    await this.redis.hset(redisConst.score(matchId), { phase });
  }

  async incRound(matchId: string) {
    await this.redis.hincrby(redisConst.score(matchId), 'round', 1);
  }

  async addPoint(matchId: string, winner: GameSide) {
    const field = winner === 'T' ? 't' : 'ct';
    await this.redis.hincrby(redisConst.score(matchId), field, 1);
  }

  async getPhase(matchId: string): Promise<Phase | null> {
    const p = await this.redis.hget(redisConst.score(matchId), 'phase');
    return (p as Phase) ?? null;
  }

  async getRound(matchId: string): Promise<number> {
    const r = await this.redis.hget(redisConst.score(matchId), 'round');
    return toInt(r);
  }

  async getScore(matchId: string): Promise<{ t: number; ct: number }> {
    const key = redisConst.score(matchId);
    const [t, ct] = await this.redis.hmget(key, 't', 'ct');
    return { t: toInt(t), ct: toInt(ct) };
  }
}

// ───────────── helpers ─────────────
function isSide(s: any): s is GameSide {
  return s === 'CT' || s === 'T';
}
function toInt(v: string | null | undefined): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}
