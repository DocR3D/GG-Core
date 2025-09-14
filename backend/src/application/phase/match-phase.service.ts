// src/application/services/match-phase.service.ts
import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst } from '../state/redis-keys';

import { MatchPhase, Phase} from '@domain/phase.types';
import { RuleRegistry } from '@app/rules/rule.registry';
import { ACTIONS_PORT, type ActionsPort } from '@app/ports/actions.port';
import { RuleContextFactory } from '@domain/rules/rule-context-factory';
import { EventTypes } from '@domain/types/event.types';

@Injectable()
export class MatchPhaseService {
  private readonly logger = new Logger(MatchPhaseService.name);
  private timers = new Map<string, NodeJS.Timeout>(); // par matchId
  private readonly phaseByMatch = new Map<string, MatchPhase>();
  private cache = new Map<string, MatchPhase>(); // 🔒 cache fort cohérent
  registry: any;

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    @Inject(ACTIONS_PORT) private readonly actions: ActionsPort,
    private readonly rcF: RuleContextFactory,   // OK une fois exporté + importé
  ) {}

  async isBothReady(matchId: string): Promise<boolean> {
    const h = await this.redis.hgetall(redisConst.ready(matchId)); // "ready" => ta clé hset(home/away)
    return h.home === '1' && h.away === '1';
  }
  async setReady(matchId: string, logical: 'home'|'away', ready: boolean) {
    await this.redis.hset(redisConst.ready(matchId), logical, ready ? 1 : 0);
  }

public async startPhaseCountdown(
  matchId: string,
  nextPhase: MatchPhase,
  seconds: number,
  serverId: string
): Promise<void> {
  const lockKey = redisConst.phaseLock(matchId);
  const pendingKey = redisConst.phasePending(matchId);

  let remain = Math.max(0, Math.floor(seconds ?? 0));

  // Lock (évite doublons)
  const got = await this.redis.set(lockKey, String(Date.now()), 'EX', remain + 10, 'NX');
  if (!got) return; // déjà en cours

  // Pending (phase cible)
  await this.redis.set(pendingKey, String(nextPhase), 'EX', remain + 15);

  // Si pas prêts/pausé, annule d’emblée
  if (!(await this.isBothReady(matchId)) || (await this.isMatchPaused(matchId))) {
    await this.cancelPhaseCountdown(matchId, 'not_ready_or_paused');
    return;
  }

  // 0s -> applique tout de suite
  if (remain === 0) {
    await this.pub.publish('ggbot:events', JSON.stringify({
      v: 1, type: 'phase:countdown', matchId, serverId, timestamp: Date.now(),
      source: 'system', kind: 'primary', payload: { nextPhase, remain: 0 },
    }));
    await this.applyPhase(matchId, nextPhase, serverId);
    this.timers.delete(matchId);
    return;
  }

  if (serverId) await this.actions.say({ serverId, message: `Début de ${nextPhase} dans ${remain} secondes…` });
  await this.pub.publish('ggbot:events', JSON.stringify({
    v: 1, type: 'phase:countdown', matchId, serverId, timestamp: Date.now(),
    source: 'system', kind: 'primary', payload: { nextPhase, remain },
  }));

  const tick = async () => {
    remain -= 1;

    await this.redis.expire(lockKey, remain + 10);
    await this.redis.expire(pendingKey, remain + 12);

    if (!(await this.isBothReady(matchId))) {
      await this.cancelPhaseCountdown(matchId, 'team_unready'); return;
    }
    if (await this.isMatchPaused(matchId)) {
      await this.cancelPhaseCountdown(matchId, 'paused'); return;
    }
    if (!(await this.redis.get(lockKey))) {
      await this.cancelPhaseCountdown(matchId, 'lock_lost', { keepPending: false }); return;
    }

    if (remain > 0) {
      if (serverId) await this.actions.say({ serverId, message: `Début de ${nextPhase} dans ${remain}…` });
      await this.pub.publish('ggbot:events', JSON.stringify({
        v: 1, type: 'phase:countdown', matchId, serverId, timestamp: Date.now(),
        source: 'system', kind: 'primary', payload: { nextPhase, remain },
      }));
      const t = setTimeout(tick, 1000);
      this.timers.set(matchId, t);
      return;
    }

    // Terminé
    await this.applyPhase(matchId, nextPhase, serverId);
    const t = this.timers.get(matchId);
    if (t) clearTimeout(t);
    this.timers.delete(matchId);
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

  private async applyPhase(matchId: string, phase: MatchPhase, serverId: string) {
    const lockKey = redisConst.phaseLock(matchId);
    const pendingKey = redisConst.phasePending(matchId);
    const phaseKey = redisConst.phase(matchId);

    // set phase
    await this.redis.set(phaseKey, phase);
    await this.redis.del(lockKey, pendingKey);

    // notifier
    await this.pub.publish('ggbot:events', JSON.stringify({
            v: 1,
            type: EventTypes.PHASE_CHANGED,
            matchId,
            serverId,
            timestamp: Date.now(),
            source: 'system',
            kind: 'primary',
            payload: { newPhase: phase, t: Date.now()},
            }));
    
    if (serverId) await this.actions.say({ serverId, message: `➡️ Phase: ${phase}` });

    
    // exécuter la logique dédiée (ex: restart, knife, live, etc.)
  }

  // À adapter : si tu as déjà une gestion pause en Redis
  private async isMatchPaused(matchId: string): Promise<boolean> {
    const pause = await this.redis.hget(redisConst.pause(matchId), 'state'); // ex: "paused"|"none"
    return pause === 'paused';
  }


  async getPhase(matchId: string): Promise<MatchPhase> {
    const cached = this.cache.get(matchId);
    if (cached) return cached;

    const key = redisConst.phase(matchId);
    const val = (await this.redis.get(key)) as MatchPhase | null;
    const phase = val ?? MatchPhase.WARMUP_MAIN;
    this.cache.set(matchId, phase);
    return phase;
  }

  async setPhase(matchId: string, phase: MatchPhase): Promise<void> {
    const key = redisConst.phase(matchId); // ⚠️ vérifie que c’est la même clé partout
    await this.redis.set(key, phase);
    this.cache.set(matchId, phase);
    this.logger.debug(`[setPhase] match=${matchId} -> ${phase}`);
  }
  
    /** Optionnel: transitions autorisées (anti-regression vers warmup_main) */
  canTransition(from: MatchPhase, to: MatchPhase): boolean {
    if (from === MatchPhase.KNIFE_LIVE && to === MatchPhase.WARMUP_MAIN) return false; // 🚫
    return true;
  }
}
