import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import {MatchEvent } from '@domain/types/match.event';
import { REDIS_SUB,REDIS_PUB } from '@adapters/redis/redis.tokens'; // ← client SUB dédié
import { MatchEventsHandler } from './match-events.handler';
import { ChatCommandHandler } from './chat-commands.handler';

@Injectable()
export class EventsRouterSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsRouterSubscriber.name);
  private readonly channels = ['ggbot:events'] as const;
  private onMessageBound = (channel: string, message: string) => this.onMessage(channel, message);

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis, 
    private readonly matchEventsHandler: MatchEventsHandler,
    private readonly chatCommandHandler: ChatCommandHandler,
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
    try { ev = JSON.parse(msg); } catch { this.logger.warn(`Invalid JSON on ${channel}`); return; }
    this.logger.debug(`[SUB=${channel}] ${ev.type} m=${ev.matchId}`);

    if (channel === 'ggbot:events') {
      await this.matchEventsHandler.handle(ev);
    }
    if (channel === 'ggbot:command') {
      await this.matchEventsHandler.handle(ev);
    }
        if (channel === 'ggbot:chat') {
      await this.matchEventsHandler.handle(ev);
    }
}
}