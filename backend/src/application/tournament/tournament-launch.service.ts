// src/application/tournament/tournament-launch.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import { isUuid } from '@adapters/database/tournament-persistence.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchPhase } from '@domain/phase.types';
import { MatchSettings } from '@domain/match-settings.types';
import { TournamentError } from './tournament-stages.service';
import { VetoService } from './veto.service';

/**
 * Game servers of the LAN and the bridge "tournament game → real-time engine on a server".
 *
 * A server's `name` is the agent id (agents.d/<name>.yaml, e.g. "srv-a"). Availability:
 * - OFFLINE = disabled by the admin (dead PC / server): never chosen;
 * - busy = bound (Redis) to a real-time match that is not over - derived live, no status to keep in sync.
 * The admin picks the server of each game (no automatic allocation in the MVP).
 */
@Injectable()
export class TournamentLaunchService {
  private readonly log = new Logger(TournamentLaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MatchStateService,
    private readonly orch: MatchOrchestrator,
    private readonly veto: VetoService,
  ) {}

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  async createServer(input: { name: string; ip: string; port?: number; game?: string }) {
    const name = input.name?.trim();
    if (!name || !input.ip?.trim()) throw new TournamentError('invalid', 'name (agent id, e.g. srv-a) and ip are required');
    if (await this.prisma.server.findUnique({ where: { name } })) throw new TournamentError('conflict', `server ${name} already exists`);
    const server = await this.prisma.server.create({
      data: { name, ip: input.ip.trim(), port: input.port ?? 27015, game: input.game?.trim() || 'cs2' },
    });
    return { ...server, rconPassword: undefined };
  }

  /** Every server with its availability: disabled, busy (with the running match), or free. */
  async listServers() {
    const servers = await this.prisma.server.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(
      servers.map(async (s) => {
        const busyWith = await this.runningMatch(s.name);
        const availability = s.status === 'OFFLINE' ? 'disabled' : busyWith ? 'busy' : 'free';
        return { ...s, rconPassword: undefined, availability, busyWith };
      }),
    );
  }

  async setServerEnabled(idOrName: string, enabled: boolean) {
    const server = await this.findServer(idOrName);
    const updated = await this.prisma.server.update({ where: { id: server.id }, data: { status: enabled ? 'IDLE' : 'OFFLINE' } });
    return { ...updated, rconPassword: undefined };
  }

  /**
   * Frees a server stuck on a match that will never end (crash, cut replay…): the binding is removed, the
   * real-time match is left as is. The server becomes available for a new game.
   */
  async releaseServer(idOrName: string) {
    const server = await this.findServer(idOrName);
    const was = await this.runningMatch(server.name);
    await this.state.unbindServer(server.name);
    this.log.warn(`[release] server ${server.name} released${was ? ` (was running ${was.matchId}, ${was.phase})` : ''}`);
    return { server: server.name, released: was };
  }

  // ---------------------------------------------------------------------------
  // Launch a game of a tournament series on a server
  // ---------------------------------------------------------------------------

  /**
   * Starts game n° `order` of series `matchId` on `server` (id or agent name) with the real-time engine.
   * The engine's match id is the game's UUID (MatchMap id), so its result flows back automatically
   * (game result → series → bracket). Relaunching a game that is not finished - e.g. on another server after
   * a server died - reuses the same game and restarts it from scratch.
   * After a veto, the map is the one the veto gave this game (`mapName` optional) and, in side mode "pick",
   * the starting sides are the ones chosen in the veto (no knife round).
   */
  async launchGame(input: {
    matchId: string;
    order: number;
    server: string;
    mapName?: string;
    settings?: Partial<MatchSettings>;
  }) {
    if (!isUuid(input.matchId)) throw new TournamentError('not_found', 'match not found');
    const match = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      include: { teamHome: true, teamAway: true, tournament: { select: { game: true } } },
    });
    if (!match) throw new TournamentError('not_found', 'match not found');
    if (match.status === 'FINISHED') throw new TournamentError('conflict', 'series already finished');
    if (!match.teamHome || !match.teamAway) throw new TournamentError('conflict', 'both teams must be known');
    if (!Number.isInteger(input.order) || input.order < 1) throw new TournamentError('invalid', 'game number must be >= 1');
    const planned = await this.prisma.matchMap.findUnique({
      where: { matchId_mapOrder: { matchId: match.id, mapOrder: input.order } },
    });
    const mapName = input.mapName?.trim() || (planned && planned.mapName !== '-' ? planned.mapName : '');
    if (!mapName) throw new TournamentError('invalid', 'mapName is required (e.g. de_inferno): no veto gave this game a map');
    const sides = await this.veto.startingSides(match.id, input.order);
    const settings: Partial<MatchSettings> | undefined = sides ? { knifeEnabled: false, ...input.settings } : input.settings;

    const server = await this.findServer(input.server);
    if (server.status === 'OFFLINE') throw new TournamentError('conflict', `server ${server.name} is disabled`);
    if (server.game !== match.tournament.game) {
      throw new TournamentError('conflict', `server ${server.name} serves ${server.game}, not ${match.tournament.game}`);
    }

    if (planned?.status === 'FINISHED') throw new TournamentError('conflict', `game ${input.order} already finished`);
    const busyWith = await this.runningMatch(server.name);
    if (busyWith && busyWith.matchId !== planned?.id) {
      throw new TournamentError('conflict', `server ${server.name} is running match ${busyWith.matchId} (${busyWith.phase})`);
    }

    const game = await this.prisma.matchMap.upsert({
      where: { matchId_mapOrder: { matchId: match.id, mapOrder: input.order } },
      create: { matchId: match.id, mapOrder: input.order, mapName, serverId: server.id, status: 'LIVE', startedAt: new Date() },
      update: { mapName, serverId: server.id, status: 'LIVE', startedAt: new Date() },
    });
    if (match.status === 'PENDING') await this.prisma.match.update({ where: { id: match.id }, data: { status: 'LIVE' } });

    const engineMatchId = game.id;
    await this.state.initMatchState(engineMatchId, {
      teams: {
        home_id: match.teamHome.id,
        away_id: match.teamAway.id,
        home_name: match.teamHome.name,
        away_name: match.teamAway.name,
      },
      ...(sides ? { home: sides.home, away: sides.away } : {}),
      settings,
      serverId: server.name,
      matchMapId: game.id,
    });
    const started = await this.orch.startMatch({ serverId: server.name, matchId: engineMatchId, mapName, settings });
    this.log.log(`[launch] series ${match.id} game ${input.order} -> ${server.name} (${mapName}), engine match ${engineMatchId}`);
    return { gameId: game.id, engineMatchId, server: server.name, mapName, sides: sides ?? 'knife', started };
  }

  /** The real-time match a server runs, if it is not over. */
  private async runningMatch(serverName: string): Promise<{ matchId: string; phase: string } | null> {
    const matchId = await this.state.getMatchIdFromServerId(serverName);
    if (!matchId) return null;
    const phase = await this.state.getPhase(matchId);
    return phase && phase !== MatchPhase.POSTGAME ? { matchId, phase } : null;
  }

  private async findServer(idOrName: string) {
    const key = String(idOrName ?? '').trim();
    const server = isUuid(key)
      ? await this.prisma.server.findUnique({ where: { id: key } })
      : await this.prisma.server.findUnique({ where: { name: key } });
    if (!server) throw new TournamentError('not_found', `server ${idOrName} not found`);
    return server;
  }
}
