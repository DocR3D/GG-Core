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

  it('teamkill: no kill, no headshot and no point for the killer, but a death for the victim (CS2 round_stats)', async () => {
    const matchId = 'm-test-tk';
    await service.recordKill(matchId, { steamId: 'p1', name: 'Player_01' }, { steamId: 'p2', name: 'Player_02' }, false);
    await service.recordKill(matchId, { steamId: 'p1', name: 'Player_01' }, { steamId: 'p3', name: 'Player_03' }, true, true);

    const stats = await service.getPlayerStats(matchId);
    expect(stats.p1).toMatchObject({ kills: 1, headshots: 0, score: 2, deaths: 0 });
    expect(stats.p3).toMatchObject({ kills: 0, deaths: 1 });
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

  it('rolls stats back to a round-start snapshot (backup restore) and drops later kills/deaths', async () => {
    const matchId = 'm-restore';
    await service.recordKill(matchId, { steamId: 'p1' }, { steamId: 'p2' }, true);
    await service.snapshotPlayerStats(matchId, 6); // start of round 7

    // round 7 then the restore respawn (world suicides) — all voided by CS2
    await service.recordKill(matchId, { steamId: 'p1' }, { steamId: 'p2' }, false);
    await service.recordKill(matchId, undefined as any, { steamId: 'p1' }, false);

    await expect(service.restorePlayerStats(matchId, 6)).resolves.toBe(true);
    const stats = await service.getPlayerStats(matchId);
    expect(stats.p1).toMatchObject({ kills: 1, headshots: 1, deaths: 0 });
    expect(stats.p2).toMatchObject({ deaths: 1 });

    await expect(service.restorePlayerStats(matchId, 3)).resolves.toBe(false); // no snapshot: untouched
    expect((await service.getPlayerStats(matchId)).p1.kills).toBe(1);
  });
});
