/**
 * ViewController : the human pages of the tournaments, outside /api. The list, one tournament as a page or as plain text
 * (".txt"), one match with the way to join its game. The page builders are replaced by markers: what is checked here is
 * what the controller gives them and how it turns a refusal of the tournament services into an HTTP status.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { ViewController } from './view.controller';

jest.mock('@app/tournament/tournament-view', () => ({
  asciiPage: jest.fn((name: string, body: string, isHtml: boolean, refresh?: number) => `page[${name}|${body}|${isHtml}|${refresh}]`),
  renderTournamentHtml: jest.fn(() => 'tournament-html'),
  renderTournamentAscii: jest.fn(() => 'tournament-ascii'),
  renderMatchDetailHtml: jest.fn((detail: { id: string }, back: string, link: (id: string) => string, connect: unknown) => `match[${detail.id}|${back}|${link('x')}|${JSON.stringify(connect)}]`),
}));

function setup() {
  const stages = {
    listTournaments: jest.fn().mockResolvedValue([]),
    getOverview: jest.fn().mockResolvedValue({ name: 'GG-Lan' }),
    getMatchDetail: jest.fn().mockResolvedValue({ id: 'm-1', tournament: { id: 't-1' } }),
  };
  const launch = { connectInfo: jest.fn().mockResolvedValue([{ order: 1 }]) };
  const res = { type: jest.fn() };
  return { controller: new ViewController(stages as never, launch as never), stages, launch, res: res as never as { type: jest.Mock } & Parameters<ViewController['tournament']>[2] };
}

describe('ViewController : the list of tournaments', () => {
  it('says there is none yet', async () => {
    const { controller } = setup();

    expect(await controller.list()).toContain('Aucun tournoi pour l’instant.');
  });

  it('links each tournament to its page, with its game and its status in French', async () => {
    const { controller, stages } = setup();
    stages.listTournaments.mockResolvedValue([
      { id: 't-1', name: 'GG-Lan', game: 'cs2', status: 'ACTIVE' },
      { id: 't-2', name: 'Old', game: 'cs2', status: 'ARCHIVED' },
      { id: 't-3', name: 'Odd', game: 'cs2', status: 'SOMETHING_NEW' },
    ]);

    const page = await controller.list();

    expect(page).toContain('<a href="/view/tournaments/t-1">GG-Lan</a> <span class="gg-meta">cs2, en cours</span>');
    expect(page).toContain('cs2, archivé');
    expect(page).toContain('cs2, SOMETHING_NEW'); // a status it does not know is shown as it is
    expect(page).not.toContain('Aucun tournoi');
  });

  it('escapes what a tournament is called', async () => {
    const { controller, stages } = setup();
    stages.listTournaments.mockResolvedValue([{ id: 't-1', name: '<script>alert(1)</script>', game: 'cs2', status: 'UPCOMING' }]);

    const page = await controller.list();

    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('ViewController : one tournament', () => {
  it('gives an HTML page, with a link to each match', async () => {
    const { controller, stages, res } = setup();

    const page = await controller.tournament('t-1', undefined, res);

    expect(stages.getOverview).toHaveBeenCalledWith('t-1');
    expect(res.type).toHaveBeenCalledWith('text/html; charset=utf-8');
    expect(page).toBe('page[GG-Lan|tournament-html|true|undefined]');
  });

  it.each([
    ['2', 2],
    ['10', 10],
    ['0', undefined],
    ['abc', undefined],
    [undefined, undefined],
  ])('?refresh=%s reloads every %s seconds, nothing otherwise', async (refresh, seconds) => {
    const { controller, res } = setup();

    const page = await controller.tournament('t-1', refresh, res);

    expect(page).toContain(`|true|${seconds}]`);
  });

  it('gives the same tournament as plain text when the address ends with ".txt"', async () => {
    const { controller, stages, res } = setup();

    const text = await controller.tournament('t-1.txt', undefined, res);

    expect(stages.getOverview).toHaveBeenCalledWith('t-1');
    expect(res.type).toHaveBeenCalledWith('text/plain; charset=utf-8');
    expect(text).toBe('tournament-ascii');
  });

  it.each([
    ['not_found', NotFoundException],
    ['conflict', ConflictException],
    ['invalid', BadRequestException],
    ['forbidden', BadRequestException],
  ] as const)('turns a "%s" refusal into %s', async (code, exception) => {
    const { controller, stages, res } = setup();
    stages.getOverview.mockRejectedValue(new TournamentError(code, 'no way'));

    await expect(controller.tournament('t-1', undefined, res)).rejects.toBeInstanceOf(exception);
    await expect(controller.tournament('t-1', undefined, res)).rejects.toMatchObject({ message: 'no way' });
  });

  it('lets any other failure through untouched', async () => {
    const { controller, stages, res } = setup();
    const boom = new Error('database is gone');
    stages.getOverview.mockRejectedValue(boom);

    await expect(controller.tournament('t-1', undefined, res)).rejects.toBe(boom);
  });
});

describe('ViewController : one match', () => {
  it('shows the match with its way back to the tournament and the way to join its game, as seen by the viewer', async () => {
    const { controller, stages, launch } = setup();
    const session = { sub: '1', role: 'player', name: 'cap', via: 'steam' };

    const page = await controller.match('m-1', { ggSession: session } as never);

    expect(stages.getMatchDetail).toHaveBeenCalledWith('m-1');
    expect(launch.connectInfo).toHaveBeenCalledWith('m-1', session);
    expect(page).toBe('match[m-1|/view/tournaments/t-1|/view/matches/x|[{"order":1}]]');
  });

  it('asks for the way to join as a visitor when nobody is signed in', async () => {
    const { controller, launch } = setup();

    await controller.match('m-1', {} as never);

    expect(launch.connectInfo).toHaveBeenCalledWith('m-1', undefined);
  });

  it('turns an unknown match into a 404, and does not look for a way to join it', async () => {
    const { controller, stages, launch } = setup();
    stages.getMatchDetail.mockRejectedValue(new TournamentError('not_found', 'match not found'));

    await expect(controller.match('nope', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(launch.connectInfo).not.toHaveBeenCalled();
  });
});
