import { TournamentLaunchService } from './tournament-launch.service';
import { TournamentError } from './tournament-stages.service';
import { MatchPhase } from '@domain/phase.types';

const SERIES = '11111111-1111-4111-8111-111111111111';
const SRV_UUID = '22222222-2222-4222-8222-222222222222';
const GAME_ID = '33333333-3333-4333-8333-333333333333';
const STEAM = (n: number) => `7656119800000${String(n).padStart(4, '0')}`; // 17 digits

type Srv = { id: string; name: string; ip: string; port: number; tvPort: number; game: string; status: string };
const srv = (name: string, over: Partial<Srv> = {}): Srv => ({ id: `id-${name}`, name, ip: '10.0.0.2', port: 27015, tvPort: 27020, game: 'cs2', status: 'IDLE', ...over });

/** What the service reads: servers, what each one runs, what each agent reports, rosters. Prisma and Redis state are stubs. */
function build(world: {
  servers?: Srv[];
  running?: Record<string, { matchId: string; phase: string }>;
  agents?: Record<string, { online: boolean; rconConnected: boolean }>;
  match?: Record<string, any> | null;
  planned?: Record<string, any> | null;
  sides?: { home: string; away: string } | null;
  roster?: Array<{ teamId: string; steamId: string }>;
} = {}) {
  const servers = world.servers ?? [srv('srv-a')];
  const match = world.match === undefined
    ? { id: SERIES, status: 'PENDING', tournamentId: 't1', tournament: { game: 'cs2' }, teamHome: { id: 'h', name: 'Alpha' }, teamAway: { id: 'a', name: 'Bravo' } }
    : world.match;
  const prisma = {
    server: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(servers.find((s) => s.id === where.id || s.name === where.name) ?? null)),
      findMany: jest.fn(({ where }: any = {}) =>
        Promise.resolve(servers.filter((s) => (!where?.game || s.game === where.game) && (!where?.status?.not || s.status !== where.status.not)).sort((x, y) => x.name.localeCompare(y.name))),
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new', status: 'IDLE', rconPassword: 'secret', ...data })),
      update: jest.fn(({ where, data }: any) => Promise.resolve({ ...servers.find((s) => s.id === where.id), rconPassword: 'secret', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    match: { findUnique: jest.fn().mockResolvedValue(match), update: jest.fn().mockResolvedValue({}) },
    matchMap: {
      findUnique: jest.fn().mockResolvedValue(world.planned ?? null),
      upsert: jest.fn(({ create }: any) => Promise.resolve({ id: GAME_ID, ...create })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    teamRoster: {
      findMany: jest.fn().mockResolvedValue((world.roster ?? []).map((r) => ({ teamId: r.teamId, player: { steamId: r.steamId } }))),
    },
  };
  const state = {
    getMatchIdFromServerId: jest.fn((name: string) => Promise.resolve(world.running?.[name]?.matchId ?? null)),
    getPhase: jest.fn((matchId: string) => Promise.resolve(Object.values(world.running ?? {}).find((r) => r.matchId === matchId)?.phase ?? null)),
    getAgentState: jest.fn((name: string) => Promise.resolve(world.agents?.[name] ?? { online: true, rconConnected: true })),
    unbindServer: jest.fn().mockResolvedValue(undefined),
    initMatchState: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockResolvedValue(null),
    getReview: jest.fn().mockResolvedValue(null),
  };
  const orch = { startMatch: jest.fn().mockResolvedValue({ ok: true }) };
  const veto = { startingSides: jest.fn().mockResolvedValue(world.sides ?? null) };
  const access = { getPassword: jest.fn() };
  const placement = { setLineups: jest.fn().mockResolvedValue(undefined) };
  const config = { setMatchTournamentId: jest.fn().mockResolvedValue(undefined) };
  const svc = new TournamentLaunchService(prisma as never, state as never, orch as never, veto as never, access as never, placement as never, config as never);
  return { svc, prisma, state, orch, veto, placement, config };
}

type LaunchInput = Parameters<TournamentLaunchService['launchGame']>[0];
const launch = (h: ReturnType<typeof build>, over: Partial<LaunchInput> = {}) =>
  h.svc.launchGame({ matchId: SERIES, order: 1, mapName: 'de_inferno', ...over });

/** The service throws TournamentError(code, message): the code becomes the HTTP status. */
async function refused(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(TournamentError);
    return { code: (e as TournamentError).code, message: (e as Error).message };
  }
  throw new Error('expected a TournamentError');
}

describe('TournamentLaunchService : servers', () => {
  it('creates a server with the usual ports and game, and never returns its RCON password', async () => {
    const h = build({ servers: [] });
    const out = await h.svc.createServer({ name: ' srv-b ', ip: ' 10.0.0.9 ' });
    expect(h.prisma.server.create).toHaveBeenCalledWith({ data: { name: 'srv-b', ip: '10.0.0.9', port: 27015, tvPort: 27020, game: 'cs2' } });
    expect(out.rconPassword).toBeUndefined();
  });

  it('refuses a server without name or ip, and a name already used', async () => {
    expect((await refused(build().svc.createServer({ name: ' ', ip: '1.1.1.1' }))).code).toBe('invalid');
    expect((await refused(build().svc.createServer({ name: 'x', ip: '' }))).code).toBe('invalid');
    expect((await refused(build().svc.createServer({ name: 'srv-a', ip: '1.1.1.1' }))).code).toBe('conflict');
  });

  it('lists every server as disabled, busy (with its match) or free, with what its agent reports', async () => {
    const h = build({
      servers: [srv('srv-a'), srv('srv-b'), srv('srv-c', { status: 'OFFLINE' })],
      running: { 'srv-b': { matchId: 'game-9', phase: MatchPhase.LIVE_MAIN } },
      agents: { 'srv-a': { online: true, rconConnected: true } },
    });
    const list = await h.svc.listServers();
    expect(list.map((s) => [s.name, s.availability])).toEqual([['srv-a', 'free'], ['srv-b', 'busy'], ['srv-c', 'disabled']]);
    expect(list[1].busyWith).toEqual({ matchId: 'game-9', phase: MatchPhase.LIVE_MAIN });
    expect(list.every((s) => s.rconPassword === undefined)).toBe(true);
  });

  it('a server whose match is in postgame is free again', async () => {
    const h = build({ running: { 'srv-a': { matchId: 'g', phase: MatchPhase.POSTGAME } } });
    expect((await h.svc.listServers())[0].availability).toBe('free');
  });

  it('disables / enables a server, found by id or by agent name', async () => {
    const h = build();
    await h.svc.setServerEnabled('srv-a', false);
    expect(h.prisma.server.update).toHaveBeenLastCalledWith({ where: { id: 'id-srv-a' }, data: { status: 'OFFLINE' } });
    await h.svc.setServerEnabled('srv-a', true);
    expect(h.prisma.server.update).toHaveBeenLastCalledWith({ where: { id: 'id-srv-a' }, data: { status: 'IDLE' } });

    const byUuid = build({ servers: [srv('srv-a', { id: SRV_UUID })] });
    await byUuid.svc.setServerEnabled(SRV_UUID, false);
    expect(byUuid.prisma.server.findUnique).toHaveBeenCalledWith({ where: { id: SRV_UUID } });
    expect((await refused(build().svc.setServerEnabled('nope', true))).code).toBe('not_found');
  });

  it('updates the address and ports only, after checking them; the name (agent id) is never touched', async () => {
    const h = build();
    await h.svc.updateServer('srv-a', { ip: ' 172.20.0.5 ', port: 27016, tvPort: 27021 });
    expect(h.prisma.server.update).toHaveBeenCalledWith({ where: { id: 'id-srv-a' }, data: { ip: '172.20.0.5', port: 27016, tvPort: 27021 } });

    expect((await refused(h.svc.updateServer('srv-a', { ip: 'bad ip!' }))).code).toBe('invalid');
    for (const port of [0, 70000, 1.5]) expect((await refused(h.svc.updateServer('srv-a', { port }))).message).toContain('port');
    await h.svc.updateServer('srv-a', {});
    expect(h.prisma.server.update).toHaveBeenLastCalledWith({ where: { id: 'id-srv-a' }, data: {} });
  });

  it('deletes a free server, refuses one that runs a match', async () => {
    const free = build();
    expect((await free.svc.deleteServer('srv-a')).deleted).toBe('srv-a');
    expect(free.prisma.server.delete).toHaveBeenCalledWith({ where: { id: 'id-srv-a' } });

    const busy = build({ running: { 'srv-a': { matchId: 'g1', phase: MatchPhase.LIVE_MAIN } } });
    expect((await refused(busy.svc.deleteServer('srv-a'))).code).toBe('conflict');
    expect(busy.prisma.server.delete).not.toHaveBeenCalled();
  });

  it('releases a stuck server and says what it was running', async () => {
    const h = build({ running: { 'srv-a': { matchId: 'g1', phase: MatchPhase.HALFTIME } } });
    expect(await h.svc.releaseServer('srv-a')).toEqual({ server: 'srv-a', released: { matchId: 'g1', phase: MatchPhase.HALFTIME } });
    expect(h.state.unbindServer).toHaveBeenCalledWith('srv-a');
    expect((await build().svc.releaseServer('srv-a')).released).toBeNull();
  });
});

describe('TournamentLaunchService.launchGame : refusals', () => {
  it.each([
    ['an id that is not a UUID', { matchId: 'abc' }, null, 'not_found'],
    ['an unknown series', {}, { match: null }, 'not_found'],
    ['a finished series', {}, { match: { id: SERIES, status: 'FINISHED' } }, 'conflict'],
    ['a series whose teams are not known yet', {}, { match: { id: SERIES, status: 'PENDING', tournament: { game: 'cs2' }, teamHome: { id: 'h', name: 'A' }, teamAway: null } }, 'conflict'],
    ['a game number below 1', { order: 0 }, null, 'invalid'],
    ['a fractional game number', { order: 1.5 }, null, 'invalid'],
    ['a game without any map', { mapName: ' ' }, null, 'invalid'],
    ['a game whose map is still "-" (no veto yet)', { mapName: undefined }, { planned: { id: GAME_ID, mapName: '-', status: 'PENDING' } }, 'invalid'],
    ['a game already finished', {}, { planned: { id: GAME_ID, mapName: 'de_nuke', status: 'FINISHED' } }, 'conflict'],
    ['a disabled server', { server: 'srv-a' }, { servers: [srv('srv-a', { status: 'OFFLINE' })] }, 'conflict'],
    ['a server of another game', { server: 'srv-a' }, { servers: [srv('srv-a', { game: 'valorant' })] }, 'conflict'],
    ['an unknown server', { server: 'srv-zz' }, null, 'not_found'],
    ['a server that runs another match', { server: 'srv-a' }, { running: { 'srv-a': { matchId: 'other', phase: MatchPhase.LIVE_MAIN } } }, 'conflict'],
  ])('refuses %s', async (_label, input, world, code) => {
    const h = build(world ?? {});
    expect((await refused(launch(h, input))).code).toBe(code);
    expect(h.orch.startMatch).not.toHaveBeenCalled();
    expect(h.prisma.matchMap.upsert).not.toHaveBeenCalled();
    expect(h.state.initMatchState).not.toHaveBeenCalled();
  });
});

describe('TournamentLaunchService.launchGame : choosing the server', () => {
  it('takes the first server by name that is enabled, serves the game and whose agent reaches RCON', async () => {
    const h = build({
      servers: [srv('srv-a'), srv('srv-b'), srv('srv-c'), srv('srv-d'), srv('srv-e', { status: 'OFFLINE' })],
      running: { 'srv-a': { matchId: 'other', phase: MatchPhase.LIVE_MAIN } }, // busy
      agents: { 'srv-b': { online: false, rconConnected: false }, 'srv-c': { online: true, rconConnected: false } },
    });
    expect((await launch(h)).server).toBe('srv-d');
  });

  it('says so when no server is free', async () => {
    const h = build({ agents: { 'srv-a': { online: true, rconConnected: false } } });
    const err = await refused(launch(h));
    expect(err.code).toBe('conflict');
    expect(err.message).toContain('no free cs2 server');
  });

  it('a relaunch picks the server that still runs this very game', async () => {
    const h = build({
      planned: { id: GAME_ID, mapName: 'de_nuke', status: 'LIVE' },
      running: { 'srv-a': { matchId: GAME_ID, phase: MatchPhase.LIVE_MAIN } },
    });
    const out = await launch(h);
    expect(out.server).toBe('srv-a');
    expect(out.mapName).toBe('de_inferno'); // an explicit map wins over the planned one
  });

  it('can restart the same game on the server that already runs it', async () => {
    const h = build({
      servers: [srv('srv-a'), srv('srv-b')],
      planned: { id: GAME_ID, mapName: 'de_nuke', status: 'LIVE' },
      running: { 'srv-a': { matchId: GAME_ID, phase: MatchPhase.LIVE_MAIN } },
    });
    expect((await launch(h, { server: 'srv-a' })).server).toBe('srv-a');
  });
});

describe('TournamentLaunchService.launchGame : starting', () => {
  const roster = [
    { teamId: 'h', steamId: STEAM(1) }, { teamId: 'h', steamId: STEAM(2) },
    { teamId: 'a', steamId: STEAM(11) }, { teamId: 'a', steamId: STEAM(12) },
  ];

  afterEach(() => { delete process.env.GG_ADMIN_STEAMIDS; });

  it('marks game and series live, gives the engine its own state, lineups and access, and returns how to connect', async () => {
    process.env.GG_ADMIN_STEAMIDS = ' 76561198000099999 , ';
    const h = build({ roster });

    const out = await launch(h);

    expect(h.prisma.matchMap.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { matchId_mapOrder: { matchId: SERIES, mapOrder: 1 } },
      create: expect.objectContaining({ matchId: SERIES, mapOrder: 1, mapName: 'de_inferno', serverId: 'id-srv-a', status: 'LIVE' }),
      update: expect.objectContaining({ mapName: 'de_inferno', serverId: 'id-srv-a', status: 'LIVE' }),
    }));
    expect(h.prisma.match.update).toHaveBeenCalledWith({ where: { id: SERIES }, data: { status: 'LIVE' } });
    expect(h.config.setMatchTournamentId).toHaveBeenCalledWith(GAME_ID, 't1');
    expect(h.state.initMatchState).toHaveBeenCalledWith(GAME_ID, expect.objectContaining({
      teams: { home_id: 'h', away_id: 'a', home_name: 'Alpha', away_name: 'Bravo' },
      serverId: 'srv-a',
      matchMapId: GAME_ID,
    }));
    expect(h.placement.setLineups).toHaveBeenCalledWith(GAME_ID, [STEAM(1), STEAM(2)], [STEAM(11), STEAM(12)]);

    const start = h.orch.startMatch.mock.calls[0][0];
    expect(start).toMatchObject({ serverId: 'srv-a', matchId: GAME_ID, mapName: 'de_inferno' });
    expect(start.access.password).toMatch(/\S+/);
    expect(start.access.allowedSteamIds).toEqual([STEAM(1), STEAM(2), STEAM(11), STEAM(12), '76561198000099999']);

    expect(out).toMatchObject({ gameId: GAME_ID, engineMatchId: GAME_ID, server: 'srv-a', sides: 'knife', whitelist: { players: 4, admins: 1 }, started: { ok: true } });
    expect(out.connect).toBe(`connect 10.0.0.2:27015; password ${start.access.password}`);
  });

  it('does not touch the status of a series that is already live', async () => {
    const h = build({ match: { id: SERIES, status: 'LIVE', tournamentId: 't1', tournament: { game: 'cs2' }, teamHome: { id: 'h', name: 'A' }, teamAway: { id: 'a', name: 'B' } } });
    await launch(h);
    expect(h.prisma.match.update).not.toHaveBeenCalled();
  });

  it('uses the map the veto gave the game, and the sides of the veto: no knife, players must stand on their side', async () => {
    const h = build({
      planned: { id: GAME_ID, mapName: 'de_ancient', status: 'PENDING' },
      sides: { home: 'CT', away: 'T' },
    });
    const out = await launch(h, { mapName: undefined, settings: { fixedSides: true, knifeEnabled: false } });

    expect(out.mapName).toBe('de_ancient');
    expect(out.sides).toEqual({ home: 'CT', away: 'T' });
    expect(h.state.initMatchState).toHaveBeenCalledWith(GAME_ID, expect.objectContaining({
      home: 'CT', away: 'T', settings: expect.objectContaining({ knifeEnabled: false, fixedSides: true }),
    }));
  });

  it('the settings passed by the caller win over the ones the veto implies', async () => {
    const h = build({ sides: { home: 'T', away: 'CT' } });
    await launch(h, { settings: { knifeEnabled: true } });
    expect(h.orch.startMatch.mock.calls[0][0].settings).toMatchObject({ knifeEnabled: true, fixedSides: true });
  });

  it('without veto sides the settings are passed on as given (knife round)', async () => {
    const h = build();
    await launch(h, { settings: { knifeEnabled: true } });
    expect(h.state.initMatchState).toHaveBeenCalledWith(GAME_ID, expect.not.objectContaining({ home: expect.anything() }));
    expect(h.orch.startMatch.mock.calls[0][0].settings).toEqual({ knifeEnabled: true });
  });

  it('turns the password and the whitelist off on request (training, tests)', async () => {
    const h = build({ roster });
    const out = await launch(h, { access: { password: false, whitelist: false } });
    expect(h.orch.startMatch.mock.calls[0][0].access).toEqual({ password: null });
    expect(out.whitelist).toEqual({ off: 'disabled for this launch' });
    expect(out.connect).toBe('connect 10.0.0.2:27015');
  });

  it('leaves the whitelist off when a team has no SteamID in its roster (it would kick the whole team)', async () => {
    const h = build({ roster: roster.filter((r) => r.teamId === 'h') });
    const out = await launch(h);
    expect(out.whitelist).toEqual({ off: 'a team has no player with a SteamID in its roster' });
    expect(h.orch.startMatch.mock.calls[0][0].access.allowedSteamIds).toBeUndefined();
    expect(h.orch.startMatch.mock.calls[0][0].access.password).toBeTruthy();
  });

  it('ignores roster players whose SteamID is unusable', async () => {
    const h = build({ roster: [...roster, { teamId: 'h', steamId: 'pending' }] });
    await launch(h);
    expect(h.placement.setLineups.mock.calls[0][1]).toEqual([STEAM(1), STEAM(2)]);
  });

  it('a tournament-less series has no roster: empty lineups, whitelist off', async () => {
    const h = build({ match: { id: SERIES, status: 'PENDING', tournamentId: null, tournament: { game: 'cs2' }, teamHome: { id: 'h', name: 'A' }, teamAway: { id: 'a', name: 'B' } } });
    const out = await launch(h);
    expect(h.prisma.teamRoster.findMany).not.toHaveBeenCalled();
    expect(h.placement.setLineups).toHaveBeenCalledWith(GAME_ID, [], []);
    expect(out.whitelist).toMatchObject({ off: expect.any(String) });
  });
});

describe('TournamentLaunchService.liveGames', () => {
  const game = (over: Record<string, unknown> = {}) => ({
    id: GAME_ID, mapOrder: 2, mapName: 'de_mirage', startedAt: new Date('2026-11-07T10:00:00Z'), server: { name: 'srv-a' },
    match: { id: SERIES, format: 'BO3', scoreHome: 1, scoreAway: 0, teamHome: { name: 'Alpha' }, teamAway: { name: 'Bravo' }, tournament: { id: 't1', name: 'GG-Lan' } },
    ...over,
  });

  it('puts the engine score on the right team whatever the sides, and shows a pause only when there is one', async () => {
    const h = build();
    h.prisma.matchMap.findMany.mockResolvedValue([game()]);
    h.state.getSnapshot.mockResolvedValue({
      phase: MatchPhase.LIVE_MAIN, sides: { home: 'T', away: 'CT' }, score: { ct: 7, t: 3, round: 11 }, pause: { state: 'paused', reason: 'tactical' },
    });
    h.state.getReview.mockResolvedValue({ reason: 'mismatch' });

    const [g] = await h.svc.liveGames();

    expect(g).toMatchObject({ gameId: GAME_ID, order: 2, server: 'srv-a', home: 'Alpha', away: 'Bravo', phase: MatchPhase.LIVE_MAIN });
    expect(g.score).toEqual({ home: 3, away: 7, round: 11 }); // home plays T: its score is the T one
    expect(g.pause).toEqual({ state: 'paused', reason: 'tactical' });
    expect(g.review).toEqual({ reason: 'mismatch' });
    expect(g.match).toEqual({ id: SERIES, format: 'BO3', scoreHome: 1, scoreAway: 0 });
  });

  it('copes with a game the engine has no state for yet', async () => {
    const h = build();
    h.prisma.matchMap.findMany.mockResolvedValue([game({ match: { id: SERIES, format: 'BO1', scoreHome: 0, scoreAway: 0, teamHome: null, teamAway: null, tournament: { id: 't1', name: 'X' } } })]);

    const [g] = await h.svc.liveGames();

    expect(g).toMatchObject({ phase: null, sides: null, score: { home: 0, away: 0, round: 0 }, pause: null, review: null, home: null, away: null });
  });

  it('does not report a pause that is over', async () => {
    const h = build();
    h.prisma.matchMap.findMany.mockResolvedValue([game()]);
    h.state.getSnapshot.mockResolvedValue({ phase: MatchPhase.LIVE_MAIN, score: { ct: 0, t: 0, round: 1 }, pause: { state: 'none' } });
    expect((await h.svc.liveGames())[0].pause).toBeNull();
  });
});
