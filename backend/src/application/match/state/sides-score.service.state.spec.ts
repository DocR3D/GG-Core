/**
 * SidesScoreService against an in-memory Redis: server binding, agent heartbeat, sides, score, counters, settings,
 * frozen result and knife. (sides-score.service.spec.ts covers the swap, the reconcile and the side/team mapping.)
 */
import { BadRequestException } from '@nestjs/common';
import { SidesScoreService } from './sides-score.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst } from './redis.keys';
import { DEFAULT_MATCH_SETTINGS, MatchReview } from '@domain/match-settings.types';

const M = 'm-1';
const SRV = 'srv-a';

function setup() {
  const redis = new FakeRedis();
  return { redis, svc: new SidesScoreService(redis as never) };
}

describe('SidesScoreService : server binding', () => {
  it('binds a server to its match in both directions, and finds the match back from the server and the server from the match', async () => {
    const { svc, redis } = setup();
    await svc.setServerMatch(SRV, M);
    expect(await svc.getMatchIdFromServerId(SRV)).toBe(M);
    expect(await svc.getServerIdFromMatchId(M)).toBe(SRV);
    expect(await redis.get(redisConst.matchServer(M))).toBe(SRV);
  });

  it('accepts a lifetime on the binding (key kept, value identical)', async () => {
    const { svc } = setup();
    await svc.setServerMatch(SRV, M, 3600);
    expect(await svc.getMatchIdFromServerId(SRV)).toBe(M);
  });

  it('finds the server by scanning the bindings when the reverse key is missing', async () => {
    const { svc, redis } = setup();
    await redis.set(redisConst.serverMatch('srv-b'), 'other');
    await redis.set(redisConst.serverMatch(SRV), M); // no match:<id>:server key
    expect(await svc.getServerIdFromMatchId(M)).toBe(SRV);
    expect(await svc.getServerIdFromMatchId('unknown')).toBeUndefined();
  });

  it('unbinding forgets the server → match link only, the reverse key and the match stay', async () => {
    const { svc, redis } = setup();
    await svc.setServerMatch(SRV, M);
    await svc.unbindServer(SRV);
    expect(await svc.getMatchIdFromServerId(SRV)).toBeNull();
    expect(await redis.get(redisConst.matchServer(M))).toBe(SRV);
  });

  it('keeps the id of the database game of a match', async () => {
    const { svc } = setup();
    expect(await svc.getDbMatchMapId(M)).toBeNull();
    await svc.setDbMatchMapId(M, 'game-1');
    expect(await svc.getDbMatchMapId(M)).toBe('game-1');
  });
});

describe('SidesScoreService : what the agent reports', () => {
  const key = redisConst.agentState(SRV);

  it('is offline when the agent never reported', async () => {
    expect(await setup().svc.getAgentState(SRV)).toEqual({ online: false });
  });

  it('reads the heartbeat: RCON state, last logs and last refused token, as ISO dates', async () => {
    const { svc, redis } = setup();
    await redis.set(key, JSON.stringify({ rcon: { connected: true }, logs: { lastAt: 1_794_000_000, lastBadTokenAt: 1_794_000_100 } }));
    expect(await svc.getAgentState(SRV)).toEqual({
      online: true,
      rconConnected: true,
      rconError: undefined,
      lastLogAt: new Date(1_794_000_000 * 1000).toISOString(),
      lastBadTokenAt: new Date(1_794_000_100 * 1000).toISOString(),
    });
  });

  it('reports the RCON error, and null / undefined dates when no log or bad token was seen', async () => {
    const { svc, redis } = setup();
    await redis.set(key, JSON.stringify({ rcon: { connected: false, error: 'bad password' }, logs: {} }));
    expect(await svc.getAgentState(SRV)).toMatchObject({ online: true, rconConnected: false, rconError: 'bad password', lastLogAt: null, lastBadTokenAt: undefined });
    await redis.set(key, JSON.stringify({}));
    expect(await svc.getAgentState(SRV)).toMatchObject({ online: true, rconConnected: false, lastLogAt: null });
  });

  it('stays online with nothing else when the heartbeat is damaged', async () => {
    const { svc, redis } = setup();
    await redis.set(key, '{broken');
    expect(await svc.getAgentState(SRV)).toEqual({ online: true });
  });
});

describe('SidesScoreService : sides', () => {
  it('reads null until both sides are valid, writes only CT or T', async () => {
    const { svc, redis } = setup();
    expect(await svc.getSides(M)).toBeNull();
    await redis.hset(redisConst.sides(M), { home: 'CT' });
    expect(await svc.getSides(M)).toBeNull(); // half-written

    await svc.setSides(M, { home: 'T', away: 'CT' });
    expect(await svc.getSides(M)).toEqual({ home: 'T', away: 'CT' });

    await expect(svc.setSides(M, { home: 'TERRORIST', away: 'CT' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setSides(M, { home: 'CT', away: 'SPECTATOR' as never })).rejects.toBeInstanceOf(BadRequestException);
    expect(await svc.getSides(M)).toEqual({ home: 'T', away: 'CT' }); // refused writes change nothing
  });

  it('maps TERRORIST to T and gives null to a side that is nobody (spectator)', async () => {
    const { svc } = setup();
    await svc.setSides(M, { home: 'T', away: 'CT' });
    expect(await svc.sideToLogical(M, 'TERRORIST')).toBe('home');
    expect(await svc.sideToLogical(M, 'SPECTATOR' as never)).toBeNull();
    expect(await svc.logicalToSide(M, 'away')).toBe('CT');
    expect(await svc.logicalToSide(M, 'nobody' as never)).toBeNull();
  });
});

describe('SidesScoreService : score', () => {
  it('starts at zero, with the phase at warmup, and counts the rounds', async () => {
    const { svc } = setup();
    expect(await svc.getScore(M)).toEqual({ round: 0, ct: 0, t: 0, home: 0, away: 0, phase: 'warmup' });
    await svc.initScore(M);
    expect(await svc.getRound(M)).toBe(0);
    expect(await svc.incRound(M)).toBe(1);
    expect(await svc.incRound(M)).toBe(2);
    expect(await svc.getRound(M)).toBe(2);
  });

  it('adds a point to the winning side, to its team (whatever the sides), and one round', async () => {
    const { svc } = setup();
    await svc.setSides(M, { home: 'T', away: 'CT' });
    await svc.initScore(M);
    await svc.addPoint(M, 'TERRORIST');
    await svc.addPoint(M, 'T');
    await svc.addPoint(M, 'CT');
    expect(await svc.getScore(M)).toMatchObject({ round: 3, ct: 1, t: 2, home: 2, away: 1 });
  });

  it('a side belonging to nobody scores for no team', async () => {
    const { svc } = setup();
    await svc.setSides(M, { home: 'CT', away: 'T' });
    await svc.addPoint(M, 'SPECTATOR' as never);
    expect(await svc.getScore(M)).toMatchObject({ round: 1, ct: 0, t: 0, home: 0, away: 0 });
  });

  it('keeps the phase and reads it back in the score', async () => {
    const { svc } = setup();
    expect(await svc.getPhase(M)).toBeNull();
    await svc.setPhase(M, 'live_main');
    expect(await svc.getPhase(M)).toBe('live_main');
    expect((await svc.getScore(M)).phase).toBe('live_main');
  });

  it('keeps the guard counters: last scored round, halftime played, overtime count', async () => {
    const { svc } = setup();
    expect([await svc.getLastScoredRound(M), await svc.isHalftimePlayed(M), await svc.getOvertimeCount(M)]).toEqual([0, false, 0]);
    await svc.setLastScoredRound(M, 12);
    await svc.setHalftimePlayed(M, true);
    await svc.setOvertimeCount(M, 2);
    expect([await svc.getLastScoredRound(M), await svc.isHalftimePlayed(M), await svc.getOvertimeCount(M)]).toEqual([12, true, 2]);
    await svc.setHalftimePlayed(M, false);
    expect(await svc.isHalftimePlayed(M)).toBe(false);
  });
});

describe('SidesScoreService : settings', () => {
  it('gives the defaults to a match that has none, as a copy', async () => {
    const { svc } = setup();
    const s = await svc.getSettings(M);
    expect(s).toEqual(DEFAULT_MATCH_SETTINGS);
    s.mrFormat = 99;
    expect((await svc.getSettings(M)).mrFormat).toBe(DEFAULT_MATCH_SETTINGS.mrFormat);
  });

  it('stores every setting and reads it back with its type', async () => {
    const { svc } = setup();
    const all = {
      warmupAfterKnife: true, warmupAtHalftime: true, warmupAtOvertime: true, postgameAction: 'none' as const,
      postgameResetDelaySec: 60, postgameDemoStopDelaySec: 0, postgameKickDelaySec: 0, mrFormat: 15, overtimeMrFormat: 4,
      overtimeEnabled: false, knifeEnabled: false, tacticalPauseBankSec: 90, fixedSides: true,
    };
    await svc.setSettings(M, all as never);
    expect(await svc.getSettings(M)).toEqual(all);
  });

  it('a partial update changes only what it names, and an empty one writes nothing', async () => {
    const { svc } = setup();
    await svc.setSettings(M, { mrFormat: 15, knifeEnabled: false });
    await svc.setSettings(M, { fixedSides: true });
    await svc.setSettings(M, {});
    expect(await svc.getSettings(M)).toEqual({ ...DEFAULT_MATCH_SETTINGS, mrFormat: 15, knifeEnabled: false, fixedSides: true });

    const fresh = setup();
    await fresh.svc.setSettings(M, {});
    expect(await fresh.redis.exists(redisConst.settings(M))).toBe(0);
  });

  it('a delay of 0 is a real value (demo and kick delays), not "unset"', async () => {
    const { svc } = setup();
    await svc.setSettings(M, { postgameDemoStopDelaySec: 0, postgameKickDelaySec: 0 });
    const s = await svc.getSettings(M);
    expect(s.postgameDemoStopDelaySec).toBe(0);
    expect(s.postgameKickDelaySec).toBe(0);
  });
});

describe('SidesScoreService : frozen result (review)', () => {
  const review: MatchReview = { reason: 'final_score_mismatch', serverScore: { ct: 13, t: 5 }, ggScore: { ct: 12, t: 5 }, ggPhase: 'live_main', openedAt: 1 };

  it('stores, reads and clears the review, and treats a damaged one as none', async () => {
    const { svc, redis } = setup();
    expect(await svc.getReview(M)).toBeNull();
    await svc.setReview(M, review);
    expect(await svc.getReview(M)).toEqual(review);
    await svc.setReview(M, null);
    expect(await svc.getReview(M)).toBeNull();
    await redis.set(redisConst.review(M), 'not json');
    expect(await svc.getReview(M)).toBeNull();
  });
});

describe('SidesScoreService : knife', () => {
  it('records which team won the knife by its side, and waits for its choice', async () => {
    const { svc, redis } = setup();
    await svc.setSides(M, { home: 'T', away: 'CT' });
    await redis.hset(redisConst.teams(M), { home_id: 'h', home_name: 'Alpha', away_id: 'a', away_name: 'Bravo' });

    await svc.applyKnifeResult(M, 'CT');

    expect(await redis.get(redisConst.knifeChoice(M))).toBe('pending');
    expect(await svc.getKnifeWinner(M)).toEqual({ side: 'CT', logical: 'away', team: { id: 'a', name: 'Bravo' } });
  });

  it('refuses a winning side that matches neither team and records nothing', async () => {
    const { svc, redis } = setup();
    await expect(svc.applyKnifeResult(M, 'CT')).rejects.toThrow('Incohérence sides'); // no sides at all
    expect(await redis.get(redisConst.knifeChoice(M))).toBeNull();
  });

  it('works out the team from the sides when only the side was stored', async () => {
    const { svc, redis } = setup();
    await svc.setSides(M, { home: 'CT', away: 'T' });
    await redis.hset(redisConst.teams(M), { home_id: 'h', home_name: 'Alpha', away_id: 'a', away_name: 'Bravo' });
    await redis.set(redisConst.knifeWinnerSide(M), 'CT');
    expect(await svc.getKnifeWinner(M)).toEqual({ side: 'CT', logical: 'home', team: { id: 'h', name: 'Alpha' } });
  });

  it('has no winner before the knife', async () => {
    expect(await setup().svc.getKnifeWinner(M)).toEqual({ side: null, logical: null, team: null });
  });
});
