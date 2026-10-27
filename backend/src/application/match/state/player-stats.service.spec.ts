import { PlayerStatsService } from './player-stats.service';
import { redisConst } from './redis.keys';

describe('PlayerStatsService', () => {
  let service: PlayerStatsService;
  let mockRedis: any;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mockRedis = {
      hget: jest.fn().mockImplementation((key: string, field: string) => {
        return Promise.resolve(store[`${key}::${field}`] || null);
      }),
      hset: jest.fn().mockImplementation((key: string, field: string, val: string) => {
        store[`${key}::${field}`] = val;
        return Promise.resolve(1);
      }),
      hgetall: jest.fn().mockImplementation((key: string) => {
        const result: Record<string, string> = {};
        const prefix = `${key}::`;
        for (const [k, v] of Object.entries(store)) {
          if (k.startsWith(prefix)) {
            result[k.slice(prefix.length)] = v;
          }
        }
        return Promise.resolve(result);
      }),
      del: jest.fn().mockImplementation((key: string) => {
        const prefix = `${key}::`;
        for (const k of Object.keys(store)) {
          if (k.startsWith(prefix)) delete store[k];
        }
        return Promise.resolve(1);
      }),
    };
    service = new PlayerStatsService(mockRedis);
  });

  it('records kills and deaths correctly with headshot scoring', async () => {
    const matchId = 'm-test-1';
    await service.recordKill(
      matchId,
      { steamId: 'p1', name: 'ZywOo' },
      { steamId: 'p2', name: 's1mple' },
      true,
    );

    const stats = await service.getPlayerStats(matchId);
    expect(stats.p1).toBeDefined();
    expect(stats.p1.kills).toBe(1);
    expect(stats.p1.headshots).toBe(1);
    expect(stats.p1.score).toBe(3); // 3 pts for headshot kill
    expect(stats.p1.deaths).toBe(0);

    expect(stats.p2).toBeDefined();
    expect(stats.p2.deaths).toBe(1);
    expect(stats.p2.kills).toBe(0);
    expect(stats.p2.score).toBe(0);
  });

  it('records standard kills without headshot (+2 pts)', async () => {
    const matchId = 'm-test-1';
    await service.recordKill(
      matchId,
      { steamId: 'p1', name: 'ZywOo' },
      { steamId: 'p2', name: 's1mple' },
      false,
    );

    const stats = await service.getPlayerStats(matchId);
    expect(stats.p1.kills).toBe(1);
    expect(stats.p1.headshots).toBe(0);
    expect(stats.p1.score).toBe(2);
  });

  it('records assists and flashAssists (+1 assist, +1 pt)', async () => {
    const matchId = 'm-test-1';
    await service.recordAssist(matchId, { steamId: 'p3', name: 'Spinx' }, false);
    await service.recordAssist(matchId, { steamId: 'p3', name: 'Spinx' }, true);

    const stats = await service.getPlayerStats(matchId);
    expect(stats.p3.assists).toBe(2);
    expect(stats.p3.flashAssists).toBe(1);
    expect(stats.p3.score).toBe(2);
  });

  it('records bomb plant and defuse counters and scoring (+2 pts each)', async () => {
    const matchId = 'm-test-1';
    await service.recordBombPlant(matchId, { steamId: 'p1', name: 'ZywOo' });
    await service.recordBombDefuse(matchId, { steamId: 'p2', name: 's1mple' });

    const stats = await service.getPlayerStats(matchId);
    expect(stats.p1.plants).toBe(1);
    expect(stats.p1.defuses).toBe(0);
    expect(stats.p1.score).toBe(2);
    expect(stats.p2.defuses).toBe(1);
    expect(stats.p2.plants).toBe(0);
    expect(stats.p2.score).toBe(2);
  });

  it('resets player combat stats cleanly', async () => {
    const matchId = 'm-test-1';
    await service.recordKill(matchId, { steamId: 'p1', name: 'ZywOo' });
    expect(Object.keys(await service.getPlayerStats(matchId))).toHaveLength(1);

    await service.resetPlayerStats(matchId);
    expect(Object.keys(await service.getPlayerStats(matchId))).toHaveLength(0);
  });
});
