import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { MatchStateService } from './match-state.service';
import { EventTypes, MatchEvent } from '../../types/match-event';

@Injectable()
export class MatchStateHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchStateHandler.name);
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1, enableOfflineQueue: false,
  });
 
 constructor(private readonly matchState: MatchStateService) {}

 
  async onModuleInit() {
    await this.redis.subscribe('ggbot:events');

    this.redis.on('message', (channel, message) => {
      try {
        const event = JSON.parse(message) as MatchEvent;
        this.logger.debug(`[SUB=${channel}]`, event);
        this.applyEvent(event);
      } catch (e) {
        this.logger.warn(`Message non JSON: ${message}`);
      }
    });
  }

  async onModuleDestroy() {
    await this.redis?.quit();
   }


  private async applyEvent(ev: MatchEvent) {
    switch(ev.type){
      case EventTypes.TEAM_ROUND_WIN:
        this.matchState.addPoint(ev.matchId,ev.payload.winner);
      break;
    }
const score = await this.matchState.getScore(ev.matchId);
this.logger.debug(`[STATE] match=${ev.matchId} score T=${score.t} / CT=${score.ct}`,  'MatchStateHandler');  }
}