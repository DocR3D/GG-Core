// src/application/subscribers/kill-and-bomb-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { GameSide } from '@app/match/state';

@Injectable()
export class KillAndBombEventsHandler {
  private readonly logger = new Logger(KillAndBombEventsHandler.name);
  constructor(private readonly orchestrator: MatchOrchestrator) {}

  async handle(ev: AnyEvent & { matchId: string }): Promise<boolean> {
    switch (ev.type) {
      case EventTypes.BOMB_PLANTED:
        this.orchestrator.onBombPlanted(ev);
        return true;
      case EventTypes.KILL:
      case EventTypes.BEGIN_BOMB_PLANT:
      case EventTypes.DEFUSE_BEGIN:
      case EventTypes.DEFUSE_ABORT:
      case EventTypes.GRENADE_THROW:
      case EventTypes.PLAYER_BLINDED:
        // Pour l’instant déléguer à orchestrator si tu as déjà des méthodes, sinon logger
        this.logger.debug(`[KillAndBombEventsHandler] event=${ev.type} match=${ev.matchId}`);
        return true;
      case EventTypes.SFUI_TARGET_BOMBED:
        return this.teamScoreRound(ev.matchId,"T",EventTypes.SFUI_TARGET_BOMBED)
      case EventTypes.TEAM_ROUND_WIN:
        return this.teamScoreRound(ev.matchId,ev.payload.winner,EventTypes.SFUI_TARGET_BOMBED)
      case EventTypes.BOMB_DEFUSED:
        return this.teamScoreRound(ev.matchId,"CT",EventTypes.BOMB_DEFUSED)
      default:
        return false;
    }
  }

  async teamScoreRound(matchId:string, winner: GameSide, reason?: string){
    this.logger.debug("Adding a point to : " + winner);
    if((await this.orchestrator.getPhase(matchId)) == "live_main"){
    await this.orchestrator.push(matchId, 'round:end', {
      winner: winner,
      reason: reason ?? 'elim',
    });
    this.orchestrator.roundEnd(matchId,winner);
    // Dans tous les cas, renvoie un snapshot pour se resynchroniser
    return true;
  }else return false;
  }

}
