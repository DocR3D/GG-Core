import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { isCommand, MatchEvent } from '@domain/types/match.event';
import { REDIS_SUB } from '@adapters/redis/redis.tokens';
import { MatchEventsHandler } from './match-events.handler';
import { ChatCommandHandler } from './chat-commands.handler';
import { MatchStateService } from '@app/state/match-state.service';
import { RuleRegistry } from '@app/rules/rule.registry';

@Injectable()
export class EventsRouterSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsRouterSubscriber.name);

  // Aligné avec ce que Cs2LogsService publie
  private readonly channels = ['ggbot:events'] as const;
  private onMessageBound = (channel: string, message: string) => this.onMessage(channel, message);

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

  private async onMessage(channel: string, msg: string) {
    let ev: MatchEvent;
    try {
      ev = JSON.parse(msg);
    } catch {
      this.logger.warn(`Invalid JSON on ${channel}`);
      return;
    }
    if (!ev?.type) {
      //this.logger.debug(`[SUB=${channel}] skip non-match payload`);
      return;
    }
    const sid = typeof ev.serverId === 'string' && ev.serverId.trim() ? ev.serverId : null;
    if ((!ev.matchId || ev.matchId === 'unknown') && sid) {
      try {
        const mid = await this.matchState.getMatchIdFromServerId(sid);
        if (mid) ev.matchId = mid;
      } catch {}
    }

    this.logger.debug(`[SUB=${channel}] ${ev.type} m=${ev.matchId}`);

    if (isCommand(ev)) {
      await this.chatCommandHandler.handle(ev);
    } else {
      await this.matchEventsHandler.handle(ev);
    }
  }
}
