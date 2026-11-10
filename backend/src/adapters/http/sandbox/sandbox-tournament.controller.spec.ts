/**
 * SandboxTournamentController : the page and the API of the simulated tournaments (a dev tool, closed in prod). The
 * page lists the scenarios and the runs with the buttons each state allows; the form sends strings, JSON sends the
 * options as they are; the refusals of the tournament services become 404, 409 and 400.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import type { SimulationRun } from '@app/tournament/simulation/tournament-simulation.service';
import { SandboxTournamentController } from './sandbox-tournament.controller';

function run(over: Partial<SimulationRun> = {}): SimulationRun {
  return {
    id: 'run-1',
    tournamentId: 't-1',
    name: 'GG-Lan 32',
    status: 'running',
    gamesPlayed: 12,
    seriesPlayed: 5,
    delayMs: 800,
    parallel: 4,
    withStats: true,
    startedAt: new Date(0),
    phase: 'Poules',
    ...over,
  };
}

function setup() {
  const sim = {
    listScenarios: jest.fn().mockReturnValue(['fake-gglan-32.json']),
    listRuns: jest.fn().mockReturnValue([]),
    getRun: jest.fn().mockReturnValue(run()),
    start: jest.fn().mockResolvedValue(run()),
    prepare: jest.fn().mockResolvedValue({ tournamentId: 't-9' }),
    control: jest.fn().mockReturnValue(run({ status: 'paused' })),
  };
  const res = { redirect: jest.fn() };
  return { controller: new SandboxTournamentController(sim as never), sim, res: res as never as { redirect: jest.Mock } & Parameters<SandboxTournamentController['start']>[1] };
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]).filter((label) => label !== 'Lancer la simulation');

describe('SandboxTournamentController : the page', () => {
  it('offers the scenarios, escaped, and says when nothing has been started', () => {
    const { controller, sim } = setup();
    sim.listScenarios.mockReturnValue(['fake-gglan-32.json', 'a<b>.json']);

    const page = controller.page();

    expect(page).toContain('<option>fake-gglan-32.json</option>');
    expect(page).toContain('<option>a&lt;b&gt;.json</option>');
    expect(page).toContain('Aucune simulation lancée.');
    expect(page).toContain('action="/sandbox/tournament/runs"');
  });

  it('does not reload by itself when nothing is running, and every 3 seconds when something is', () => {
    const { controller, sim } = setup();

    expect(controller.page()).not.toContain('http-equiv="refresh"');

    sim.listRuns.mockReturnValue([run({ status: 'running' })]);
    expect(controller.page()).toContain('<meta http-equiv="refresh" content="3">');
    expect(controller.page()).toContain('Page rafraîchie toutes les 3 s');

    sim.listRuns.mockReturnValue([run({ status: 'paused' })]);
    expect(controller.page()).toContain('content="3"');

    sim.listRuns.mockReturnValue([run({ status: 'done' }), run({ id: 'r2', status: 'stopped' })]);
    expect(controller.page()).not.toContain('http-equiv="refresh"');
  });

  it('shows a run with its tournament, its state in French, its step and its counts', () => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run()]);

    const page = controller.page();

    expect(page).toContain('<a href="/view/tournaments/t-1?refresh=2">GG-Lan 32</a>');
    expect(page).toContain('href="/view/tournaments/t-1">sans rafraîchissement');
    expect(page).toContain('<td>en cours</td><td>Poules</td><td>5 / 12</td>');
  });

  it.each([
    ['running', 'en cours', ['Pause', 'Arrêter']],
    ['paused', 'en pause', ['Reprendre', 'Game suivant', 'Arrêter']],
    ['done', 'terminé', []],
    ['stopped', 'arrêté', []],
  ] as const)('a run that is %s reads "%s" and gets the buttons %j', (status, label, expected) => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run({ status })]);

    const page = controller.page();

    expect(page).toContain(`<td>${label}</td>`);
    expect(buttons(page)).toEqual(expected);
  });

  it('points each button at its own run and action, as a form the page can post', () => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run({ id: 'run-7', status: 'paused' })]);

    const page = controller.page();

    for (const action of ['resume', 'step', 'stop']) expect(page).toContain(`action="/sandbox/tournament/runs/run-7/${action}"`);
    expect(page).toContain('<input type="hidden" name="_form" value="1">');
  });

  it('shows the error of a run that failed, escaped, and no button', () => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run({ status: 'error', error: 'bad <fixture>' })]);

    const page = controller.page();

    expect(page).toContain('erreur : bad &lt;fixture&gt;');
    expect(buttons(page)).toEqual([]);
  });

  it('escapes the name of a run', () => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run({ name: '<img src=x>' })]);

    expect(controller.page()).toContain('&lt;img src=x&gt;');
  });
});

describe('SandboxTournamentController : the JSON API', () => {
  it('lists the scenarios and the runs', () => {
    const { controller, sim } = setup();
    sim.listRuns.mockReturnValue([run()]);

    expect(controller.scenarios()).toEqual(['fake-gglan-32.json']);
    expect(controller.runs()).toEqual([run()]);
  });

  it('gives one run, or a 404 when there is none', async () => {
    const { controller, sim } = setup();

    await expect(controller.run('run-1')).resolves.toEqual(run());
    sim.getRun.mockImplementation(() => {
      throw new TournamentError('not_found', 'no such run');
    });
    await expect(controller.run('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('starts a run from the options JSON gives, as they are, and answers the run', async () => {
    const { controller, sim, res } = setup();
    const options = { fixtureName: 'fake-gglan-32.json', delayMs: 0, parallel: 2, withStats: false, paused: true };

    await expect(controller.start(options, res)).resolves.toEqual(run());

    expect(sim.start).toHaveBeenCalledWith(options);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('starts with no options at all when the body is missing', async () => {
    const { controller, sim, res } = setup();

    await controller.start(undefined, res);

    expect(sim.start).toHaveBeenCalledWith({});
  });

  it('reads the page form: numbers from text, a ticked box is "on", and goes back to the page with a 303', async () => {
    const { controller, sim, res } = setup();

    await controller.start({ _form: '1', fixtureName: 'fake-gglan-32.json', delayMs: '800', parallel: '4', withStats: 'on', paused: 'on' }, res);

    expect(sim.start).toHaveBeenCalledWith({ fixtureName: 'fake-gglan-32.json', delayMs: 800, parallel: 4, withStats: true, paused: true });
    expect(res.redirect).toHaveBeenCalledWith(303, '/sandbox/tournament');
  });

  it('reads an unticked box as false, and a scenario that is not text as none', async () => {
    const { controller, sim, res } = setup();

    await controller.start({ _form: '1', fixtureName: 42, delayMs: '0', parallel: '1' }, res);

    expect(sim.start).toHaveBeenCalledWith({ fixtureName: undefined, delayMs: 0, parallel: 1, withStats: false, paused: false });
  });

  it('treats a body that only says _form as JSON when it is not exactly "1"', async () => {
    const { controller, sim, res } = setup();

    await controller.start({ _form: 'yes', fixtureName: 'x.json' }, res);

    expect(sim.start).toHaveBeenCalledWith({ _form: 'yes', fixtureName: 'x.json' });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('prepares a tournament to test by hand, with the options as given, or with none', async () => {
    const { controller, sim } = setup();

    await expect(controller.prepare({ teams: 8, groupCount: 2, stopAt: 'groups' } as never)).resolves.toEqual({ tournamentId: 't-9' });
    await controller.prepare(undefined as never);

    expect(sim.prepare).toHaveBeenNthCalledWith(1, { teams: 8, groupCount: 2, stopAt: 'groups' });
    expect(sim.prepare).toHaveBeenNthCalledWith(2, {});
  });

  it.each(['pause', 'resume', 'step', 'stop'])('%s goes to the run and answers the run, for a JSON caller', (action) => {
    const { controller, sim, res } = setup();

    expect(controller.control('run-1', action, undefined, res)).toEqual(run({ status: 'paused' }));

    expect(sim.control).toHaveBeenCalledWith('run-1', action);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('goes back to the page with a 303 when the button of the page was pressed', () => {
    const { controller, res } = setup();

    controller.control('run-1', 'pause', { _form: '1' }, res);

    expect(res.redirect).toHaveBeenCalledWith(303, '/sandbox/tournament');
  });
});

describe('SandboxTournamentController : refusals', () => {
  it.each([
    ['not_found', NotFoundException],
    ['conflict', ConflictException],
    ['invalid', BadRequestException],
    ['forbidden', BadRequestException],
  ] as const)('a "%s" refusal of a start, a preparation or an action is %s', async (code, exception) => {
    const { controller, sim, res } = setup();
    const refusal = new TournamentError(code, 'no way');
    sim.start.mockRejectedValue(refusal);
    sim.prepare.mockRejectedValue(refusal);
    sim.control.mockImplementation(() => {
      throw refusal;
    });

    await expect(controller.start({}, res)).rejects.toBeInstanceOf(exception);
    await expect(controller.prepare({} as never)).rejects.toBeInstanceOf(exception);
    expect(() => controller.control('run-1', 'stop', undefined, res)).toThrow(exception);
  });

  it('lets any other failure through untouched', async () => {
    const { controller, sim, res } = setup();
    const boom = new Error('out of memory');
    sim.start.mockRejectedValue(boom);

    await expect(controller.start({}, res)).rejects.toBe(boom);
  });
});
