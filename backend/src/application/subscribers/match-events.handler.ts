import { Injectable, Logger } from '@nestjs/common';
import { MatchStateService } from '../state/match-state.service';
import { MatchEvent } from '@domain/types/match.event';
import { EventTypes } from '@domain/types/event.types';

@Injectable()
export class MatchEventsHandler {
  private readonly logger = new Logger(MatchEventsHandler.name);

  constructor(private readonly matchState: MatchStateService) {}

  async handle(ev: MatchEvent): Promise<void> {
    if (!ev?.matchId) return;

    if ((ev as any).kind && (ev as any).kind !== 'primary') {
      this.logger.debug(`skip non-primary: ${ev.type}`);
      return;
    }

    switch (ev.type) {
      case EventTypes.ROUND_START: {
        await this.matchState.setPhase(ev.matchId, 'live');
        break;
      }

      case EventTypes.TEAM_ROUND_WIN: {
        const { winner } = ev.payload as { winner: 'T' | 'CT'; reason?: string };
        if (winner) {
          await this.matchState.roundEnd(ev.matchId, winner);
        }
        break;
      }

      case EventTypes.MATCH_PAUSED: {
        await this.matchState.setPhase(ev.matchId, 'intermission');
        break;
      }

      case EventTypes.MATCH_UNPAUSED: {
        await this.matchState.setPhase(ev.matchId, 'freeze');
        break;
      }

      default:
        return;
    }

    const score = await this.matchState.getScore(ev.matchId);
    this.logger.debug(`[STATE] match=${ev.matchId} T=${score.t} / CT=${score.ct}`);
  }
}
