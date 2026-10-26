// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import type { AnyEvent } from '@domain/events/match.event';
import { RuleRegistry } from '@app/match/rules/rule.registry';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { RuleContextFactory } from '@app/rules/rule-context.factory';
import { PhaseEventsHandler } from './phase-events.handler';
import { RoundEventsHandler } from './round-events.handler';
import { KillAndBombEventsHandler } from './kill-bomb-events.handler';

@Injectable()
export class MatchEventsHandler {
  private readonly logger = new Logger(MatchEventsHandler.name);
  constructor(
    private readonly phaseHandler: PhaseEventsHandler,
    private readonly roundHandler: RoundEventsHandler,
    private readonly combatHandler: KillAndBombEventsHandler,
    private readonly registry: RuleRegistry,
    private readonly phase: MatchPhaseService,
    private readonly mss: MatchStateService,
    private readonly ctxFactory: RuleContextFactory,
  ) {}

  async handle(ev: AnyEvent & { serverId?: string }): Promise<void> {
    // normalisation du matchId
    let matchId: string | undefined =
      ev.matchId && ev.matchId !== 'unknown' ? ev.matchId : undefined;
    if (!matchId && ev.serverId) {
      const resolved = await this.mss.getMatchIdFromServerId(ev.serverId);
      if (resolved) {
        matchId = resolved;
        (ev as any).matchId = resolved;
      }
    }
    if (!matchId) return;

    const evWithMatch = { ...ev, matchId };

    // 1) Handlers transverses (état round, phase, bomb) — indépendants des règles
    if (await this.phaseHandler.handle(evWithMatch)) return;
    await this.roundHandler.handle(evWithMatch);
    await this.combatHandler.handle(evWithMatch);

    // 2) Dispatch à la règle active pour la logique métier de la phase
    const phase = await this.phase.getPhase(matchId);
    const rule = this.registry.getRule(phase);
    if (!rule) return;

    const ctx = this.ctxFactory.make({ matchId, serverId: ev.serverId });
    try {
      if ((rule as any).events?.has(ev.type)) {
        await (rule as any).events.get(ev.type)(evWithMatch, ctx);
      } else if (typeof (rule as any).canHandle === 'function' && (rule as any).canHandle(ev.type)) {
        await (rule as any).handle(evWithMatch, ctx);
      }
    } catch (err) {
      this.logger.error(`[MatchEventsHandler] rule dispatch failed for type=${ev.type}: ${err}`);
    }
  }
}

