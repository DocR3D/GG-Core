// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { MatchStateService } from '../state/match-state.service';
import { MatchEvent } from '@domain/types/match.event';
import { EventTypes } from '@domain/types/event.types';

@Injectable()
export class MatchEventsHandler {
  private readonly logger = new Logger(MatchEventsHandler.name);

  constructor(private readonly matchState: MatchStateService) {}

  /**
   * Traite un événement "match" provenant du Pub/Sub.
   * Recommandation: ne traiter que les événements "primaires" (source de vérité),
   * pour éviter le double comptage avec les SFUI fallback.
   */
  async handle(ev: MatchEvent): Promise<void> {
    if (!ev?.matchId) return;

    // Optionnel : ignorer les non-primaires (si tu tagges `kind: 'primary' | 'telemetry'`)
    if ((ev as any).kind && (ev as any).kind !== 'primary') {
      this.logger.debug(`skip non-primary: ${ev.type}`);
      return;
    }

    switch (ev.type) {
      case EventTypes.ROUND_START: {
        // Laisse l'incrément du round au moment opportun si tu le fais ailleurs.
        await this.matchState.setPhase(ev.matchId, 'live');
        break;
      }

      case EventTypes.TEAM_ROUND_WIN: {
        const w = ev.payload?.winner;
        if (w === 'T' || w === 'CT') {
          await this.matchState.addPoint(ev.matchId, w);
          // On passe en intermission; l'UI ou un autre handler lancera le prochain round.
          await this.matchState.setPhase(ev.matchId, 'intermission');
        }
        break;
      }

      case EventTypes.MATCH_PAUSED: {
        await this.matchState.setPhase(ev.matchId, 'intermission');
        break;
      }

      case EventTypes.MATCH_UNPAUSED: {
        // Repart en freeze avant live (à affiner selon ton flow de match)
        await this.matchState.setPhase(ev.matchId, 'freeze');
        break;
      }

      // Tu peux ajouter ici d'autres types si tu veux muter le state :
      // - BOMB_PLANTED -> marquer un flag
      // - DEFUSE_BEGIN/ABORT -> flags temporaires, etc.

      default:
        // Pas de mutation à faire → sortie silencieuse
        return;
    }

    // Log état courant (utile en dev)
    const score = await this.matchState.getScore(ev.matchId);
    this.logger.debug(`[STATE] match=${ev.matchId} T=${score.t} / CT=${score.ct}`);
  }
}
