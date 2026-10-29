import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { TournamentPersistenceService, isUuid } from '@adapters/database/tournament-persistence.service';
import { MatchStateService, normalizeSide } from '@app/match/state/match-state.service';

/** Durée de cache de la résolution matchId → MatchMap (évite une requête SQL par événement). */
const MATCH_MAP_CACHE_TTL_MS = 30_000;

@Injectable()
export class DatabaseEventsHandler {
  private readonly logger = new Logger(DatabaseEventsHandler.name);
  private readonly matchMapCache = new Map<string, { matchMapId: string | null; expiresAt: number }>();

  constructor(
    private readonly persistence: TournamentPersistenceService,
    private readonly state: MatchStateService,
  ) {}

  /**
   * Processes live match events in background to persist stats and audit logs.
   * Runs non-blockingly and safely catches errors so database delays never impact the CS2 engine.
   */
  async handle(ev: AnyEvent & { matchId: string }): Promise<void> {
    try {
      const matchMapId = await this.resolveMatchMapId(ev.matchId);

      // 1. Always record in Event Sourcing log (EventPrimary), keyed by the real-time matchId
      //    and attached to its MatchMap when the match is linked to the relational model.
      await this.persistence.recordEventLog(
        matchMapId,
        ev.type,
        ev.payload,
        ev.timestamp ? Number(ev.timestamp) : Date.now(),
        { matchId: ev.matchId, serverId: ev.serverId ?? null },
      );

      // 2. Handle specific game events for stats & brackets
      switch (ev.type) {
        case EventTypes.KILL:
          await this.handleKill(ev, matchMapId);
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

  /**
   * matchId temps réel → MatchMap UUID :
   * 1. liaison explicite posée à l'init du match (`match:{id}:db_match_map`) ;
   * 2. sinon, le matchId lui-même s'il s'agit de l'UUID d'un MatchMap existant ;
   * 3. sinon null (match de test / sandbox non rattaché à un tournoi).
   */
  private async resolveMatchMapId(matchId: string): Promise<string | null> {
    const cached = this.matchMapCache.get(matchId);
    if (cached && cached.expiresAt > Date.now()) return cached.matchMapId;

    const linked = await this.state.getDbMatchMapId(matchId);
    const candidate = linked ?? matchId;
    const matchMap = isUuid(candidate) ? await this.persistence.findMatchMap(candidate) : null;
    if (linked && !matchMap) {
      this.logger.warn(`[DatabaseEventsHandler] match ${matchId} is linked to unknown MatchMap ${linked}`);
    }

    const matchMapId = matchMap?.id ?? null;
    this.matchMapCache.set(matchId, { matchMapId, expiresAt: Date.now() + MATCH_MAP_CACHE_TTL_MS });
    return matchMapId;
  }

  private async handleKill(ev: AnyEvent & { matchId: string }, matchMapId: string | null): Promise<void> {
    const payload = ev.payload as any;
    if (!payload || payload.kind !== 'player' || !payload.killer) {
      return;
    }
    // PlayerMapStats is relational: it needs a real MatchMap and a real Team
    if (!matchMapId) return;

    const killerRef = payload.killer;
    const teamId = await this.resolveTeamId(ev.matchId, killerRef.team);
    if (!teamId) {
      this.logger.debug(
        `[DatabaseEventsHandler] kill stats skipped for match ${ev.matchId}: no team UUID for side ${killerRef.team}`,
      );
      return;
    }

    // Resolve killer identity (handles both SteamID and offline LAN fallback)
    const killer = await this.persistence.resolvePlayer({
      steamId: killerRef.steamId,
      username: killerRef.name,
    });

    await this.persistence.recordPlayerKill({
      matchMapId,
      playerId: killer.id,
      teamId,
      isHeadshot: Boolean(payload.headshot),
      damageDealt: 100,
    });
  }

  /** Côté physique (CT/T) du tueur → équipe logique (home/away) → Team UUID configuré à l'init. */
  private async resolveTeamId(matchId: string, side: string | undefined): Promise<string | null> {
    const normalized = side ? normalizeSide(side as any) : null;
    if (normalized !== 'CT' && normalized !== 'T') return null;

    const logical = await this.state.sideToLogical(matchId, normalized);
    if (!logical) return null;

    const ids = await this.state.getTeamIds(matchId);
    const teamId = logical === 'home' ? ids.home_id : ids.away_id;
    return isUuid(teamId) ? teamId : null;
  }

  private async handleTeamRoundWin(ev: AnyEvent & { matchId: string }): Promise<void> {
    const payload = ev.payload as any;
    this.logger.debug(
      `[DatabaseEventsHandler] Round win persisted for match ${ev.matchId}, winner=${payload?.winner}`,
    );
  }
}
