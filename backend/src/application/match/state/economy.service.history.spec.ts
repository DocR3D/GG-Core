/**
 * EconomyService, the photos of the start of each round: the loss streaks of the teams and the money of each player, kept
 * round by round so that a round can be put back (an in-memory Redis, the real service).
 */
import { EconomyService } from './economy.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst } from './redis.keys';

const M = 'm-1';

function setup(playersEconomy: Record<string, { money: number; equip: number }> = {}) {
  const redis = new FakeRedis();
  const teamsRoster = { getPlayersEconomy: jest.fn().mockResolvedValue(playersEconomy) };
  return { redis, teamsRoster, service: new EconomyService(redis as never, {} as never, teamsRoster as never) };
}

describe('EconomyService : the photos of a round', () => {
  it('keeps the money and the equipment value of each player at the start of a round', async () => {
    const { service } = setup({ '[U:1:1]': { money: 3900, equip: 1000 }, '[U:1:2]': { money: 800, equip: 0 } });

    await service.snapshotPlayersEconomy(M, 4);

    expect(await service.getPlayersEconomyAt(M, 4)).toEqual({ '[U:1:1]': { money: 3900, equip: 1000 }, '[U:1:2]': { money: 800, equip: 0 } });
  });

  it('keeps each round on its own, and says null for a round nobody photographed', async () => {
    const { service, teamsRoster } = setup({ '[U:1:1]': { money: 3900, equip: 0 } });
    await service.snapshotPlayersEconomy(M, 4);
    teamsRoster.getPlayersEconomy.mockResolvedValue({ '[U:1:1]': { money: 100, equip: 0 } });
    await service.snapshotPlayersEconomy(M, 5);

    expect((await service.getPlayersEconomyAt(M, 4))?.['[U:1:1]'].money).toBe(3900);
    expect((await service.getPlayersEconomyAt(M, 5))?.['[U:1:1]'].money).toBe(100);
    expect(await service.getPlayersEconomyAt(M, 6)).toBeNull();
  });

  it('keeps the loss streaks of the teams at the start of a round, as numbers, and null for a round nobody photographed', async () => {
    const { service, redis } = setup();
    await redis.hset(redisConst.economyTeam(M), { home_loss_streak: '0', away_loss_streak: '3', home_loss_bonus: '0' });

    await service.snapshotTeamEconomy(M, 7);
    await redis.hset(redisConst.economyTeam(M), { home_loss_streak: '1', away_loss_streak: '0' });

    expect(await service.getTeamEconomyAt(M, 7)).toEqual({ home_loss_streak: 0, away_loss_streak: 3 });
    expect(await service.getTeamEconomyAt(M, 8)).toBeNull();
  });

  it('reads a streak that is not a number as zero', async () => {
    const { service, redis } = setup();
    await redis.hset(redisConst.economyTeam(M), { home_loss_streak: 'x', away_loss_streak: '2' });
    await service.snapshotTeamEconomy(M, 1);

    expect(await service.getTeamEconomyAt(M, 1)).toEqual({ home_loss_streak: 0, away_loss_streak: 2 });
  });

  it('forgets every photo of both kinds when the economy of a match is started again', async () => {
    const { service } = setup({ '[U:1:1]': { money: 800, equip: 0 } });
    await service.snapshotPlayersEconomy(M, 1);
    await service.snapshotTeamEconomy(M, 1);

    await service.initEconomy(M);

    expect(await service.getPlayersEconomyAt(M, 1)).toBeNull();
    expect(await service.getTeamEconomyAt(M, 1)).toBeNull();
  });
});
