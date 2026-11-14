import { PlayersController } from './players.controller';

function makeController() {
  const matchState = {
    upsertPlayer: jest.fn().mockResolvedValue(undefined),
    movePlayerLogical: jest.fn().mockResolvedValue(true),
    removePlayer: jest.fn().mockResolvedValue(undefined),
    getPlayers: jest.fn().mockResolvedValue({ home: [], away: [] }),
  };
  return { matchState, controller: new PlayersController(matchState as never) };
}

describe('PlayersController', () => {
  it('upsert hands the player to the match state and answers ok', async () => {
    const { controller, matchState } = makeController();
    const body = { steamId: '[U:1:10000004]', name: 'Garitos', logical: 'home' as const };

    expect(await controller.upsert('m1', body)).toEqual({ ok: true });
    expect(matchState.upsertPlayer).toHaveBeenCalledWith('m1', body);
  });

  it.each([true, false])('move answers what the match state says (%s: the player is known or not)', async (known) => {
    const { controller, matchState } = makeController();
    matchState.movePlayerLogical.mockResolvedValue(known);

    expect(await controller.move('m1', '[U:1:10000004]', { logical: 'away' })).toEqual({ ok: known });
    expect(matchState.movePlayerLogical).toHaveBeenCalledWith('m1', '[U:1:10000004]', 'away');
  });

  it('remove asks the match state to forget the player and answers ok', async () => {
    const { controller, matchState } = makeController();

    expect(await controller.remove('m1', '[U:1:10000004]')).toEqual({ ok: true });
    expect(matchState.removePlayer).toHaveBeenCalledWith('m1', '[U:1:10000004]');
  });

  it('list answers the players by team', async () => {
    const { controller, matchState } = makeController();
    const roster = { home: [{ steamId: 'a', logical: 'home' as const }], away: [] };
    matchState.getPlayers.mockResolvedValue(roster);

    expect(await controller.list('m1')).toBe(roster);
    expect(matchState.getPlayers).toHaveBeenCalledWith('m1');
  });
});
