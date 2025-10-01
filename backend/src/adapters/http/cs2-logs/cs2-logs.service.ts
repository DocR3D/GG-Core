import { Injectable, Logger } from '@nestjs/common';
import { BusPublisher } from '@adapters/bus/publisher';
import { MatchIdResolver } from '@app/match/state/match-id.resolver';
import type { LogCtx } from '@app/shared/logging/logctx';
import { MatchStateService } from '@app/match/state/match-state.service';

type IncomingEvent = {
  v?: number;
  id?: string;
  ts?: number;
  seq?: number;
  serverId?: string;
  matchId?: string;
  type: string;
  payload: unknown;
};

@Injectable()
export class Cs2LogsService {
  private readonly logger = new Logger(Cs2LogsService.name);

  constructor(
    private readonly publisher: BusPublisher,
    private readonly matchStateService: MatchStateService,
  ) {}

  /**
   * Reçoit un batch d’événements déjà parsés (envoyés par l’agent Go).
   * Ne fait pas de regex ni de parsing de lignes.
   */
  async handleEvents(events: IncomingEvent[]) {
    for (const ev of events) {
      if (!ev?.type || ev.payload === undefined) {
        this.logger.warn(`Drop invalid event: ${JSON.stringify(ev)}`);
        continue;
      }
      // ⬇ fallback si l’agent n’a pas mis matchId
      if (!ev.matchId && ev.serverId) {
        try {
          ev.matchId = await this.matchStateService.getMatchIdFromServerId(ev.serverId) ?? undefined;
        } catch { /* ignore */ }
      }
      await this.publisher.publish('ggbot:events', ev);
    }
  }
}
