import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis-keys';

export type Side = 'CT' | 'T';
export type Logical = 'home' | 'away';
export type Phase = 'freeze' | 'live' | 'intermission' | 'paused' | 'timeout' | 'ended' | 'knife' | 'tech_timeout';
export type Sides = { home: Side; away: Side };

@Injectable()
export class MatchStateService {
  private readonly log = new Logger(MatchStateService.name);
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Server ↔ Match binding
  // ─────────────────────────────────────────────────────────────────────────────
  async setServerMatch(serverId: string, matchId: string, ttlSec?: number) {
    const key = redisConst.serverMatchid(serverId);
    if (ttlSec && ttlSec > 0) {
      await this.redis.set(key, matchId, 'EX', ttlSec);
    } else {
      await this.redis.set(key, matchId);
    }
  }
  async getServerMatch(serverId: string): Promise<string | null> {
    return (await this.redis.get(redisConst.serverMatchid(serverId))) as string | null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sides (source de vérité)
  // Stockage cible: HASH {home:'CT'|'T', away:'CT'|'T'}
  // Compat: on migre depuis l’ancien SET JSON si détecté.
  // ─────────────────────────────────────────────────────────────────────────────
  async setSides(matchId: string, sides: Sides) {
    await this.redis.hset(redisConst.sides(matchId), { home: sides.home, away: sides.away });
  }

  async getSides(matchId: string): Promise<Sides | null> {
    const key = redisConst.sides(matchId);

    // 1) Essaye HASH (nouveau format)
    const h = await this.redis.hgetall(key);
    if (h && (h.home || h.away)) {
      if (isSide(h.home) && isSide(h.away)) return { home: h.home, away: h.away };
      this.log.warn(`Invalid sides hash for ${matchId}: ${JSON.stringify(h)}`);
      return null;
    }

    // 2) Back-compat: ancien format SET JSON ; migre si présent
    const json = await this.redis.get(key);
    if (json) {
      try {
        const obj = JSON.parse(json) as Sides;
        if (isSide(obj?.home) && isSide(obj?.away)) {
          // migre vers HASH puis supprime l’ancien JSON (pas obligatoire)
          await this.redis.hset(key, { home: obj.home, away: obj.away });
          await this.redis.del(key); // supprime la string (évite ambiguïté)
          return obj;
        }
      } catch (e) {
        this.log.warn(`Failed to parse legacy sides for ${matchId}: ${e}`);
      }
    }

    return null;
  }

  async swapSides(matchId: string): Promise<boolean> {
    const key = redisConst.sides(matchId);
    const h = await this.redis.hgetall(key);
    if (!h?.home || !h?.away) return false;
    await this.redis.hset(key, { home: h.away, away: h.home });
    return true;
  }

  async sideToLogical(matchId: string, side: Side): Promise<Logical | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    if (side === s.home) return 'home';
    if (side === s.away) return 'away';
    return null;
  }

  async logicalToSide(matchId: string, logical: Logical): Promise<Side | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    return logical === 'home' ? s.home : s.away;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Score & phase (hash unique: 't','ct','round','phase')
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

  async addPoint(matchId: string, winner: Side) {
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Timeouts / pauses (logical-based: home/away)
  // ─────────────────────────────────────────────────────────────────────────────
  async initTimeouts(matchId: string, homeTac = 4, awayTac = 4, homeTech = 0, awayTech = 0) {
    await this.redis.hset(redisConst.timeouts(matchId), {
      home_tac: String(homeTac),
      away_tac: String(awayTac),
      home_tech: String(homeTech),
      away_tech: String(awayTech),
    });
  }
  

  private static readonly DEC_IF_POS_LUA = `
    local key = KEYS[1]
    local field = ARGV[1]
    local cur = redis.call('HGET', key, field)
    if not cur then return -1 end
    cur = tonumber(cur)
    if cur <= 0 then return 0 end
    redis.call('HINCRBY', key, field, -1)
    return cur - 1
  `;

  /** Décrémente un timeout tactique de la logical team. Retour: -1 absent, 0 épuisé, >0 nouveau solde */
  async decrTac(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}_tac`;
    const remain = await this.redis.eval(MatchStateService.DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  /** Décrémente un timeout technique de la logical team. */
  async decrTech(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}_tech`;
    const remain = await this.redis.eval(MatchStateService.DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  async getTimeouts(matchId: string): Promise<{ home_tac: number; away_tac: number; home_tech: number; away_tech: number }> {
    const res = await this.redis.hgetall(redisConst.timeouts(matchId));
    return {
      home_tac: toInt(res?.home_tac),
      away_tac: toInt(res?.away_tac),
      home_tech: toInt(res?.home_tech),
      away_tech: toInt(res?.away_tech),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Teams (optionnel) — noms/ids pour UI
  // ─────────────────────────────────────────────────────────────────────────────
  async setTeams(matchId: string, ids: { home_id?: string; away_id?: string; ct_id?: string; t_id?: string; home_name?: string; away_name?: string; ct_name?: string; t_name?: string }) {
    // stocke seulement ce qu’on te donne (utile pour mises à jour partielles)
    const key = redisConst.teams(matchId);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(ids)) {
      if (v != null) fields[k] = String(v);
    }
    if (Object.keys(fields).length) await this.redis.hset(key, fields);
  }

  async getScoreWithTeams(matchId: string) {
    const [t, ct] = await this.redis.hmget(redisConst.score(matchId), 't', 'ct');
    const team = await this.redis.hgetall(redisConst.teams(matchId));
    return {
      matchId,
      score: { t: toInt(t), ct: toInt(ct) },
      teams: {
        ct:   { id: team.ct_id ?? null,   name: team.ct_name ?? 'CT' },
        t:    { id: team.t_id ?? null,    name: team.t_name ?? 'T' },
        home: team.home_name ? { id: team.home_id ?? null, name: team.home_name } : undefined,
        away: team.away_name ? { id: team.away_id ?? null, name: team.away_name } : undefined,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Snapshot global (pratique pour debug/UI admin)
  // ─────────────────────────────────────────────────────────────────────────────
  async getSnapshot(matchId: string) {
    const [sides, scoreHash, timeouts, teams] = await Promise.all([
      this.getSides(matchId),
      this.redis.hgetall(redisConst.score(matchId)),
      this.redis.hgetall(redisConst.timeouts(matchId)),
      this.redis.hgetall(redisConst.teams(matchId)),
    ]);
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
        home_tac: toInt(timeouts?.home_tac),
        away_tac: toInt(timeouts?.away_tac),
        home_tech: toInt(timeouts?.home_tech),
        away_tech: toInt(timeouts?.away_tech),
      },
      teams: {
        ct_id: teams?.ct_id ?? null,
        t_id: teams?.t_id ?? null,
        home_id: teams?.home_id ?? null,
        away_id: teams?.away_id ?? null,
        ct_name: teams?.ct_name ?? 'CT',
        t_name: teams?.t_name ?? 'T',
        home_name: teams?.home_name ?? null,
        away_name: teams?.away_name ?? null,
      },
    };
  }
}

// ───────────── helpers ─────────────
function isSide(s: any): s is Side {
  return s === 'CT' || s === 'T';
}
function toInt(v: string | null | undefined): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}
