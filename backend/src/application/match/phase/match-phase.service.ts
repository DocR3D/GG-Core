// src/application/services/match-phase.service.ts
import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { redisConst } from '@app/match/state/redis-keys';

import { MatchPhase, Phase, RoundPhase} from '@domain/phase.types';
import { ACTIONS_PORT, type ActionsPort } from '@app/ports/actions.port';
import { RuleContextFactory } from '@domain/rules/rule-context-factory';
import { EventTypes } from '@domain/types/event.types';
import { PauseMatchService } from '../pause/pause-match.service';
import { BaseRule } from '@domain/rules';
import { MessageService } from '../messages/message.service';
import { RuleRegistry } from '../rules/rule.registry';

@Injectable()
export class MatchPhaseService {

  private readonly logger = new Logger(MatchPhaseService.name);
  private timers = new Map<string, NodeJS.Timeout>(); // par matchId
  private readonly phaseByMatch = new Map<string, MatchPhase>();
  private cache = new Map<string, MatchPhase>(); // 🔒 cache fort cohérent

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    @Inject(ACTIONS_PORT) private readonly actions: ActionsPort,
    private readonly rcF: RuleContextFactory,   // OK une fois exporté + importé
    private readonly pauseMatchService: PauseMatchService,
    private readonly messageService: MessageService,
    private readonly registry: RuleRegistry,
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
  serverId: string,
): Promise<void> {
  const lockKey = redisConst.phaseLock(matchId);
  const pendingKey = redisConst.phasePending(matchId);

  let remain = Math.max(0, Math.floor(seconds ?? 0));

  // Lock anti-doublon (TTL = remain + 10s)
  const got = await this.redis.set(lockKey, String(Date.now()), 'EX', remain + 10, 'NX');
  if (!got) return;

  // Marque la phase cible (pending)
  await this.redis.set(pendingKey, String(nextPhase), 'EX', remain + 15);

  // Préconditions
  const ready = await this.isBothReady(matchId);
  const paused = await this.pauseMatchService.isPaused(matchId);
  if (!ready || paused) {
    await this.cancelPhaseCountdown(matchId, 'not_ready_or_paused');
    return;
  }

  // Helper: annoncé seulement à 60/30/20/10 et 5..1 (évite le spam)
  const shouldAnnounce = (t: number) =>
    t <= 5 || t === 10 || t === 20 || t === 30 || t === 60;

  // Annonce initiale
  if (serverId && shouldAnnounce(remain) && remain > 0) {
    await this.actions.say(serverId, `Début de ${nextPhase} dans ${remain}s…`);
  }
  await this.pub.publish('ggbot:events', JSON.stringify({
    v: 1, type: 'phase:countdown', matchId, serverId, timestamp: Date.now(),
    source: 'system', kind: 'primary', payload: { nextPhase, remain },
  }));

  // Si compte à rebours nul → transition immédiate
  if (remain === 0) {
    await this.applyPhase(matchId, nextPhase, serverId);
    const t0 = this.timers.get(matchId);
    if (t0) clearTimeout(t0);
    this.timers.delete(matchId);
    return;
  }

  // Boucle 1s via setTimeout (compatible avec ton cancel qui clearTimeout) :contentReference[oaicite:1]{index=1}
  const tick = async () => {
    remain -= 1;

    // Prolonge les TTLs pendant le compte
    await this.redis.expire(lockKey, remain + 10);
    await this.redis.expire(pendingKey, remain + 12);

    // Conditions d’annulation / gel
    if (!(await this.isBothReady(matchId))) {
      await this.cancelPhaseCountdown(matchId, 'team_unready', { keepPending: true }); return;
    }
    if (await this.pauseMatchService.isPaused(matchId)) {
      await this.cancelPhaseCountdown(matchId, 'paused', { keepPending: true }); return;
    }
    if (!(await this.redis.get(lockKey))) {
      await this.cancelPhaseCountdown(matchId, 'lock_lost', { keepPending: false }); return;
    }

    // Encore du temps → annonce + event
    if (remain > 0) {
      if (serverId && shouldAnnounce(remain)) {
        await this.actions.say(serverId, `Début de ${nextPhase} dans ${remain}s…`);
      }
      await this.pub.publish('ggbot:events', JSON.stringify({
        v: 1, type: 'phase:countdown', matchId, serverId, timestamp: Date.now(),
        source: 'system', kind: 'primary', payload: { nextPhase, remain },
      }));
      // replanifie le tick
      const t = setTimeout(tick, 1000);
      this.timers.set(matchId, t);
      return;
    }

    // Terminé → applique la phase (ne démarre PAS les messages automatiques ici)
    await this.applyPhase(matchId, nextPhase, serverId);

    const t = this.timers.get(matchId);
    if (t) clearTimeout(t);
    this.timers.delete(matchId);
  };

  // Démarre la boucle
  const t = setTimeout(tick, 1000);
  this.timers.set(matchId, t);
}








// utilitaire
private clearTimersForGroup(groupId: string) {
  for (const [key, int] of this.timers.entries()) {
    if (key.startsWith(groupId)) {
      clearInterval(int as NodeJS.Timeout);
      this.timers.delete(key);
    }
  }
}
public async cancelPhaseCountdown(
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

  // Stop des messages potentiellement armés pour la phase pending
  const pending = (await this.redis.get(pendingKey)) as MatchPhase | null;
  if (pending) {
    this.messageService.stop(matchId, pending);
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


private async applyPhase(
  matchId: string,
  newPhase: MatchPhase,
  serverId: string,
): Promise<void> {
  const lockKey = redisConst.phaseLock(matchId);
  const pendingKey = redisConst.phasePending(matchId);
  const phaseKey = redisConst.phase(matchId);

  // 0) Coup de balai global (garanti zéro fuite)
  this.messageService.stopPhaseGroups(matchId);

  // 1) Écrire la nouvelle phase + nettoyer lock/pending
  await this.redis.set(phaseKey, newPhase);
  await this.redis.del(lockKey, pendingKey);

  // 2) Démarrer les messages de la NOUVELLE phase
  const rule = this.registry.getRule(newPhase);
  if (serverId && rule?.say) {
    const spec = await rule.say(this.rcF.make({matchId,serverId}));
    if (spec) this.messageService.startPhase(matchId, newPhase, serverId, spec);
  }

  // 3) Diffuse l’événement + feedback ingame
  await this.pub.publish('ggbot:events', JSON.stringify({
    v: 1,
    type: EventTypes.PHASE_CHANGED,
    matchId,
    serverId,
    timestamp: Date.now(),
    source: 'system',
    kind: 'primary',
    payload: { newPhase, t: Date.now() },
  }));

  if (serverId) {
    await this.actions.say(serverId, `➡️ Phase: ${newPhase}`);
  }

  this.logger.log(`[${matchId}] phase changed → ${newPhase} (stopAll applied)`);
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

  async setRoundPhase(matchId: string, roundPhase: RoundPhase) {
    const key = redisConst.phase(matchId);
    await this.redis.set(key, roundPhase);
  }

  async getRoundPhase(matchId: string): Promise<RoundPhase> {
    const key = redisConst.phase(matchId);
    return (await this.redis.get(key)) as RoundPhase ?? RoundPhase.WARMUP;
  }
}
