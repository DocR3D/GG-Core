// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import type { AnyEvent, PhaseChangeEvent } from '@domain/types/match.event';
import { RuleRegistry } from '@app/match/rules/rule.registry';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { RuleContextFactory } from '@domain/rules/rule-context-factory';
import { EventTypes } from '@domain/types/event.types';
import { redisConst } from '@app/match/state/redis-keys';
import { RedisSafeService } from '@adapters/redis/redis.service';
import { MatchPhase } from '@domain/phase.types';
import { MatchOrchestrator } from '@app/match/match-orchestrator.services';

@Injectable()
export class MatchEventsHandler {
  private readonly logger = new Logger(MatchEventsHandler.name);

  constructor(
    private readonly registry: RuleRegistry,
    private readonly phase: MatchPhaseService,
    private readonly mss: MatchStateService,          // pour quelques effets globaux (pause…)
    private readonly matchOrchestrator: MatchOrchestrator,          // pour quelques effets globaux (pause…)
    private readonly ctxFactory: RuleContextFactory,  // construit RuleContext { matchId, serverId, ... }
    private readonly redisSafe: RedisSafeService,
  ) {}

async handle(ev: AnyEvent & { serverId?: string }): Promise<void> {
    try {
      // 0) Normalise / résout le matchId (gère "unknown")
      let matchId: string | undefined =
        ev.matchId && ev.matchId !== 'unknown' ? ev.matchId : undefined;

      if (!matchId && ev.serverId) {
        const resolved = await this.mss.getMatchIdFromServerId(ev.serverId); // string | undefined
        if (resolved) {
          matchId = resolved;
          (ev as any).matchId = resolved; // normalise l’event pour la suite de la chaîne
        }
      }
      if (!matchId) return;

      // 1) Ignore les events non-primaires si flag présent
      if ((ev as any).kind && (ev as any).kind !== 'primary') return;

      // 2) Cas spécial: changement de phase
      if (ev.type === EventTypes.PHASE_CHANGED) {
        const { newPhase } = (ev as PhaseChangeEvent).payload ?? {};
        if (!newPhase) throw new Error('PHASE_CHANGE sans payload.newPhase');

        // a) Sortie propre de l’ancienne phase
        const oldPhase = await this.phase.getPhase(matchId);
        const oldRule  = this.registry.getRule(oldPhase);
        if (oldRule?.onExit) {
          const ctxOld = await this.ctxFactory.make({ matchId, serverId: ev.serverId });
          await oldRule.onExit(ctxOld);
        }

        // b) Transition (écriture centralisée + cache)
        // Optionnel: garde-fou anti régression
        if (typeof this.phase.canTransition === 'function' &&
            !this.phase.canTransition(oldPhase, newPhase as MatchPhase)) {
          this.logger.warn(`[MatchEventsHandler] refused transition ${oldPhase} -> ${newPhase} match=${matchId}`);
          return;
        }

        await this.phase.setPhase(matchId, newPhase as MatchPhase);

        // c) Entrée dans la nouvelle phase
        const newRule = this.registry.getRule(newPhase as MatchPhase);
        if (newRule?.onEnter) {
          const ctxNew = await this.ctxFactory.make({ matchId, serverId: ev.serverId });
          this.logger.debug(`[MatchEventsHandler] enter phase=${newPhase} match=${matchId}`);
          await newRule.onEnter(ctxNew);
        }
        return;
      }

      // [DEBUG facultatif] Vérifie cohérence cache/redis pour la phase
      // (désactive après debug)
      try {
        const key = redisConst.phase(matchId);
        const raw = await this.redisSafe.get(key);
        const cached = (this.phase as any)?.cache?.get?.(matchId);
        this.logger.verbose(`[MatchEventsHandler] phase-check match=${matchId} cache=${cached} redis=${raw}`);
      } catch { /* noop debug */ }
      switch (ev.type) {
        case EventTypes.ROUND_START:
          this.matchOrchestrator.onRoundStart(ev);
          break;
        case EventTypes.BOMB_PLANTED:
          this.matchOrchestrator.onBombPlanted(ev);
          break;
        case EventTypes.TEAM_ROUND_WIN:
          this.matchOrchestrator.onRoundEnd(ev);
          break;
        case EventTypes.ROUND_FREEZE_START:
          this.matchOrchestrator.onFreezeTimeStart(ev);
          break;
        default:
          break;
      }
      // 3) Flux normal: dispatch vers la règle en cours
      const phase = await this.phase.getPhase(matchId);
      const rule  = this.registry.getRule(phase);
      if (!rule) {
        this.logger.verbose(`[MatchEventsHandler] no rule for phase=${phase} (type=${ev.type})`);
        return;
      }

      // Autorise si la règle expose un handler explicite OU si canHandle le permet
      const hasExplicitHandler =
        typeof (rule as any)?.events?.get === 'function' &&
        (rule as any).events.has(ev.type);

      const can =
        typeof (rule as any)?.canHandle === 'function' &&
        (rule as any).canHandle(ev.type);

      if (!hasExplicitHandler && !can) {
        this.logger.verbose(
          `[MatchEventsHandler] rule(${(rule as any)?.name ?? '?'}) ignores ${ev.type} in phase=${phase}`,
        );
        return;
      }

      const ctx = await this.ctxFactory.make({ matchId, serverId: ev.serverId });
      this.logger.debug(
        `[MatchEventsHandler] → ${(rule as any)?.name ?? 'rule'}.${ev.type} match=${matchId}`,
      );

      try {
        if (hasExplicitHandler) {
          const fn = (rule as any).events.get(ev.type);
          await fn(ev, ctx);
        } else if (typeof (rule as any).handle === 'function') {
          await (rule as any).handle(ev, ctx);
        }
      } catch (err) {
        this.logger.error(
          `[MatchEventsHandler] rule dispatch failed: phase=${phase} type=${ev.type} match=${matchId} err=${(err as Error)?.stack ?? err}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `MatchEventsHandler failed: type=${(ev as any)?.type} match=${(ev as any)?.matchId} err=${(e as Error)?.message}`,
      );
    }


  }


}
