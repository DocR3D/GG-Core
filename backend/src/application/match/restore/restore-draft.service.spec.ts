/**
 * RestoreDraftService : what GG-Core remembers of a round, as the start of what an admin sends to manual-restore/backup. The
 * services it reads are stubs with the data of one match; the side logic is the real one.
 */
import { RestoreDraftService } from './restore-draft.service';
import { RoundBackupService } from '@app/match/backup/round-backup.service';
import { MatchAdminError } from '@app/match/admin/match-admin.service';
import { validateRestoreState } from '@domain/restore/restore-state';

const GAME = '0b8a3a51-6d1c-4f0e-9d7c-1f2a3b4c5d6e';
const HOME_1 = '76561198000000001';
const HOME_2 = '76561198000000002';
const AWAY_1 = '76561198000000011';

interface Setup {
  homeSide?: 'CT' | 'T' | null;
  score?: { ct: number; t: number };
  winners?: Array<'CT' | 'T' | 'none'>;
  teamAt?: Record<number, { home_loss_streak: number; away_loss_streak: number }>;
  moneyAt?: Record<number, Record<string, { money: number; equip: number }>>;
  moneyNow?: Record<string, { money: number; equip: number }>;
  streaksNow?: { home_loss_streak: number; away_loss_streak: number };
  roster?: { home: Array<{ steamId: string; name?: string }>; away: Array<{ steamId: string; name?: string }> };
  mapName?: string | null;
  withEvents?: boolean;
}

function setup(over: Setup = {}) {
  const state = {
    getSides: jest.fn().mockResolvedValue(over.homeSide === null ? null : { home: over.homeSide ?? 'CT', away: (over.homeSide ?? 'CT') === 'CT' ? 'T' : 'CT' }),
    getScore: jest.fn().mockResolvedValue({ ct: 0, t: 0, ...over.score }),
    getPlayers: jest.fn().mockResolvedValue(over.roster ?? { home: [{ steamId: HOME_1, name: 'Garitos' }, { steamId: HOME_2, name: 'Lana' }], away: [{ steamId: AWAY_1, name: 'Zed' }] }),
    getScoreWithTeams: jest.fn().mockResolvedValue({ teams: { home: { id: 'h', name: 'Démo Rouge' }, away: { id: 'a', name: 'Démo Bleue' } } }),
    getTeamEconomyAt: jest.fn(async (_m: string, played: number) => over.teamAt?.[played] ?? null),
    getPlayersEconomyAt: jest.fn(async (_m: string, played: number) => over.moneyAt?.[played] ?? null),
    getTeamEconomyMeta: jest.fn().mockResolvedValue(over.streaksNow ?? { home_loss_streak: 0, away_loss_streak: 0 }),
    getPlayersEconomy: jest.fn().mockResolvedValue(over.moneyNow ?? {}),
  };
  const rounds = (over.winners ?? []).map((winner, i) => ({ number: i + 1, winner, reason: null, ct: null, t: null, at: 0 }));
  const gameRounds = { forGame: jest.fn().mockResolvedValue(rounds) };
  const prisma = { matchMap: { findUnique: jest.fn().mockResolvedValue(over.mapName === null ? null : { mapName: over.mapName ?? 'de_mirage' }) } };
  const service = new RestoreDraftService(state as never, new RoundBackupService(), over.withEvents === false ? undefined : (gameRounds as never), prisma as never);
  return { service, state, gameRounds, prisma };
}

const failure = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as MatchAdminError);

describe('RestoreDraftService : finding the round', () => {
  it('wants the round, or the two scores', async () => {
    const { service } = setup();

    const error = await failure(service.draft(GAME, {}));

    expect(error).toBeInstanceOf(MatchAdminError);
    expect(error).toMatchObject({ code: 'invalid' });
  });

  it.each([0, 201, 1.5, Number.NaN])('refuses the round %s', async (round) => {
    const { service } = setup();

    expect(await failure(service.draft(GAME, { round }))).toMatchObject({ code: 'invalid', message: 'round: a whole number from 1 to 200' });
  });

  it('takes the round after the two scores when it is the scores that are given', async () => {
    const { service } = setup({ score: { ct: 3, t: 2 } });

    const { state } = await service.draft(GAME, { scoreHome: 3, scoreAway: 2 });

    expect(state.round).toBe(6);
  });

  it('refuses a round and scores that do not agree', async () => {
    const { service } = setup();

    expect(await failure(service.draft(GAME, { round: 6, scoreHome: 5, scoreAway: 5 }))).toMatchObject({ code: 'invalid' });
  });

  it('says so when the match has not started: no sides', async () => {
    const { service } = setup({ homeSide: null });

    expect(await failure(service.draft(GAME, { round: 1 }))).toMatchObject({ code: 'conflict' });
  });
});

describe('RestoreDraftService : the first round', () => {
  it('is 0 - 0 with the start money and the start loadout of each side, and only the inventory to check', async () => {
    const { service } = setup();

    const draft = await service.draft(GAME, { round: 1 });

    expect(draft.state).toMatchObject({ round: 1, homeSide: 'CT', home: { score: 0, lossStreak: 0 }, away: { score: 0, lossStreak: 0 }, map: 'de_mirage' });
    expect(draft.state.players).toEqual([
      expect.objectContaining({ steamId: HOME_1, name: 'Garitos', team: 'home', money: 800, items: ['weapon_knife', 'weapon_usp_silencer'] }),
      expect.objectContaining({ steamId: HOME_2, team: 'home', money: 800 }),
      expect.objectContaining({ steamId: AWAY_1, team: 'away', money: 800, items: ['weapon_knife_t', 'weapon_glock'] }),
    ]);
    expect(draft.sources.money).toBe('pistol round: the start money');
    expect(draft.missing).toEqual(['inventory']);
    expect(draft.teams).toEqual({ home: 'Démo Rouge', away: 'Démo Bleue' });
  });

  it('says what to do with it: send the corrected state to the backup route of the same match', async () => {
    const { service } = setup();

    const { next } = await service.draft(GAME, { round: 1 });

    expect(next).toEqual({ method: 'POST', path: `/api/matches/${GAME}/manual-restore/backup`, body: 'state, once corrected' });
  });

  it('gives a state the restore accepts, once the admin has nothing to add', async () => {
    const { service } = setup();

    const { state } = await service.draft(GAME, { round: 1 });

    expect(validateRestoreState(state).errors).toEqual([]);
  });
});

describe('RestoreDraftService : the score, round by round', () => {
  // home plays CT in rounds 1 to 12: it wins the rounds the CT win
  it('counts what each team won from the events of the game, and which side home played', async () => {
    const { service } = setup({ winners: ['CT', 'T', 'T', 'CT'], score: { ct: 2, t: 2 } });

    const { state, sources } = await service.draft(GAME, { round: 5 });

    expect(state).toMatchObject({ round: 5, homeSide: 'CT', home: { score: 2 }, away: { score: 2 } });
    expect(sources.score).toBe('game events, round by round');
  });

  it('follows the sides across the half-time, with the halves', async () => {
    // 7 rounds won by the CT and 5 by the T in the first half (home is CT: home 7, away 5), then the CT win round 13 (home is T now)
    const winners: Array<'CT' | 'T'> = [...Array<'CT'>(7).fill('CT'), ...Array<'T'>(5).fill('T'), 'CT'];
    const { service } = setup({ homeSide: 'T', score: { ct: 6, t: 7 }, winners });

    const { state, sources, missing } = await service.draft(GAME, { round: 14 });

    expect(state).toMatchObject({ round: 14, homeSide: 'T', home: { score: 7 }, away: { score: 6 }, firstHalf: { home: 7, away: 5 } });
    expect(state.secondHalf).toBeUndefined();
    expect(sources.halves).toBe('game events, round by round');
    expect(missing).not.toContain('halves');
  });

  it('gives the halves of the regulation once overtime is reached', async () => {
    // 12 rounds each way: home wins the 12 rounds of the CT in the first half and the 12 of the T in the second half
    const winners: Array<'CT' | 'T'> = [...Array<'CT'>(12).fill('CT'), ...Array<'T'>(12).fill('T')];
    const { service } = setup({ homeSide: 'CT', score: { ct: 12, t: 12 }, winners });

    const { state } = await service.draft(GAME, { round: 25 });

    expect(state).toMatchObject({ round: 25, firstHalf: { home: 12, away: 0 }, secondHalf: { home: 12, away: 0 } });
    expect(validateRestoreState(state).errors.filter((e) => e.startsWith('score') || e.includes('Half'))).toEqual([]);
  });

  it('uses the score the admin asks for, and keeps the halves only when the events agree with it', async () => {
    const winners: Array<'CT' | 'T'> = [...Array<'CT'>(7).fill('CT'), ...Array<'T'>(5).fill('T'), 'CT'];
    const agree = setup({ homeSide: 'T', score: { ct: 6, t: 7 }, winners });
    const differ = setup({ homeSide: 'T', score: { ct: 6, t: 7 }, winners });

    const same = await agree.service.draft(GAME, { scoreHome: 7, scoreAway: 6 });
    const other = await differ.service.draft(GAME, { scoreHome: 8, scoreAway: 5 });

    expect(same.sources.score).toBe('asked');
    expect(same.state.firstHalf).toEqual({ home: 7, away: 5 });
    expect(other.state).toMatchObject({ home: { score: 8 }, away: { score: 5 } });
    expect(other.state.firstHalf).toBeUndefined();
    expect(other.missing).toContain('halves');
  });

  it('falls back on the current score when the round asked for is the one being played and the events are incomplete', async () => {
    const { service } = setup({ score: { ct: 3, t: 1 }, winners: ['CT', 'CT'] });

    const { state, sources } = await service.draft(GAME, { round: 5 });

    expect(state).toMatchObject({ home: { score: 3 }, away: { score: 1 } });
    expect(sources.score).toBe('current score');
  });

  it('reads the current score for the side home plays now (home is T: it owns the T score)', async () => {
    const { service } = setup({ homeSide: 'T', score: { ct: 3, t: 1 }, withEvents: false });

    const { state } = await service.draft(GAME, { round: 5 });

    expect(state).toMatchObject({ homeSide: 'T', home: { score: 1 }, away: { score: 3 } });
  });

  it('says the score is missing when the round is not the current one and the events are incomplete', async () => {
    const { service } = setup({ score: { ct: 9, t: 8 }, winners: ['CT'] });

    const { missing } = await service.draft(GAME, { round: 5 });

    expect(missing).toContain('score');
  });

  it('wants the halves from the admin when 12 rounds are played and nothing says who won them', async () => {
    const { service } = setup({ score: { ct: 7, t: 5 }, withEvents: false });

    const { state, missing } = await service.draft(GAME, { round: 13 });

    expect(missing).toContain('halves');
    expect(state.firstHalf).toBeUndefined();
  });

  it('does not read the events of a match that is not a game of the tournament', async () => {
    const { service, gameRounds, prisma } = setup({ score: { ct: 1, t: 0 } });

    const draft = await service.draft('m-sandbox-1', { round: 2 });

    expect(gameRounds.forGame).not.toHaveBeenCalled();
    expect(prisma.matchMap.findUnique).not.toHaveBeenCalled();
    expect(draft.state.map).toBeUndefined();
    expect(draft.missing).toContain('map');
  });
});

describe('RestoreDraftService : loss streaks and money', () => {
  it('takes them from the photo of the start of the round', async () => {
    const { service } = setup({
      score: { ct: 2, t: 2 },
      winners: ['CT', 'T', 'T', 'CT'],
      teamAt: { 4: { home_loss_streak: 0, away_loss_streak: 2 } },
      moneyAt: { 4: { [HOME_1]: { money: 3900, equip: 1000 }, [AWAY_1]: { money: 5400, equip: 0 } } },
    });

    const { state, sources } = await service.draft(GAME, { round: 5 });

    expect(state.home.lossStreak).toBe(0);
    expect(state.away.lossStreak).toBe(2);
    expect(state.players.find((p) => p.steamId === HOME_1)?.money).toBe(3900);
    expect(state.players.find((p) => p.steamId === AWAY_1)?.money).toBe(5400);
    expect(sources.lossStreak).toBe('photographed at the start of that round');
    expect(sources.money).toBe('photographed at the start of that round');
  });

  it('gives the start money to a player the photo does not know (he joined later)', async () => {
    const { service } = setup({ score: { ct: 2, t: 2 }, winners: ['CT', 'T', 'T', 'CT'], moneyAt: { 4: { [HOME_1]: { money: 3900, equip: 0 } } } });

    const { state } = await service.draft(GAME, { round: 5 });

    expect(state.players.find((p) => p.steamId === AWAY_1)?.money).toBe(800);
  });

  it('uses the current values when the round is the one being played and nothing was photographed', async () => {
    const { service } = setup({
      score: { ct: 2, t: 2 },
      winners: ['CT', 'T', 'T', 'CT'],
      streaksNow: { home_loss_streak: 1, away_loss_streak: 0 },
      moneyNow: { [HOME_1]: { money: 4100, equip: 0 } },
    });

    const { state, sources } = await service.draft(GAME, { round: 5 });

    expect(state.home.lossStreak).toBe(1);
    expect(state.players.find((p) => p.steamId === HOME_1)?.money).toBe(4100);
    expect(sources.lossStreak).toBe('current');
    expect(sources.money).toBe('current');
  });

  it('says what it does not know about an earlier round nobody photographed', async () => {
    const { service } = setup({ score: { ct: 9, t: 8 }, winners: ['CT', 'T', 'T', 'CT'] });

    const { state, missing } = await service.draft(GAME, { round: 5 });

    expect(missing).toEqual(expect.arrayContaining(['lossStreak', 'money']));
    expect(state.players.every((p) => p.money === 0)).toBe(true);
  });
});

describe('RestoreDraftService : the players and the inventory', () => {
  it('gives each side its knife and pistol, following the side of each team in that round', async () => {
    const { service } = setup({ homeSide: 'T', score: { ct: 0, t: 0 } });

    const { state } = await service.draft(GAME, { round: 1 });

    expect(state.homeSide).toBe('T');
    expect(state.players.find((p) => p.team === 'home')?.items).toEqual(['weapon_knife_t', 'weapon_glock']);
    expect(state.players.find((p) => p.team === 'away')?.items).toEqual(['weapon_knife', 'weapon_usp_silencer']);
  });

  it('says there are no players when the match knows none, and no inventory to check then', async () => {
    const { service } = setup({ roster: { home: [], away: [] } });

    const { state, missing } = await service.draft(GAME, { round: 1 });

    expect(state.players).toEqual([]);
    expect(missing).toContain('players');
    expect(missing).not.toContain('inventory');
  });

  it('says the map is missing when the game has none', async () => {
    const { service } = setup({ mapName: null });

    const { state, missing } = await service.draft(GAME, { round: 1 });

    expect(state.map).toBeUndefined();
    expect(missing).toContain('map');
  });

  it('names the two teams, "Home" and "Away" when the match does not know them', async () => {
    const { service, state } = setup();
    state.getScoreWithTeams.mockResolvedValue({ teams: {} });

    expect((await service.draft(GAME, { round: 1 })).teams).toEqual({ home: 'Home', away: 'Away' });
  });
});
