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
import { generateServerPassword, MatchAccessService, toLogSteamId } from '@app/match/access/match-access.service';
import { TeamPlacementService } from '@app/match/access/team-placement.service';
import type { Session } from '@app/auth/auth.service';
import type { GameConnect } from './tournament-view';

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
    private readonly access: MatchAccessService,
    private readonly placement: TeamPlacementService,
  ) {}

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  async createServer(input: { name: string; ip: string; port?: number; tvPort?: number; game?: string }) {
    const name = input.name?.trim();
    if (!name || !input.ip?.trim()) throw new TournamentError('invalid', 'name (agent id, e.g. srv-a) and ip are required');
    if (await this.prisma.server.findUnique({ where: { name } })) throw new TournamentError('conflict', `server ${name} already exists`);
    const server = await this.prisma.server.create({
      data: { name, ip: input.ip.trim(), port: input.port ?? 27015, tvPort: input.tvPort ?? 27020, game: input.game?.trim() || 'cs2' },
    });
    return { ...server, rconPassword: undefined };
  }

  /**
   * Every server with its availability (disabled, busy with the running match, or free) and what its agent last
   * reported (RCON reachable, last logs received): enough to check a server before the LAN starts.
   */
  async listServers() {
    const servers = await this.prisma.server.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(
      servers.map(async (s) => {
        const [busyWith, agent] = await Promise.all([this.runningMatch(s.name), this.state.getAgentState(s.name)]);
        const availability = s.status === 'OFFLINE' ? 'disabled' : busyWith ? 'busy' : 'free';
        return { ...s, rconPassword: undefined, availability, busyWith, agent };
      }),
    );
  }

  async setServerEnabled(idOrName: string, enabled: boolean) {
    const server = await this.findServer(idOrName);
    const updated = await this.prisma.server.update({ where: { id: server.id }, data: { status: enabled ? 'IDLE' : 'OFFLINE' } });
    return { ...updated, rconPassword: undefined };
  }

  /**
   * { ip?, port?, tvPort? } - the name stays: it is the agent id (agents.d/<name>.yaml), renaming it would cut the
   * server from its agent. The RCON address used by the agent is in that YAML (make server writes both).
   */
  async updateServer(idOrName: string, input: { ip?: string; port?: number; tvPort?: number }) {
    const server = await this.findServer(idOrName);
    const data: { ip?: string; port?: number; tvPort?: number } = {};
    if (input.ip !== undefined) {
      if (!/^[A-Za-z0-9.-]{1,64}$/.test(input.ip.trim())) throw new TournamentError('invalid', 'ip: an address or a host name');
      data.ip = input.ip.trim();
    }
    for (const key of ['port', 'tvPort'] as const) {
      if (input[key] === undefined) continue;
      const n = Number(input[key]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new TournamentError('invalid', `${key}: 1 to 65535`);
      data[key] = n;
    }
    const updated = await this.prisma.server.update({ where: { id: server.id }, data });
    return { ...updated, rconPassword: undefined };
  }

  /**
   * Removes a server from the tournament (a PC given back): refused while it runs a match. Its past games keep
   * their result, without server. Its agent keeps running until agents.d/<name>.yaml is deleted (said back).
   */
  async deleteServer(idOrName: string) {
    const server = await this.findServer(idOrName);
    const busyWith = await this.runningMatch(server.name);
    if (busyWith) throw new TournamentError('conflict', `server ${server.name} is running match ${busyWith.matchId}: release it first`);
    await this.prisma.server.delete({ where: { id: server.id } });
    return { deleted: server.name, agent: `agents.d/${server.name}.yaml still starts its agent: delete the file to stop it` };
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
    /** Server id or agent name; none = the first free server (pickFreeServer) */
    server?: string;
    mapName?: string;
    settings?: Partial<MatchSettings>;
    /** Server password and whitelist of the two rosters, both on by default (off: training, tests) */
    access?: { password?: boolean; whitelist?: boolean };
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
    // sides chosen in the veto: no knife, and the players must be on their side before the live
    const settings: Partial<MatchSettings> | undefined = sides ? { knifeEnabled: false, fixedSides: true, ...input.settings } : input.settings;

    if (planned?.status === 'FINISHED') throw new TournamentError('conflict', `game ${input.order} already finished`);
    const server = input.server?.trim()
      ? await this.findServer(input.server)
      : await this.pickFreeServer(match.tournament.game, planned?.id);
    if (server.status === 'OFFLINE') throw new TournamentError('conflict', `server ${server.name} is disabled`);
    if (server.game !== match.tournament.game) {
      throw new TournamentError('conflict', `server ${server.name} serves ${server.game}, not ${match.tournament.game}`);
    }

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
    const rosters = await this.rosterSteamIds(match.tournamentId, [match.teamHome.id, match.teamAway.id]);
    await this.placement.setLineups(engineMatchId, rosters.get(match.teamHome.id) ?? [], rosters.get(match.teamAway.id) ?? []);
    const access = this.gameAccess(rosters, input.access);
    const started = await this.orch.startMatch({ serverId: server.name, matchId: engineMatchId, mapName, settings, access: access.access });
    this.log.log(`[launch] series ${match.id} game ${input.order} -> ${server.name} (${mapName}), engine match ${engineMatchId}`);
    return {
      gameId: game.id,
      engineMatchId,
      server: server.name,
      mapName,
      sides: sides ?? 'knife',
      connect: `connect ${server.ip}:${server.port}${access.access.password ? `; password ${access.access.password}` : ''}`,
      whitelist: access.whitelist,
      started,
    };
  }

  /**
   * Who may join a game: a new random password, and every player of the two rosters (starters and substitutes:
   * substitutes play bonus matches) plus the Steam admins. The whitelist is left off when a team has no SteamID
   * yet (it would kick the whole team) - said in `whitelist.off`.
   */
  private gameAccess(rosters: Map<string, string[]>, opts: { password?: boolean; whitelist?: boolean } = {}) {
    const password = opts.password === false ? null : generateServerPassword();
    if (opts.whitelist === false) return { access: { password }, whitelist: { off: 'disabled for this launch' } };

    const missing = [...rosters].filter(([, ids]) => !ids.length).map(([teamId]) => teamId);
    if (missing.length) {
      this.log.warn(`[launch] whitelist off: no SteamID in the roster of team(s) ${missing.join(', ')}`);
      return { access: { password }, whitelist: { off: 'a team has no player with a SteamID in its roster' } };
    }
    const players = [...rosters.values()].flat();
    const admins = (process.env.GG_ADMIN_STEAMIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return { access: { password, allowedSteamIds: [...players, ...admins] }, whitelist: { players: players.length, admins: admins.length } };
  }

  /** SteamIDs of every player of each team's roster in the tournament (teams without any: empty list). */
  private async rosterSteamIds(tournamentId: string | null, teamIds: string[]): Promise<Map<string, string[]>> {
    const rows = tournamentId
      ? await this.prisma.teamRoster.findMany({
          where: { tournamentId, teamId: { in: teamIds } },
          select: { teamId: true, player: { select: { steamId: true } } },
        })
      : [];
    return new Map(teamIds.map((id) => [id, rows.filter((r) => r.teamId === id && toLogSteamId(r.player.steamId)).map((r) => r.player.steamId!)]));
  }

  /**
   * How to join the games being played in a series. Only an admin or a player of one of the two teams gets the
   * server and its password (`play`) - the password must not reach the other teams or the spectators; everyone
   * but the players of the match may watch (GOTV, open and delayed).
   */
  async connectInfo(matchId: string, viewer: Session | null | undefined): Promise<GameConnect[]> {
    if (!isUuid(matchId)) return [];
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        tournamentId: true,
        teamHomeId: true,
        teamAwayId: true,
        maps: { where: { status: 'LIVE', serverId: { not: null } }, include: { server: true }, orderBy: { mapOrder: 'asc' } },
      },
    });
    if (!match?.maps.length) return [];
    const isAdmin = viewer?.role === 'admin';
    const isPlayer = !isAdmin && (await this.playsInMatch(match, viewer));
    return Promise.all(
      match.maps.map(async (g) => ({
        order: g.mapOrder,
        mapName: g.mapName,
        // the players of the match play it, they do not watch it (delayed GOTV of their own game)
        watch: isPlayer ? undefined : `${g.server!.ip}:${g.server!.tvPort}`,
        play: isAdmin || isPlayer ? { address: `${g.server!.ip}:${g.server!.port}`, password: await this.access.getPassword(g.id) } : undefined,
      })),
    );
  }

  /** Whether the viewer is a player of one of the two rosters of the match (Steam login). */
  private async playsInMatch(
    match: { tournamentId: string | null; teamHomeId: string | null; teamAwayId: string | null },
    viewer: Session | null | undefined,
  ): Promise<boolean> {
    if (!viewer) return false;
    const steamId = toLogSteamId(viewer.sub);
    const teamIds = [match.teamHomeId, match.teamAwayId].filter((id): id is string => !!id);
    if (!steamId || !match.tournamentId || !teamIds.length) return false;
    const rosters = await this.prisma.teamRoster.findMany({
      where: { tournamentId: match.tournamentId, teamId: { in: teamIds } },
      select: { player: { select: { steamId: true } } },
    });
    return rosters.some((r) => toLogSteamId(r.player.steamId) === steamId);
  }

  /**
   * Every game being played, all tournaments together (admin dashboard): the series and its teams, the server,
   * and from the real-time engine the phase, the score per team, the pause and a frozen result awaiting the admin.
   */
  async liveGames() {
    const games = await this.prisma.matchMap.findMany({
      where: { status: 'LIVE', serverId: { not: null } },
      orderBy: { startedAt: 'asc' },
      include: {
        server: true,
        match: { include: { teamHome: true, teamAway: true, tournament: { select: { id: true, name: true } } } },
      },
    });
    return Promise.all(
      games.map(async (g) => {
        const [snap, review] = await Promise.all([this.state.getSnapshot(g.id), this.state.getReview(g.id)]);
        const homeSide = snap?.sides?.home === 'T' ? 't' : 'ct';
        const awaySide = homeSide === 'ct' ? 't' : 'ct';
        return {
          gameId: g.id,
          order: g.mapOrder,
          mapName: g.mapName,
          startedAt: g.startedAt,
          server: g.server!.name,
          tournament: g.match.tournament,
          match: { id: g.match.id, format: g.match.format, scoreHome: g.match.scoreHome, scoreAway: g.match.scoreAway },
          home: g.match.teamHome?.name ?? null,
          away: g.match.teamAway?.name ?? null,
          phase: snap?.phase ?? null,
          sides: snap?.sides ?? null,
          score: { home: snap?.score?.[homeSide] ?? 0, away: snap?.score?.[awaySide] ?? 0, round: snap?.score?.round ?? 0 },
          pause: snap?.pause?.state && snap.pause.state !== 'none' ? snap.pause : null,
          review: review ?? null,
        };
      }),
    );
  }

  /**
   * No server given at launch: the first one (by name) that is enabled, serves this game, runs no match (or this
   * very game, for a relaunch) and whose agent reaches CS2 in RCON - a PC switched off or a server without the right
   * RCON password is never chosen. 409 when none is free.
   */
  private async pickFreeServer(game: string, gameId?: string) {
    const servers = await this.prisma.server.findMany({ where: { status: { not: 'OFFLINE' }, game }, orderBy: { name: 'asc' } });
    for (const s of servers) {
      const [busyWith, agent] = await Promise.all([this.runningMatch(s.name), this.state.getAgentState(s.name)]);
      if (busyWith && busyWith.matchId !== gameId) continue;
      if (!agent.online || !agent.rconConnected) continue;
      return s;
    }
    throw new TournamentError('conflict', `no free ${game} server (enabled, no match running, agent connected in RCON): see make servers`);
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
