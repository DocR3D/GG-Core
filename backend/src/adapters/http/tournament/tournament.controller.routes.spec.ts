/**
 * TournamentController : the routes of the tournament API. Each one hands the call to the service that owns the work,
 * with what the route received, and turns the refusals of the tournament services into the right HTTP status. (The veto
 * actions and the connect route are in tournament.controller.spec.ts.)
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Session } from '@app/auth/auth.service';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { TournamentController } from './tournament.controller';

type Owner = 'stages' | 'launch' | 'veto' | 'admin' | 'edit';

/** Every method of a service answers a marker of its own, so a call that goes to the wrong one shows. */
function service(name: string): Record<string, jest.Mock> {
  return new Proxy({} as Record<string, jest.Mock>, {
    get(target, method: string) {
      target[method] ??= jest.fn().mockResolvedValue(`${name}.${method}`);
      return target[method];
    },
  });
}

function setup() {
  const services: Record<Owner, Record<string, jest.Mock>> = {
    stages: service('stages'),
    launch: service('launch'),
    veto: service('veto'),
    admin: service('admin'),
    edit: service('edit'),
  };
  const gameRounds = service('gameRounds');
  const controller = new TournamentController(
    services.stages as never,
    services.launch as never,
    services.veto as never,
    services.admin as never,
    services.edit as never,
    {} as never,
    gameRounds as never,
  );
  return { controller, ...services };
}

const captain: Session = { sub: '76561198000000001', role: 'player', name: 'cap', via: 'steam' };
const admin: Session = { sub: 'local-admin', role: 'admin', name: 'Lana', via: 'password' };
const req = (ggSession: Session | null | undefined) => ({ ggSession }) as never;

type Call = (c: TournamentController) => unknown;

describe('TournamentController : each route goes to the service that owns the work', () => {
  const body = { name: 'GG-Lan' };
  // [route, what it calls, the service and method it must reach, the arguments it must give]
  const cases: Array<[string, Call, Owner, string, unknown[]]> = [
    ['GET tournaments/:id/overview', (c) => c.overview('t1'), 'stages', 'getOverview', ['t1']],
    ['GET tournaments/:id/teams', (c) => c.teams('t1'), 'stages', 'tournamentTeams', ['t1']],
    ['GET matches/:id', (c) => c.matchDetail('m1'), 'stages', 'getMatchDetail', ['m1']],
    ['GET live', (c) => c.live(), 'launch', 'liveGames', []],
    ['GET servers', (c) => c.servers(), 'launch', 'listServers', []],
    ['POST servers', (c) => c.createServer({ name: 'srv-a', ip: '10.0.0.2' }), 'launch', 'createServer', [{ name: 'srv-a', ip: '10.0.0.2' }]],
    ['PATCH servers/:id', (c) => c.updateServer('srv-a', { ip: '10.0.0.3' }), 'launch', 'updateServer', ['srv-a', { ip: '10.0.0.3' }]],
    ['DELETE servers/:id', (c) => c.deleteServer('srv-a'), 'launch', 'deleteServer', ['srv-a']],
    ['GET tournaments', (c) => c.listTournaments(), 'stages', 'listTournaments', []],
    ['POST tournaments', (c) => c.createTournament(body), 'stages', 'createTournament', [body]],
    ['PATCH tournaments/:id', (c) => c.updateTournament('t1', { status: 'ACTIVE' }), 'edit', 'updateTournament', ['t1', { status: 'ACTIVE' }]],
    ['PATCH teams/:id', (c) => c.updateTeam('x1', { tag: 'DR' }), 'edit', 'updateTeam', ['x1', { tag: 'DR' }]],
    ['DELETE tournaments/:id/teams/:teamId', (c) => c.removeTeam('t1', 'x1'), 'edit', 'removeTeam', ['t1', 'x1']],
    ['PATCH players/:id', (c) => c.updatePlayer('p1', { username: 'Garitos' }), 'edit', 'updatePlayer', ['p1', { username: 'Garitos' }]],
    ['DELETE tournaments/:id/teams/:teamId/players/:playerId', (c) => c.removePlayer('t1', 'x1', 'p1'), 'edit', 'removePlayer', ['t1', 'x1', 'p1']],
    ['DELETE tournaments/:id', (c) => c.deleteTournament('t1'), 'stages', 'deleteTournament', ['t1']],
    ['POST teams', (c) => c.createTeams({ names: ['Démo Rouge'] }), 'stages', 'createTeams', [['Démo Rouge']]],
    ['POST tournaments/:id/stages', (c) => c.createStage('t1', { name: 'Poules', type: 'ROUND_ROBIN', order: 1 }), 'stages', 'createStage', ['t1', { name: 'Poules', type: 'ROUND_ROBIN', order: 1 }]],
    ['PATCH stages/:id', (c) => c.updateStage('s1', { name: 'Groupes' }), 'edit', 'updateStage', ['s1', { name: 'Groupes' }]],
    ['POST stages/:id/close-groups', (c) => c.closeGroups('s1'), 'edit', 'closeGroups', ['s1']],
    ['POST stages/:id/groups/generate', (c) => c.generateGroups('s1', { groupCount: 2 }), 'stages', 'generateGroups', ['s1', { groupCount: 2 }]],
    ['POST stages/:id/bracket/generate', (c) => c.generateBracket('s1', { teamIds: ['a', 'b'] }), 'stages', 'generateDoubleElimination', ['s1', { teamIds: ['a', 'b'] }]],
    ['GET stages/:id/standings', (c) => c.standings('s1'), 'stages', 'getStandings', ['s1']],
    ['POST stages/:id/qualify', (c) => c.qualify('s1', { rules: [{ ranks: [1, 2], targetStageId: 's2' }] }), 'stages', 'qualify', ['s1', { rules: [{ ranks: [1, 2], targetStageId: 's2' }] }]],
    ['POST matches/format', (c) => c.setFormat({ matchIds: ['m1'], format: 'BO3' }), 'admin', 'setFormat', [{ matchIds: ['m1'], format: 'BO3' }]],
    ['POST matches/:id/replace-team', (c) => c.replaceTeam('m1', { teamId: 'a', newTeamId: 'b' }), 'admin', 'replaceTeam', ['m1', 'a', 'b']],
    ['POST tournaments/:id/bonus-matches', (c) => c.createBonusMatch('t1', { homeTeamId: 'a', awayTeamId: 'b', placement: 7 }), 'admin', 'createBonusMatch', ['t1', { homeTeamId: 'a', awayTeamId: 'b', placement: 7 }]],
    ['DELETE bonus-matches/:id', (c) => c.deleteBonusMatch('m9'), 'admin', 'deleteBonusMatch', ['m9']],
    ['GET tournaments/:id/veto', (c) => c.tournamentVeto('t1'), 'veto', 'getTournamentConfig', ['t1']],
    ['POST stages/:id/rounds/:round/open-veto', (c) => c.openVetoRound('s1', 2), 'veto', 'openRound', ['s1', 2]],
    ['PUT tournaments/:id/veto', (c) => c.setTournamentVeto('t1', { mapPool: ['de_nuke'] }), 'veto', 'setTournamentConfig', ['t1', { mapPool: ['de_nuke'] }]],
    ['PUT stages/:id/veto', (c) => c.setStageVeto('s1', { sideMode: 'pick' }), 'veto', 'setStageConfig', ['s1', { sideMode: 'pick' }]],
    ['POST tournaments/:id/teams/:teamId/players', (c) => c.addPlayers('t1', 'x1', { players: [{ username: 'Garitos' }] }), 'veto', 'addPlayers', ['t1', 'x1', [{ username: 'Garitos' }]]],
    ['PUT tournaments/:id/teams/:teamId/captain', (c) => c.setCaptain('t1', 'x1', { playerId: 'p1' }), 'veto', 'setCaptain', ['t1', 'x1', 'p1']],
    ['GET tournaments/:id/vetos', (c) => c.tournamentVetos('t1'), 'veto', 'listForTournament', ['t1']],
  ];

  it.each(cases)('%s', async (_route, call, owner, method, args) => {
    const ctx = setup();

    await expect(call(ctx.controller)).resolves.toBe(`${owner}.${method}`);

    expect(ctx[owner][method]).toHaveBeenCalledWith(...args);
  });

  it('a body that was not sent reaches the service as an empty one, never as undefined', async () => {
    const ctx = setup();

    await ctx.controller.createServer(undefined as never);
    await ctx.controller.updateServer('srv-a', undefined as never);
    await ctx.controller.createTournament(undefined as never);
    await ctx.controller.updateStage('s1', undefined as never);
    await ctx.controller.generateBracket('s1', undefined as never);
    await ctx.controller.setTournamentVeto('t1', undefined as never);

    expect(ctx.launch.createServer).toHaveBeenCalledWith({});
    expect(ctx.launch.updateServer).toHaveBeenCalledWith('srv-a', {});
    expect(ctx.stages.createTournament).toHaveBeenCalledWith({});
    expect(ctx.edit.updateStage).toHaveBeenCalledWith('s1', {});
    expect(ctx.stages.generateDoubleElimination).toHaveBeenCalledWith('s1', {});
    expect(ctx.veto.setTournamentConfig).toHaveBeenCalledWith('t1', {});
  });
});

describe('TournamentController : the routes that decide something', () => {
  it.each([
    ['disable', false],
    ['enable', true],
  ])('"%s" on a server switches it %s', async (action, enabled) => {
    const { controller, launch } = setup();

    await controller.setServer('srv-a', action);

    expect(launch.setServerEnabled).toHaveBeenCalledWith('srv-a', enabled);
    expect(launch.releaseServer).not.toHaveBeenCalled();
  });

  it('"release" frees a server stuck on a match that will never end', async () => {
    const { controller, launch } = setup();

    await controller.setServer('srv-a', 'release');

    expect(launch.releaseServer).toHaveBeenCalledWith('srv-a');
    expect(launch.setServerEnabled).not.toHaveBeenCalled();
  });

  it('refuses any other action on a server with a 404 that lists the three it knows', () => {
    const { controller, launch } = setup();

    expect(() => controller.setServer('srv-a', 'explode')).toThrow(NotFoundException);
    expect(() => controller.setServer('srv-a', 'explode')).toThrow('disable | enable | release');
    expect(launch.setServerEnabled).not.toHaveBeenCalled();
  });

  it('launches a game with what the admin chose, and leaves out what the body does not say', async () => {
    const { controller, launch } = setup();

    await controller.launchGame('m1', 2, { server: 'srv-a', mapName: 'de_nuke', settings: { knifeRound: false } as never, access: { password: false } });
    await controller.launchGame('m1', 3, undefined as never);

    expect(launch.launchGame).toHaveBeenNthCalledWith(1, { matchId: 'm1', order: 2, server: 'srv-a', mapName: 'de_nuke', settings: { knifeRound: false }, access: { password: false } });
    expect(launch.launchGame).toHaveBeenNthCalledWith(2, { matchId: 'm1', order: 3, server: undefined, mapName: undefined, settings: undefined, access: undefined });
  });

  it.each([
    [{ force: true }, true],
    [{ force: false }, false],
    [{}, false],
    [undefined, false],
  ])('resetting a stage with %j forces it only when asked: %s', async (body, forced) => {
    const { controller, edit } = setup();

    await controller.resetStage('s1', body as never);

    expect(edit.resetStage).toHaveBeenCalledWith('s1', forced);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', false],
    [undefined, false],
  ])('deleting a stage with ?force=%s forces it only for "true": %s', async (force, forced) => {
    const { controller, edit } = setup();

    await controller.deleteStage('s1', force);

    expect(edit.deleteStage).toHaveBeenCalledWith('s1', forced);
  });

  it('records a forfeit under the name of the admin who declared it, or "admin" when the session has none', async () => {
    const { controller, admin: adminService } = setup();

    await controller.forfeit('m1', { absentTeamId: 'a' }, req(admin));
    await controller.forfeit('m1', { absentTeamId: 'a' }, req(null));
    await controller.forfeit('m1', undefined as never, req(admin));

    expect(adminService.forfeit).toHaveBeenNthCalledWith(1, 'm1', 'a', 'Lana');
    expect(adminService.forfeit).toHaveBeenNthCalledWith(2, 'm1', 'a', 'admin');
    expect(adminService.forfeit).toHaveBeenNthCalledWith(3, 'm1', undefined, 'Lana');
  });

  it('gives the veto state of a match as seen by the viewer, and as a visitor when nobody is signed in', async () => {
    const { controller, veto } = setup();

    await controller.vetoState('m1', req(captain));
    await controller.vetoState('m1', req(null));

    expect(veto.getState).toHaveBeenNthCalledWith(1, 'm1', { steamId: captain.sub, admin: false, name: 'cap' });
    expect(veto.getState).toHaveBeenNthCalledWith(2, 'm1', undefined);
  });

  it('lists the vetos of a captain who is signed in through Steam', async () => {
    const { controller, veto } = setup();

    await controller.myVetos(req(captain));

    expect(veto.listForCaptain).toHaveBeenCalledWith({ steamId: captain.sub, admin: false, name: 'cap' });
  });

  it('answers 401, and asks for the Steam login, to a visitor who wants his vetos', () => {
    const { controller, veto } = setup();

    let refusal: unknown;
    try {
      void controller.myVetos(req(null));
    } catch (e) {
      refusal = e;
    }

    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(401);
    expect(JSON.stringify((refusal as HttpException).getResponse())).toContain('/login');
    expect(veto.listForCaptain).not.toHaveBeenCalled();
  });
});

describe('TournamentController : the refusals of the tournament services become HTTP statuses', () => {
  it.each([
    ['not_found', NotFoundException, 404],
    ['conflict', ConflictException, 409],
    ['forbidden', ForbiddenException, 403],
    ['invalid', BadRequestException, 400],
  ] as const)('a "%s" refusal is a %s', async (code, exception, status) => {
    const { controller, stages } = setup();
    stages.getOverview.mockRejectedValue(new TournamentError(code, 'no way'));

    const failure = controller.overview('t1');

    await expect(failure).rejects.toBeInstanceOf(exception);
    await expect(failure).rejects.toMatchObject({ message: 'no way', status });
  });

  it('lets any other failure through untouched: it is a bug, not a refusal', async () => {
    const { controller, edit } = setup();
    const boom = new Error('database is gone');
    edit.removeTeam.mockRejectedValue(boom);

    await expect(controller.removeTeam('t1', 'x1')).rejects.toBe(boom);
  });

  it.each([
    ['a stage', (c: TournamentController) => c.closeGroups('s1'), 'edit', 'closeGroups'],
    ['a forfeit', (c: TournamentController) => c.forfeit('m1', { absentTeamId: 'a' }, req(admin)), 'admin', 'forfeit'],
    ['a launch', (c: TournamentController) => c.launchGame('m1', 1, {}), 'launch', 'launchGame'],
    ['a veto config', (c: TournamentController) => c.setStageVeto('s1', {}), 'veto', 'setStageConfig'],
  ] as const)('the same mapping applies to %s', async (_what, call, owner, method) => {
    const ctx = setup();
    ctx[owner][method].mockRejectedValue(new TournamentError('conflict', 'already started'));

    await expect(call(ctx.controller)).rejects.toBeInstanceOf(ConflictException);
  });
});
