// src/application/services/match-phase.service.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst } from '../state/redis-keys';
import { MatchCommandsService } from '@app/commands/match-commands.service';

import type { Phase} from '@domain/phase.types';

@Injectable()
export class MatchPhaseService {
  private readonly logger = new Logger(MatchPhaseService.name);
  private timers = new Map<string, NodeJS.Timeout>(); // par matchId

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
        @Inject(forwardRef(() => MatchCommandsService))
    private readonly mcs: MatchCommandsService, 
  ) {}

  async isBothReady(matchId: string): Promise<boolean> {
    const h = await this.redis.hgetall(redisConst.ready(matchId)); // "ready" => ta clé hset(home/away)
    return h.home === '1' && h.away === '1';
  }

  async startPhaseCountdown(matchId: string, nextPhase: Phase, seconds = 5, serverId?: string) {
    const lockKey = redisConst.phaseLock(matchId);
    const pendingKey = redisConst.phasePending(matchId);

    // 1) Try lock (évite doublons). TTL = seconds + marge.
  // lock: SET key value EX ttl NX
  const got = await this.redis.set(
    lockKey,
    String(Date.now()),
    'EX',
    seconds + 10,
    'NX',
  ); // 'OK' si lock acquis, sinon null

  if (!got) return; // un countdown est déjà en cours

  // pending: SET key value EX ttl
  await this.redis.set(
    pendingKey,
    nextPhase,
    'EX',
    seconds + 15,
  );

    // 3) double-check ready + pas en pause
    if (!(await this.isBothReady(matchId)) || (await this.isMatchPaused(matchId))) {
      await this.cancelPhaseCountdown(matchId, 'not_ready_or_paused');
      return;
    }

    // 4) boucle 1s
    let remain = seconds;

    // 4.a message initial
    if (serverId) await this.mcs.say({ serverId, message: `Début de ${nextPhase} dans ${remain} secondes…` });
    await this.pub.publish('ggbot:events', JSON.stringify({
        v: 1,
        type: 'phase:countdown',
        matchId,
        serverId,
        timestamp: Date.now(),
        source: 'system',
        kind: 'primary',
        payload: { nextPhase, remain },
        }));

    const tick = async () => {
      remain -= 1;

      // Garder le lock "vivant" (optionnel): on peut le prolonger
      await this.redis.expire(lockKey, remain + 10);
      await this.redis.expire(pendingKey, remain + 12);

      // Conditions d’annulation
      if (!(await this.isBothReady(matchId))) {
        await this.cancelPhaseCountdown(matchId, 'team_unready');
        return;
      }
      if (await this.isMatchPaused(matchId)) {
        await this.cancelPhaseCountdown(matchId, 'paused');
        return;
      }
      const stillLocked = await this.redis.get(lockKey);
      if (!stillLocked) {
        // lock perdu → une autre instance a pris la main
        await this.cancelPhaseCountdown(matchId, 'lock_lost', { keepPending: false });
        return;
      }

      if (remain > 0) {
        if (serverId) await this.mcs.say({ serverId, message: `Début de ${nextPhase} dans ${remain}…` });
        await this.pub.publish('ggbot:events', JSON.stringify({
            v: 1,
            type: 'phase:countdown',
            matchId,
            serverId,
            timestamp: Date.now(),
            source: 'system',
            kind: 'primary',
            payload: { nextPhase, remain },
            }));
         const t = setTimeout(tick, 1000);
         this.timers.set(matchId, t);
         return;
      }

      // 5) countdown terminé → appliquer la phase
      await this.applyPhase(matchId, nextPhase, serverId);
    };

    const t = setTimeout(tick, 1000);
    this.timers.set(matchId, t);
  }

  async cancelPhaseCountdown(
    matchId: string,
    reason: 'team_unready' | 'paused' | 'not_ready_or_paused' | 'lock_lost' | 'manual',
    opts?: { keepPending?: boolean }
  ) {
    const lockKey = redisConst.phaseLock(matchId);
    const pendingKey = redisConst.phasePending(matchId);

    const t = this.timers.get(matchId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(matchId);
    }

    await this.redis.del(lockKey);
    if (!opts?.keepPending) await this.redis.del(pendingKey);

    await this.pub.publish('ggbot:events', JSON.stringify({
        v: 1,
        type: 'phase:cancelled',
        matchId,
        timestamp: Date.now(),
        source: 'system',
        kind: 'primary',
        }));
    this.logger.debug(`[${matchId}] countdown cancelled: ${reason}`);
  }

  private async applyPhase(matchId: string, phase: Phase, serverId?: string) {
    const lockKey = redisConst.phaseLock(matchId);
    const pendingKey = redisConst.phasePending(matchId);
    const phaseKey = redisConst.phase(matchId);

    // set phase
    await this.redis.set(phaseKey, phase);
    await this.redis.del(lockKey, pendingKey);

    // notifier
    await this.pub.publish('ggbot:events', JSON.stringify({
            v: 1,
            type: 'phase:changed',
            matchId,
            serverId,
            timestamp: Date.now(),
            source: 'system',
            kind: 'primary',
            payload: { phase},
            }));
    
    if (serverId) await this.mcs.say({ serverId, message: `➡️ Phase: ${phase}` });

    // exécuter la logique dédiée (ex: restart, knife, live, etc.)
    await this.runPhase(matchId, phase, serverId);
  }

  // À adapter : si tu as déjà une gestion pause en Redis
  private async isMatchPaused(matchId: string): Promise<boolean> {
    const pause = await this.redis.hget(redisConst.pause(matchId), 'state'); // ex: "paused"|"none"
    return pause === 'paused';
  }

  // Route la logique (tu peux déplacer ceci ailleurs si tu préfères)
  private async runPhase(matchId: string, phase: Phase, serverId?: string) {
    switch (phase) {
      case 'knife':
        await this.mcs.runKnife(matchId, serverId);
        break;
      case 'live':
        await this.mcs.runLive(matchId, serverId); // (ex: mp_restartgame 1, say "live in 3..2..1")
        break;
      case 'halftime':
        await this.mcs.runHalftime(matchId, serverId);
        break;
      case 'overtime':
        await this.mcs.runOvertime(matchId, serverId);
        break;
      case 'postgame':
        await this.mcs.runPostgame(matchId, serverId);
        break;
    }
  }
}
