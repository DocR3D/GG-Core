/**
 * TeamsRosterService against an in-memory Redis: the teams of a match (names, ids, the older JSON string format), the
 * score read with its teams, the roster of players with its two lineups, and the money / equipment of the players.
 */
import { TeamsRosterService, type PlayerInfo } from './rosters.service';
import { SidesScoreService } from './sides-score.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst } from './redis.keys';

const M = 'm-1';

function setup() {
  const redis = new FakeRedis();
  const sidesScore = new SidesScoreService(redis as never);
  return { redis, sidesScore, svc: new TeamsRosterService(redis as never, sidesScore) };
}

const garitos: PlayerInfo = { steamId: '[U:1:1]', name: 'Garitos', logical: 'home' };
const lana: PlayerInfo = { steamId: '[U:1:2]', name: 'Lana', logical: 'away' };

describe('TeamsRosterService : teams', () => {
  it('keeps the ids and names given, and gives back the ids of both teams', async () => {
    const { svc } = setup();
    await svc.setTeams(M, { home_id: 'h', away_id: 'a', home_name: 'Démo Rouge', away_name: 'Démo Bleue' });

    expect(await svc.getTeamIds(M)).toEqual({ home_id: 'h', away_id: 'a' });
  });

  it('merges a later update with what was there, and drops the empty values', async () => {
    const { svc, redis } = setup();
    await svc.setTeams(M, { home_id: 'h', home_name: 'Démo Rouge' });
    await svc.setTeams(M, { away_id: 'a', home_name: '' });

    expect(await redis.hgetall(redisConst.teams(M))).toEqual({ home_id: 'h', away_id: 'a' });
  });

  it('answers null ids when the match has no teams yet', async () => {
    const { svc } = setup();
    expect(await svc.getTeamIds(M)).toEqual({ home_id: null, away_id: null });
  });

  it('still reads the older format where the teams were one JSON string, and rewrites it as a hash', async () => {
    const { svc, redis } = setup();
    redis.strings.set(redisConst.teams(M), JSON.stringify({ home_id: 'h', away_id: 'a' }));

    expect(await svc.getTeamIds(M)).toEqual({ home_id: 'h', away_id: 'a' });

    await svc.setTeams(M, { home_name: 'Démo Rouge' });
    expect(redis.strings.has(redisConst.teams(M))).toBe(false);
    expect(await redis.hgetall(redisConst.teams(M))).toEqual({ home_id: 'h', away_id: 'a', home_name: 'Démo Rouge' });
  });

  it('treats a broken string, or one that is not an object, as no teams', async () => {
    const { svc, redis } = setup();
    redis.strings.set(redisConst.teams(M), '{not json');
    expect(await svc.getTeamIds(M)).toEqual({ home_id: null, away_id: null });

    redis.strings.set(redisConst.teams(M), 'null');
    expect(await svc.getTeamIds(M)).toEqual({ home_id: null, away_id: null });
  });
});

describe('TeamsRosterService : score with the teams', () => {
  it('derives which team plays CT and T from the sides, and reads the score', async () => {
    const { svc, sidesScore, redis } = setup();
    await svc.setTeams(M, { home_id: 'h', away_id: 'a', home_name: 'Démo Rouge', away_name: 'Démo Bleue' });
    await sidesScore.setSides(M, { home: 'T', away: 'CT' });
    await redis.hset(redisConst.score(M), { ct: 7, t: 5 });

    const view = await svc.getScoreWithTeams(M);

    expect(view.score).toEqual({ t: 5, ct: 7 });
    expect(view.teams.ct.id).toBe('a');
    expect(view.teams.t.id).toBe('h');
    expect(view.teams.home).toEqual({ id: 'h', name: 'Démo Rouge' });
    expect(view.teams.away).toEqual({ id: 'a', name: 'Démo Bleue' });
  });

  it('follows a change of sides', async () => {
    const { svc, sidesScore } = setup();
    await svc.setTeams(M, { home_id: 'h', away_id: 'a' });
    await sidesScore.setSides(M, { home: 'CT', away: 'T' });

    const view = await svc.getScoreWithTeams(M);
    expect([view.teams.ct.id, view.teams.t.id]).toEqual(['h', 'a']);
  });

  it('prefers the CT and T ids and names stored explicitly, and falls back to "CT" / "T" for the names', async () => {
    const { svc, sidesScore } = setup();
    await svc.setTeams(M, { home_id: 'h', away_id: 'a', ct_id: 'x', t_id: 'y', ct_name: 'Les CT' });
    await sidesScore.setSides(M, { home: 'CT', away: 'T' });

    const view = await svc.getScoreWithTeams(M);
    expect(view.teams.ct).toEqual({ id: 'x', name: 'Les CT' });
    expect(view.teams.t).toEqual({ id: 'y', name: 'T' });
  });

  it('without sides, teams or score: zero to zero, no ids, no home or away', async () => {
    const { svc } = setup();

    expect(await svc.getScoreWithTeams(M)).toEqual({
      matchId: M,
      score: { t: 0, ct: 0 },
      teams: { ct: { id: null, name: 'CT' }, t: { id: null, name: 'T' }, home: undefined, away: undefined },
    });
  });

  it('reads a score that is not a number as zero', async () => {
    const { svc, redis } = setup();
    await redis.hset(redisConst.score(M), { ct: 'abc', t: '3' });

    expect((await svc.getScoreWithTeams(M)).score).toEqual({ t: 3, ct: 0 });
  });
});

describe('TeamsRosterService : players', () => {
  it('adds a player to the roster and to the lineup of his team, with the time he joined', async () => {
    const { svc, redis } = setup();
    const before = Date.now();
    await svc.upsertPlayer(M, garitos);
    await svc.upsertPlayer(M, lana);

    const { home, away } = await svc.getPlayers(M);
    expect(home.map((p) => p.steamId)).toEqual(['[U:1:1]']);
    expect(away.map((p) => p.steamId)).toEqual(['[U:1:2]']);
    expect(home[0].joinedTs).toBeGreaterThanOrEqual(before);
    expect(await redis.lrange(redisConst.lineupHome(M), 0, -1)).toEqual(['[U:1:1]']);
  });

  it('keeps the time given when there is one', async () => {
    const { svc } = setup();
    await svc.upsertPlayer(M, { ...garitos, joinedTs: 123 });
    expect((await svc.getPlayers(M)).home[0].joinedTs).toBe(123);
  });

  it('updates a known player without adding him twice, and keeps when he joined', async () => {
    const { svc } = setup();
    await svc.upsertPlayer(M, { ...garitos, joinedTs: 123 });
    await svc.upsertPlayer(M, { steamId: garitos.steamId, name: 'Garitos II', logical: 'home' });

    const { home } = await svc.getPlayers(M);
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ name: 'Garitos II', joinedTs: 123 });
  });

  it('moves a known player to the team given (the lineups follow), unless the team must be preserved', async () => {
    const { svc } = setup();
    await svc.upsertPlayer(M, garitos);
    await svc.upsertPlayer(M, { ...garitos, logical: 'away' }, { preserveLogical: true });
    expect((await svc.getPlayers(M)).home).toHaveLength(1);

    await svc.upsertPlayer(M, { ...garitos, logical: 'away' });
    const { home, away } = await svc.getPlayers(M);
    expect(home).toHaveLength(0);
    expect(away.map((p) => p.steamId)).toEqual([garitos.steamId]);
  });

  it('moves a player to the other team, or says nothing was done for an unknown one', async () => {
    const { svc } = setup();
    await svc.upsertPlayer(M, garitos);

    expect(await svc.movePlayerLogical(M, garitos.steamId, 'away')).toBe(true);
    expect((await svc.getPlayers(M)).away.map((p) => p.steamId)).toEqual([garitos.steamId]);
    expect((await svc.getPlayers(M)).home).toEqual([]);
    expect(await svc.movePlayerLogical(M, '[U:1:99]', 'home')).toBe(false);
  });

  it('answers true and changes nothing when the player is already in that team', async () => {
    const { svc, redis } = setup();
    await svc.upsertPlayer(M, garitos);
    const before = await redis.hget(redisConst.playersHash(M), garitos.steamId);

    expect(await svc.movePlayerLogical(M, garitos.steamId, 'home')).toBe(true);
    expect(await redis.hget(redisConst.playersHash(M), garitos.steamId)).toBe(before);
  });

  it('removes a player from the roster and from both lineups', async () => {
    const { svc } = setup();
    await svc.upsertPlayer(M, garitos);
    await svc.upsertPlayer(M, lana);

    await svc.removePlayer(M, garitos.steamId);

    expect(await svc.getPlayers(M)).toEqual({ home: [], away: [expect.objectContaining({ steamId: lana.steamId })] });
  });

  it('clears the roster, the lineups and the economy of the match', async () => {
    const { svc, redis } = setup();
    await svc.upsertPlayer(M, garitos);
    await svc.setPlayerMoney(M, garitos.steamId, 800);
    await svc.setPlayerEquipValue(M, garitos.steamId, 2000);

    await svc.clearRoster(M);

    expect(await svc.getPlayers(M)).toEqual({ home: [], away: [] });
    expect(await svc.getPlayersEconomy(M)).toEqual({});
    expect(await redis.exists(redisConst.moneyHash(M), redisConst.equipHash(M))).toBe(0);
  });

  it('skips a lineup entry that has no record or a broken one, and keeps the order of the lineup', async () => {
    const { svc, redis } = setup();
    await svc.upsertPlayer(M, garitos);
    await svc.upsertPlayer(M, { steamId: '[U:1:3]', name: 'Third', logical: 'home' });
    await redis.rpush(redisConst.lineupHome(M), '[U:1:ghost]', '[U:1:broken]');
    await redis.hset(redisConst.playersHash(M), '[U:1:broken]', '{oops');

    expect((await svc.getPlayers(M)).home.map((p) => p.steamId)).toEqual(['[U:1:1]', '[U:1:3]']);
  });
});

describe('TeamsRosterService : money and equipment', () => {
  it('gives the money and the equipment value of every player who has one, zero for the missing half', async () => {
    const { svc } = setup();
    await svc.setPlayerMoney(M, '[U:1:1]', 800);
    await svc.setPlayerEquipValue(M, '[U:1:1]', 2700);
    await svc.setPlayerMoney(M, '[U:1:2]', 16000);
    await svc.setPlayerEquipValue(M, '[U:1:3]', 650);

    expect(await svc.getPlayersEconomy(M)).toEqual({
      '[U:1:1]': { money: 800, equip: 2700 },
      '[U:1:2]': { money: 16000, equip: 0 },
      '[U:1:3]': { money: 0, equip: 650 },
    });
  });

  it('reads a value that is not a number as zero', async () => {
    const { svc, redis } = setup();
    await redis.hset(redisConst.moneyHash(M), '[U:1:1]', 'lots');

    expect(await svc.getPlayersEconomy(M)).toEqual({ '[U:1:1]': { money: 0, equip: 0 } });
  });
});
