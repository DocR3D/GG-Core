import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis-keys';
export type GameSide = 'CT' | 'T' | 'TERRORIST';
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
      await this.redis.set(redisConst.matchServer(matchId), serverId, 'EX', ttlSec);
    } else {
      await this.redis.set(key, matchId);
      await this.redis.set(redisConst.matchServer(matchId), serverId);    }
  }
  async getMatchIdFromServerId(serverId: string): Promise<string | undefined> {
    const key = this.serverMatchKey(serverId);
    return (await this.redis.get(key)) as string | undefined;
  }

  async getServerIdFromMatchId(matchId: string): Promise<string | undefined> {
    // Exemple : tu récupères les agents actifs
    const agentsKeys = await this.redis.keys('server:*:currentMatch');
    for (const key of agentsKeys) {
      const sid = key.split(':')[1]; // server:<sid>:currentMatch
      const mid = await this.redis.get(key);
      if (mid === matchId) return sid;
    }
    return undefined;
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

  async swapSides(matchId: string) {
    const sidesKey  = redisConst.sides(matchId);
    const choiceKey = redisConst.knifeChoice(matchId);

    // Vérifie le choix
    const choice = await this.redis.get(choiceKey);
    if (choice && choice !== 'pending') return { ok: false, reason: 'already_chosen' };

    // CAS avec WATCH
    await this.redis.watch(sidesKey);
    const h = await this.redis.hgetall(sidesKey);
    const isSide = (v?: string): v is 'CT'|'T' => v === 'CT' || v === 'T';
    if (!isSide(h?.home) || !isSide(h?.away) || h.home === h.away) {
      await this.redis.unwatch();
      return { ok: false, reason: 'invalid_sides' };
    }

    const tx = this.redis.multi();
    tx.hset(sidesKey, { home: h.away, away: h.home });
    tx.set(choiceKey, 'switch');
    const exec = await tx.exec(); // null si conflit
    if (!exec) return { ok: false, reason: 'conflict' };
    return { ok: true, home: h.away as 'CT'|'T', away: h.home as 'CT'|'T' };
  }


  async sideToLogical(matchId: string, side: GameSide): Promise<Logical | null> {
    if(side == 'TERRORIST') side = "T";
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
    if(winner == 'TERRORIST') winner = "T";
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

  async applyKnifeResult(matchId: string, winnerSide: 'CT' | 'T') {
  // 1) lire le mapping des sides actuels pour dériver home/away
  const sidesKey = redisConst.sides(matchId);
  const [homeSide, awaySide] = await this.redis.hmget(sidesKey, 'home', 'away'); // ex: ['CT','T']

  // 2) déterminer le logical gagnant
  const winnerLogical: 'home' | 'away' =
    winnerSide === homeSide ? 'home'
    : winnerSide === awaySide ? 'away'
    : (() => { throw new Error(`[KnifeRule] Incohérence sides winnerSide=${winnerSide} home=${homeSide} away=${awaySide}`) })();

  // 3) écrire en une transaction
  const kSide    = redisConst.knifeWinnerSide(matchId);
  const kLogical = redisConst.knifeWinnerLogical(matchId);
  const kChoice  = redisConst.knifeChoice(matchId);

  await this.redis
    .multi()
    .set(kSide, winnerSide)
    .set(kLogical, winnerLogical)
    .set(kChoice, 'pending') // l’équipe gagnante devra faire !stay ou !switch
    .exec();

  }

  async getKnifeWinner(matchId: string): Promise<{
    side: GameSide | null;
    logical: Logical | null;
  }> {
    const [sideRaw, logicalRaw] = await this.redis.mget(
      redisConst.knifeWinnerSide(matchId),
      redisConst.knifeWinnerLogical(matchId),
      redisConst.knifeChoice(matchId),
    );

    let side = (sideRaw as GameSide) ?? null;
    let logical = (logicalRaw as Logical) ?? null;

    // Si tu n’avais stocké que le side, on peut dériver logical via le mapping courant
    if (!logical && side) {
      const [homeSide, awaySide] = await this.redis.hmget(redisConst.sides(matchId), 'home', 'away');
      if (side === homeSide) logical = 'home';
      else if (side === awaySide) logical = 'away';
    }

    return { side, logical};
  }
}

// ───────────── helpers ─────────────
function isSide(s: any): s is GameSide {
  return s === 'CT' || s === 'T';
}
function toInt(v: string | null | undefined): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}
