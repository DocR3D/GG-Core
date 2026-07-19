// src/application/subscribers/round-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';

@Injectable()
export class RoundEventsHandler {
  private readonly logger = new Logger(RoundEventsHandler.name);
  constructor(private readonly orchestrator: MatchOrchestrator) {}

  async handle(ev: AnyEvent & { matchId: string }): Promise<boolean> {
    switch (ev.type) {
      case EventTypes.ROUND_START:
        await this.orchestrator.onRoundStart(ev);
        return false;
      case EventTypes.TEAM_ROUND_WIN:
        await this.orchestrator.onRoundEnd(ev);
        return false;
      case EventTypes.ROUND_FREEZE_START:
        await this.orchestrator.onFreezeTimeStart(ev);
        return false;
      case EventTypes.ROUND_END:
        await this.orchestrator.onRoundEndScore(ev);
        return false;
      case EventTypes.TEAM_SWAP:
        await this.orchestrator.onTeamSwap(ev);
        return false;
      case EventTypes.MATCH_STATUS_SCORE:
        await this.orchestrator.onMatchStatusScore(ev);
        return false;
      default:
        return false;
    }
  }
}
