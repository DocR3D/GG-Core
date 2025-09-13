// src/application/services/match-phase.service.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst } from '../state/redis-keys';
import { MatchCommandsService } from '@app/commands/match-commands.service';

import { MatchPhase, Phase} from '@domain/phase.types';
import { RuleRegistry } from '@app/rules/rule.registry';
import { BaseRule } from '@domain/rules';
import { ACTIONS_PORT, type ActionsPort } from '@app/ports/actions.port';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class MatchPhaseService {
  private readonly logger = new Logger(MatchPhaseService.name);
  private timers = new Map<string, NodeJS.Timeout>(); // par matchId
  private rules!: RuleRegistry; // sera résolu après boot
  private readonly phaseByMatch = new Map<string, MatchPhase>();

constructor(
  @Inject(REDIS_CMD) private readonly redis: Redis,
  @Inject(REDIS_PUB) private readonly pub: Redis,
  @Inject(ACTIONS_PORT) private readonly actions: ActionsPort,
      private readonly moduleRef: ModuleRef,            // ⬅️ NEW
) {
}
  onModuleInit() {
    // strict:false = autorise la recherche “dans les parents”
    this.rules = this.moduleRef.get(RuleRegistry, { strict: false });
    if (!this.rules) {
      this.logger.error('RuleRegistry introuvable (ModuleRef). Vérifie RulesModule dans AppModule.');
    }
  }

  async isBothReady(matchId: string): Promise<boolean> {
    const h = await this.redis.hgetall(redisConst.ready(matchId)); // "ready" => ta clé hset(home/away)
    return h.home === '1' && h.away === '1';
  }

public async startPhaseCountdown(
  matchId: string,
  nextPhase: MatchPhase,
  seconds: number,
  serverId?: string
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

  private async applyPhase(matchId: string, phase: MatchPhase, serverId?: string) {
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
    
    if (serverId) await this.actions.say({ serverId, message: `➡️ Phase: ${phase}` });

    // exécuter la logique dédiée (ex: restart, knife, live, etc.)
    await this.runPhase(matchId, phase, serverId);
  }

  // À adapter : si tu as déjà une gestion pause en Redis
  private async isMatchPaused(matchId: string): Promise<boolean> {
    const pause = await this.redis.hget(redisConst.pause(matchId), 'state'); // ex: "paused"|"none"
    return pause === 'paused';
  }

  // Route la logique (tu peux déplacer ceci ailleurs si tu préfères)
  private async runPhase(matchId: string, phase: MatchPhase, serverId?: string) {
    this.phaseByMatch.set(matchId, phase);
    const rule = this.rules.getRule(phase);
    await rule.onStart?.({ matchId, phase, ts: Date.now() });
  }

  async getPhase(matchId: string): Promise<MatchPhase> {
    // 1) cache mémoire
    const cached = this.phaseByMatch.get(matchId);
    if (cached) return cached;

    // 2) lire directement Redis
    const raw = await this.redis.get(redisConst.phase(matchId));
    const phase = (raw as MatchPhase) || MatchPhase.WARMUP_MAIN;

    // 3) mettre en cache et retourner
    this.phaseByMatch.set(matchId, phase);
    return phase;
  }
}
