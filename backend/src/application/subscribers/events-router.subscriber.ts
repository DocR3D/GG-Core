// src/application/subscribers/events-router.subscriber.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_SUB } from '@adapters/redis/redis.tokens';

import { isCommand, AnyEvent } from '@domain/types/match.event';
import { MatchEventsHandler } from './match-events.handler';
import { ChatCommandHandler } from './chat-commands.handler';
import { MatchStateService } from '@app/state/match-state.service';

@Injectable()
export class EventsRouterSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsRouterSubscriber.name);

  // Aligne-toi sur ce que publient tes producteurs (agent/logs/etc.)
  private readonly channels = ['ggbot:events'] as const;

  private onMessageBound = (channel: string, message: string) =>
    this.onMessage(channel, message);

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis,
    private readonly matchEventsHandler: MatchEventsHandler,
    private readonly chatCommandHandler: ChatCommandHandler,
    private readonly matchState: MatchStateService,
  ) {}

  async onModuleInit() {
    await this.sub.subscribe(...this.channels);
    this.sub.on('message', this.onMessageBound);
    this.logger.log(`Subscribed to ${this.channels.join(', ')}`);
  }

  async onModuleDestroy() {
    this.sub.off('message', this.onMessageBound);
    try { await this.sub.unsubscribe(...this.channels); } catch {}
  }

  // =========================================================================
  // Routing
  // =========================================================================
  private async onMessage(channel: string, msg: string) {
    // 1) Parse JSON
    let ev: AnyEvent | null = null;
    try {
      ev = JSON.parse(msg);
    } catch {
      this.logger.warn(`Invalid JSON on ${channel}`);
      return;
    }
    if (!ev || typeof ev !== 'object' || !('type' in ev)) return;

    // 2) Filtre "kind" (ne traite que le flux principal)
    //    (garde ta convention: kind: 'primary' | 'telemetry' | ...)
    if ((ev as any).kind && (ev as any).kind !== 'primary') return;

    // 3) Résoudre matchId s'il manque mais qu'on a serverId
    if ((!ev.matchId || ev.matchId === 'unknown') && !!ev.serverId) {
      try {
        const mid = await this.matchState.getMatchIdFromServerId(ev.serverId);
        if (mid) (ev as any).matchId = mid;
      } catch {
        // ignore, on garde le matchId tel quel
      }
    }

    // 4) Si toujours pas de matchId → on ignore (inutile de spammer les logs)
    if (!ev.matchId) return;

    this.logger.debug(`[SUB=${channel}] ${ev.type} m=${ev.matchId}`);

    // 5) Route: commandes vs événements
    try {
      if (isCommand(ev)) {
        await this.chatCommandHandler.handle(ev);
      } else {
        await this.matchEventsHandler.handle(ev);
      }
    } catch (e) {
      this.logger.error(
        `Routing failed: type=${(ev as any).type} match=${ev.matchId} err=${(e as Error)?.message}`,
      );
    }
  }
}
