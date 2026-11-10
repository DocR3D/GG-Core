/**
 * RestoreBackupService : the CS2 backup file of a state asked for. The file is built by the real backup writer and read
 * back by the real backup reader, so the tests check what a server would read, not what the service meant to write.
 */
import { RestoreBackupService, RestoreStateError } from './restore-backup.service';
import { RoundBackupService } from '@app/match/backup/round-backup.service';
import type { RestorePlayerState, RestoreState } from '@domain/restore/restore-state';

const reader = new RoundBackupService();

function setup(opts: { homeName?: string | null; known?: string[] } = {}) {
  const state = {
    getScoreWithTeams: jest.fn().mockResolvedValue({
      teams: {
        home: opts.homeName === null ? undefined : { id: 'h', name: opts.homeName ?? 'Démo Rouge' },
        away: { id: 'a', name: 'Démo Bleue' },
      },
    }),
    getPlayers: jest.fn().mockResolvedValue({
      home: (opts.known ?? ['76561198000000001', '76561198000000002']).map((steamId) => ({ steamId, logical: 'home' })),
      away: [],
    }),
  };
  return { service: new RestoreBackupService(state as never, new RoundBackupService()), state };
}

const player = (over: Partial<RestorePlayerState> = {}): RestorePlayerState => ({
  steamId: '76561198000000001',
  name: 'Garitos',
  team: 'home',
  money: 3500,
  armor: 100,
  helmet: true,
  defuseKit: false,
  items: ['weapon_knife_t', 'weapon_glock', 'weapon_flashbang'],
  ...over,
});

/** Round 6, 5 rounds played, 3 - 2, home on T, away on a loss streak of 2. */
const early = (over: Partial<RestoreState> = {}): RestoreState => ({
  round: 6,
  homeSide: 'T',
  home: { score: 3, lossStreak: 0 },
  away: { score: 2, lossStreak: 2 },
  // only the counter-terrorists carry a kit: away is CT when home is T
  players: [
    player(),
    player({ steamId: '76561198000000002', name: 'Lana', team: 'away', defuseKit: (over.homeSide ?? 'T') === 'T', items: ['weapon_knife', 'weapon_usp_silencer', 'weapon_ak47'] }),
  ],
  map: 'de_mirage',
  ...over,
});

const NOW = new Date(Date.UTC(2026, 10, 12, 20, 30, 5));

describe('RestoreBackupService : the file', () => {
  it('writes a backup a reader finds as asked: the round, the map, the teams, the score and the loss streaks', async () => {
    const { service } = setup();

    const file = await service.build('m-1', early(), NOW);
    const parsed = reader.parseValveBackup(file.content);

    expect(parsed.round).toBe(5); // rounds already played: the file's "round" is not the round to replay
    expect(parsed.map).toBe('de_mirage');
    expect(parsed.team1).toBe('Démo Bleue'); // team1 is the CT team of the first half; home is T and away is CT here
    expect(parsed.team2).toBe('Démo Rouge');
    expect(parsed.firstHalfScore).toEqual({ team1: 2, team2: 3 });
    expect(parsed.history).toEqual({ consecutiveCTLoses: 2, consecutiveTLoses: 0, loserMostRecentTeam: 'CT' });
  });

  it('puts every player on his team with his money, armour, helmet, kit and items', async () => {
    const { service } = setup();

    const { content } = await service.build('m-1', early(), NOW);
    const parsed = reader.parseValveBackup(content);

    const lana = parsed.playersTeam1[0]; // away = team1
    const garitos = parsed.playersTeam2[0];
    expect(lana).toMatchObject({ steamId: '39734274', name: 'Lana', cash: 3500, armor: 100, helmet: 1, defusekit: 1 });
    expect(lana.items).toEqual(['weapon_knife', 'weapon_usp_silencer', 'weapon_ak47']);
    expect(garitos).toMatchObject({ steamId: '39734273', name: 'Garitos', cash: 3500, helmet: 1 });
    expect(garitos.items).toEqual(['weapon_knife_t', 'weapon_glock', 'weapon_flashbang']);
  });

  it('writes the items the way a real CS2 backup does, one "item" line each', async () => {
    const { service } = setup();

    const { content } = await service.build('m-1', early(), NOW);

    expect(content).toContain('"Items"');
    expect(content).toContain('"item"\t\t"weapon_ak47"');
    expect(content).toContain('"NumConsecutiveCTLoses"\t\t"2"');
    expect(content).toContain('"NumConsecutiveTerroristLoses"\t\t"0"');
    expect(content.startsWith('"SaveFile"')).toBe(true);
  });

  it('names the file after the rounds played and the time, and gives the command that loads it', async () => {
    const { service } = setup();

    const file = await service.build('m-1', early(), NOW);

    expect(file.fileName).toBe('ggcore_round05_20261112-203005.txt');
    expect(file.rconCommand).toBe('mp_backup_restore_load_file ggcore_round05_20261112-203005.txt');
    expect(file.round).toBe(6);
    expect(file.warnings).toEqual([]);
  });

  it('leaves out the items of a player who carries none', async () => {
    const { service } = setup();

    const { content } = await service.build('m-1', early({ players: [player({ items: [] })] }), NOW);

    expect(content).not.toContain('"Items"');
  });

  it('calls a team "Home" or "Away" when the match does not know its name', async () => {
    const { service } = setup({ homeName: null });

    const parsed = reader.parseValveBackup((await service.build('m-1', early({ homeSide: 'CT' }), NOW)).content);

    expect(parsed.team1).toBe('Home');
    expect(parsed.team2).toBe('Démo Bleue');
  });
});

describe('RestoreBackupService : which team is team1, and the halves', () => {
  it('keeps team1 as the CT team of the first half: the home team when it plays CT in rounds 1 to 12', async () => {
    const { service } = setup();

    const parsed = reader.parseValveBackup((await service.build('m-1', early({ homeSide: 'CT' }), NOW)).content);

    expect(parsed.team1).toBe('Démo Rouge');
    expect(parsed.firstHalfScore).toEqual({ team1: 3, team2: 2 });
  });

  it('swaps team1 and team2 in the second half: the CT team of round 13 is team2', async () => {
    const { service } = setup();
    const secondHalf = early({ round: 14, homeSide: 'CT', home: { score: 7, lossStreak: 0 }, away: { score: 6, lossStreak: 1 }, firstHalf: { home: 7, away: 5 } });

    const parsed = reader.parseValveBackup((await service.build('m-1', secondHalf, NOW)).content);

    expect(parsed.round).toBe(13);
    expect(parsed.team1).toBe('Démo Bleue');
    expect(parsed.team2).toBe('Démo Rouge');
    expect(parsed.firstHalfScore).toEqual({ team1: 5, team2: 7 });
    expect(parsed.secondHalfScore).toEqual({ team1: 1, team2: 0 }); // what is left of each total after the first half
  });

  it('writes the overtime score and which overtime it is, as a real file does (13 - 16 in the 5th overtime)', async () => {
    const { service } = setup();
    // 53 rounds played: 12 + 12 in regulation (7-5, 5-7), then 29 rounds of overtime won 13 (team1) and 16 (team2)
    const overtime = early({
      round: 54,
      homeSide: 'T',
      home: { score: 7 + 7 + 16, lossStreak: 0 },
      away: { score: 5 + 5 + 13, lossStreak: 2 },
      firstHalf: { home: 7, away: 5 },
      secondHalf: { home: 7, away: 5 },
    });
    // 7+7+16 = 30 and 5+5+13 = 23: 53 rounds in all

    const parsed = reader.parseValveBackup((await service.build('m-1', overtime, NOW)).content);

    expect(parsed.round).toBe(53);
    expect(parsed.overtimeScore?.overtimeId).toBe(5);
    expect((parsed.overtimeScore?.team1 ?? 0) + (parsed.overtimeScore?.team2 ?? 0)).toBe(29);
  });
});

describe('RestoreBackupService : what it refuses', () => {
  it('gives every problem at once, with the warnings, and builds nothing', async () => {
    const { service } = setup();
    const bad = early({ home: { score: 9, lossStreak: 0 }, players: [player({ money: 99999, items: ['weapon_laser'] }), player({ steamId: '76561198000000009', name: 'Unknown', team: 'away' })] });

    const error = await service.build('m-1', bad, NOW).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RestoreStateError);
    const { errors, warnings } = error as RestoreStateError;
    expect(errors.join(' | ')).toContain('score: round 6 comes after 5 rounds');
    expect(errors.join(' | ')).toContain('money');
    expect(errors.join(' | ')).toContain('"weapon_laser" is not a weapon or equipment of CS2');
    expect(warnings.join(' | ')).toContain('SteamID not among the players known for this match');
  });

  it('wants the map', async () => {
    const { service } = setup();

    await expect(service.build('m-1', early({ map: undefined }), NOW)).rejects.toMatchObject({ errors: ['map: the map of the game, e.g. "de_mirage"'] });
  });

  it('passes the warnings on when the file is made', async () => {
    const { service } = setup({ known: ['76561198000000001'] });

    const file = await service.build('m-1', early(), NOW);

    expect(file.warnings).toEqual(['players[1] (Lana): SteamID not among the players known for this match']);
  });
});

describe('RestoreBackupService : the loser of the last round', () => {
  it.each([
    [{ ct: 3, t: 0 }, 'CT'],
    [{ ct: 0, t: 2 }, 'T'],
    [{ ct: 1, t: 4 }, 'T'],
    [{ ct: 4, t: 1 }, 'CT'],
    [{ ct: 2, t: 2 }, 'CT'],
    [{ ct: 0, t: 0 }, 'T'],
  ])('with loss streaks %j, the side that lost last is taken to be %s', (streaks, loser) => {
    const { service } = setup();
    // home is CT here
    const options = service.toBackupOptions(
      early({ homeSide: 'CT', home: { score: 3, lossStreak: streaks.ct }, away: { score: 2, lossStreak: streaks.t } }),
      'Rouge',
      'Bleue',
    );

    expect(options.history).toEqual({ consecutiveCTLoses: streaks.ct, consecutiveTLoses: streaks.t, loserMostRecentTeam: loser });
  });
});
