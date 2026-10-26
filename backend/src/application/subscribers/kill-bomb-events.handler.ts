// src/application/subscribers/kill-and-bomb-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';

@Injectable()
export class KillAndBombEventsHandler {
  private readonly logger = new Logger(KillAndBombEventsHandler.name);
  constructor(private readonly orchestrator: MatchOrchestrator) {}

  async handle(ev: AnyEvent & { matchId: string }): Promise<boolean> {
    switch (ev.type) {
      case EventTypes.BOMB_PLANTED:
        await this.orchestrator.onBombPlanted(ev);
        return false;
      case EventTypes.KILL:
      case EventTypes.BEGIN_BOMB_PLANT:
      case EventTypes.DEFUSE_BEGIN:
      case EventTypes.DEFUSE_ABORT:
      case EventTypes.GRENADE_THROW:
      case EventTypes.PLAYER_BLINDED:
        this.logger.debug(`[KillAndBombEventsHandler] event=${ev.type} match=${ev.matchId}`);
        return false;
      default:
        return false;
    }
  }

}
