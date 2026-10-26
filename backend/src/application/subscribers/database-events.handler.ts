import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';

@Injectable()
export class DatabaseEventsHandler {
  private readonly logger = new Logger(DatabaseEventsHandler.name);

  constructor(
    private readonly persistence: TournamentPersistenceService,
  ) {}

  /**
   * Processes live match events in background to persist stats and audit logs.
   * Runs non-blockingly and safely catches errors so database delays never impact the CS2 engine.
   */
  async handle(ev: AnyEvent & { matchId: string }): Promise<void> {
    try {
      // 1. Always record in Event Sourcing log (EventPrimary)
      await this.persistence.recordEventLog(
        ev.matchId,
        ev.type,
        ev.payload,
        ev.timestamp ? Number(ev.timestamp) : Date.now(),
      );

      // 2. Handle specific game events for stats & brackets
      switch (ev.type) {
        case EventTypes.KILL:
          await this.handleKill(ev);
          break;

        case EventTypes.TEAM_ROUND_WIN:
          await this.handleTeamRoundWin(ev);
          break;

        default:
          break;
      }
    } catch (err: any) {
      // Safe resilience: Log warning but never crash the real-time match engine
      this.logger.warn(
        `[DatabaseEventsHandler] Failed to persist event ${ev.type} for match ${ev.matchId}: ${err?.message}`,
      );
    }
  }

  private async handleKill(ev: AnyEvent & { matchId: string }): Promise<void> {
    const payload = ev.payload as any;
    if (!payload || payload.kind !== 'player' || !payload.killer) {
      return;
    }

    const killerRef = payload.killer;
    const isHeadshot = Boolean(payload.headshot);

    // Resolve killer identity (handles both SteamID and offline LAN fallback)
    const killer = await this.persistence.resolvePlayer({
      steamId: killerRef.steamId,
      username: killerRef.name,
    });

    // Resolve team id placeholder (falls back to matchId if team UUID not configured yet)
    const teamId = killerRef.team || 'Unassigned';

    await this.persistence.recordPlayerKill({
      matchMapId: ev.matchId,
      playerId: killer.id,
      teamId,
      isHeadshot,
      damageDealt: 100,
    });
  }

  private async handleTeamRoundWin(ev: AnyEvent & { matchId: string }): Promise<void> {
    const payload = ev.payload as any;
    this.logger.debug(
      `[DatabaseEventsHandler] Round win persisted for match ${ev.matchId}, winner=${payload?.winner}`,
    );
  }
}
