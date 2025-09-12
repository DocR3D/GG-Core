import { Injectable, Logger } from '@nestjs/common';
import { BusPublisher } from '@app/bus/publisher';
import { MatchIdResolver } from '@app/state/match-id.resolver';
import type { LogCtx } from '@domain/logctx';
import { MatchStateService } from '@app/state/match-state.service';

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
      // ⬇️ fallback si l’agent n’a pas mis matchId
      if (!ev.matchId && ev.serverId) {
        try {
          ev.matchId = await this.matchStateService.getServerMatch(ev.serverId) ?? undefined;
        } catch { /* ignore */ }
      }
      await this.publisher.publish('ggbot:events', ev);
    }
  }
}
