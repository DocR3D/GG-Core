// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import type { AnyEvent } from '@domain/events/match.event';
import { EventTypes } from '@domain/events/event.types';
import { RuleRegistry } from '@app/match/rules/rule.registry';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { RuleContextFactory } from '@app/rules/rule-context.factory';
import { PhaseEventsHandler } from './phase-events.handler';
import { RoundEventsHandler } from './round-events.handler';
import { KillAndBombEventsHandler } from './kill-bomb-events.handler';
import { DatabaseEventsHandler } from './database-events.handler';

@Injectable()
export class MatchEventsHandler {
  private readonly logger = new Logger(MatchEventsHandler.name);
  constructor(
    private readonly phaseHandler: PhaseEventsHandler,
    private readonly roundHandler: RoundEventsHandler,
    private readonly combatHandler: KillAndBombEventsHandler,
    private readonly dbHandler: DatabaseEventsHandler,
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

    // 0) Game Over du serveur : comparé à GG-Core (après un court délai), jamais traité par les règles
    if ((ev.type as string) === EventTypes.GAME_OVER) {
      const p = (ev as any).payload ?? {};
      this.ctxFactory
        .make({ matchId, serverId: ev.serverId })
        .orch.onServerGameOver(matchId, ev.serverId, { ct: Number(p.scoreCT) || 0, t: Number(p.scoreT) || 0 });
      return;
    }

    // 0bis) Résultat gelé (désaccord serveur / GG-Core) : en attendant l'admin, on ne fait qu'archiver les
    // événements - le serveur a pu relancer une partie qui fausserait score et stats.
    if (await this.mss.getReview(matchId)) {
      this.dbHandler.handle(evWithMatch).catch((err) => {
        this.logger.warn(`[MatchEventsHandler] async dbHandler error: ${err?.message}`);
      });
      return;
    }

    // 1) Handlers transverses (état round, phase, bomb, persistance BDD) - indépendants des règles
    if (await this.phaseHandler.handle(evWithMatch)) return;
    await this.roundHandler.handle(evWithMatch);
    await this.combatHandler.handle(evWithMatch);
    // Traitement persistance BDD en arrière-plan non bloquant pour le moteur temps réel CS2
    this.dbHandler.handle(evWithMatch).catch((err) => {
      this.logger.warn(`[MatchEventsHandler] async dbHandler error: ${err?.message}`);
    });

    // 2) Dispatch à la règle active pour la logique métier de la phase
    const phase = await this.phase.getPhase(matchId);
    const rule = this.registry.getRule(phase);
    if (!rule) return;

    this.logger.debug(
      `[MatchEventsHandler] dispatching ev=${ev.type} to rule=${(rule as any)?.name} (phase=${phase}, match=${matchId})`,
    );

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
