// application/shared/periodic/message-presets.ts
import type Redis from 'ioredis';
import { fmtMmSs } from './periodic-messenger.service';
import { redisConst } from '@app/match/state/redis.keys';

// Helpers ID/lock
const tacId = (m: string) => `pause:tac:${m}`;
const tecId = (m: string) => `pause:tec:${m}`;
const warmId = (m: string) => `warmup:${m}`;
const knifeId = (m: string) => `knifechoice:${m}`;
const lockKeyFor = (id: string) => `lock:periodic:${id}`;

// --- PAUSE TACTIQUE - messages banque restante
export function buildTacPauseSpec(opts: {
  matchId: string;
  serverId: string;
  redis: Redis;
  intervalMs?: number; // défaut 30_000
}) {
  const { matchId, serverId, redis, intervalMs = 30_000 } = opts;
  const id = tacId(matchId);
  const lockKey = lockKeyFor(id);

  return {
    id,
    intervalMs,
    serverId,
    lockKey,
    compute: async () => {
      const key = redisConst.pause(matchId);
      const h = await redis.hgetall(key);

      // DEBUG
      console.log(`[preset:tac] match=${matchId} state=${h.state} reason=${h.reason} team=${h.team} started_at=${h.started_at}`);

      if (h.state !== 'paused' || h.reason !== 'tactical') {
        console.log('[preset:tac] stop (not paused/tactical)');
        return { stop: true as const };
      }

      const team = h.team as 'home' | 'away';
      const startedAt = h.started_at ? parseInt(h.started_at, 10) : 0;
      const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

      const bankHome = parseInt(h.tac_bank_home ?? '0', 10);
      const bankAway = parseInt(h.tac_bank_away ?? '0', 10);

      const remaining =
        team === 'home'
          ? Math.max(0, bankHome - elapsed)
          : Math.max(0, bankAway - elapsed);

      console.log(`[preset:tac] elapsed=${elapsed}s remaining=${remaining}s bankH=${bankHome} bankA=${bankAway}`);

      return { text: `⏸ Tac ${team} - banque restante: ${fmtMmSs(remaining)}` };
    },
  };
}

// --- PAUSE TECHNIQUE - rappel sans durée
export function buildTecPauseSpec(opts: {
  matchId: string;
  serverId: string;
  redis: Redis;
  intervalMs?: number; // défaut 30_000
}) {
  const { matchId, serverId, redis, intervalMs = 30_000 } = opts;
  const id = tecId(matchId);
  const lockKey = lockKeyFor(id);

  return {
    id,
    intervalMs,
    serverId,
    lockKey,
    compute: async () => {
      const key = redisConst.pause(matchId);
      const h = await redis.hgetall(key);

      // DEBUG
      console.log(`[preset:tec] match=${matchId} state=${h.state} reason=${h.reason} team=${h.team}`);

      if (h.state !== 'paused' || h.reason !== 'technical') {
        console.log('[preset:tec] stop (not paused/technical)');
        return { stop: true as const };
      }

      const team = (h.team as 'home' | 'away') ?? 'system';
      return { text: `⏸ Tec ${team} - pas de durée de fin` };
    },
  };
}

// --- WARMUP - annonce ready/unready
export function buildWarmupReadySpec(opts: {
  matchId: string;
  serverId: string;
  redis: Redis;
  intervalMs?: number; // ex: 20_000
}) {
  const { matchId, serverId, redis, intervalMs = 20_000 } = opts;
  const id = warmId(matchId);
  const lockKey = lockKeyFor(id);

  return {
    id,
    intervalMs,
    serverId,
    lockKey,
    compute: async () => {
      const rh = await redis.hgetall(redisConst.ready(matchId)); // { home: '0|1', away: '0|1' }
      const home = rh.home === '1';
      const away = rh.away === '1';

      if (home && away) {
        console.log('[preset:warmup] stop (both ready)');
        return { stop: true as const }; // les deux sont prêts → on arrête
      }

      const msg = [
        !home ? '🏠 home: !ready' : '🏠 home: prêt',
        !away ? '🚩 away: !ready' : '🚩 away: prêt',
      ].join(' • ');

      return { text: `🔧 Warmup - ${msg}` };
    },
  };
}

// --- POST-KNIFE - invite à choisir swap/stay
export function buildKnifeChoiceSpec(opts: {
  matchId: string;
  serverId: string;
  redis: Redis;
  intervalMs?: number; // ex: 15_000
}) {
  const { matchId, serverId, redis, intervalMs = 15_000 } = opts;
  const id = knifeId(matchId);
  const lockKey = lockKeyFor(id);

  return {
    id,
    intervalMs,
    serverId,
    lockKey,
    compute: async () => {
      const phase = await redis.get(redisConst.phase(matchId));
      if (phase && phase !== 'knife_choice') {
        console.log('[preset:knife] stop (phase changed)');
        return { stop: true as const };
      }

      const winner = await redis.get(redisConst.knifeWinner(matchId));
      const who = winner ?? '?';

      return { text: `🔪 Knife gagné par ${who} - tapez !swap ou !stay` };
    },
  };

  
}
