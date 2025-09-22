// src/application/subscribers/phase-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent, PhaseChangeEvent } from '@domain/events/match.event';
import { RuleRegistry } from '@app/match/rules/rule.registry';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';
import { RuleContextFactory } from '@app/rules/rule-context.factory';
import { MatchPhase } from '@domain/phase.types';

@Injectable()
export class PhaseEventsHandler {
  private readonly logger = new Logger(PhaseEventsHandler.name);
  constructor(
    private readonly registry: RuleRegistry,
    private readonly phase: MatchPhaseService,
    private readonly ctxFactory: RuleContextFactory,
  ) {}

  async handle(ev: AnyEvent & { serverId?: string; matchId: string }): Promise<boolean> {
    if (ev.type !== EventTypes.PHASE_CHANGED) return false;

    const { newPhase } = (ev as PhaseChangeEvent).payload ?? {};
    if (!newPhase) throw new Error('PHASE_CHANGE sans payload.newPhase');

    const oldPhase = await this.phase.getPhase(ev.matchId);
    const oldRule  = this.registry.getRule(oldPhase);

    if (oldRule?.onExit) {
      const ctxOld = await this.ctxFactory.make({ matchId: ev.matchId, serverId: ev.serverId });
      await oldRule.onExit(ctxOld);
    }

    if (typeof this.phase.canTransition === 'function' &&
        !this.phase.canTransition(oldPhase, newPhase as MatchPhase)) {
      this.logger.warn(`[PhaseEventsHandler] refused transition ${oldPhase} -> ${newPhase} match=${ev.matchId}`);
      return true;
    }

    await this.phase.setPhase(ev.matchId, newPhase as MatchPhase);

    const newRule = this.registry.getRule(newPhase as MatchPhase);
    if (newRule?.onEnter) {
      const ctxNew = await this.ctxFactory.make({ matchId: ev.matchId, serverId: ev.serverId });
      this.logger.debug(`[PhaseEventsHandler] enter phase=${newPhase} match=${ev.matchId}`);
      await newRule.onEnter(ctxNew);
    }
    return true;
  }
}
