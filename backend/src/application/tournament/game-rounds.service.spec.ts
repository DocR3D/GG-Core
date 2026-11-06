import { GameRoundsService, roundsFromEvents } from './game-rounds.service';

const win = (winner: string, ct: number, t: number, reason = 'elim', timestamp = 0) => ({ timestamp, payload: { winner, reason, score: { ct, t } } });

describe('roundsFromEvents', () => {
  it('numbers each round with the sum of the scores after it, oldest first', () => {
    const rounds = roundsFromEvents([win('CT', 1, 0, 'defused', 10), win('T', 1, 1, 'bomb_exploded', 20), win('CT', 2, 1, 'time', 30)]);
    expect(rounds.map((r) => [r.number, r.winner, r.reason])).toEqual([
      [1, 'CT', 'defused'],
      [2, 'T', 'bomb_exploded'],
      [3, 'CT', 'time'],
    ]);
    expect(rounds[2]).toMatchObject({ ct: 2, t: 1, at: 30 });
  });

  it('drops the rounds after a backup restore and keeps the replayed ones', () => {
    // rounds 1 to 4 played, the game goes back to round 2 and replays: round 3 won by T this time
    const rounds = roundsFromEvents([win('CT', 1, 0), win('CT', 2, 0), win('CT', 3, 0), win('CT', 4, 0), win('T', 2, 1), win('T', 2, 2)]);
    expect(rounds.map((r) => [r.number, r.winner])).toEqual([
      [1, 'CT'],
      [2, 'CT'],
      [3, 'T'],
      [4, 'T'],
    ]);
    expect(rounds[3]).toMatchObject({ ct: 2, t: 2 });
  });

  it('numbers by order of arrival when the event has no score, and calls an unknown winner "none"', () => {
    const rounds = roundsFromEvents([
      { timestamp: 1, payload: { winner: 'CT' } },
      { timestamp: 2, payload: { winner: 'none', reason: 'draw' } },
      { timestamp: 3, payload: null },
    ]);
    expect(rounds.map((r) => [r.number, r.winner, r.reason, r.ct])).toEqual([
      [1, 'CT', null, null],
      [2, 'none', 'draw', null],
      [3, 'none', null, null],
    ]);
  });

  it('accepts a bigint timestamp (what Prisma returns)', () => {
    expect(roundsFromEvents([{ timestamp: 1793965236728n, payload: { winner: 'T', score: { ct: 0, t: 1 } } }])[0].at).toBe(1793965236728);
  });
});

describe('GameRoundsService', () => {
  it('reads the team_round_win events of the game, oldest first, and returns the rounds', async () => {
    const findMany = jest.fn().mockResolvedValue([win('CT', 1, 0, 'elim', 5)]);
    const service = new GameRoundsService({ eventPrimary: { findMany } } as never);
    const rounds = await service.forGame('game-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { matchId: 'game-1', type: 'team_round_win' }, orderBy: { timestamp: 'asc' } }));
    expect(rounds).toHaveLength(1);
  });
});
