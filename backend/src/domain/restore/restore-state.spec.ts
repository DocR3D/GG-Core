import { readFileSync } from 'fs';
import { join } from 'path';
import {
  accountIdOf,
  CARRIABLE_ITEMS,
  isCarriableItem,
  isKnife,
  validateRestoreState,
  type RestorePlayerState,
  type RestoreState,
} from './restore-state';

const player = (over: Partial<RestorePlayerState> = {}): RestorePlayerState => ({
  steamId: '76561198000000001',
  name: 'Garitos',
  team: 'home',
  money: 3500,
  armor: 100,
  helmet: true,
  defuseKit: false,
  items: ['weapon_knife', 'weapon_glock'],
  ...over,
});

/** Round 6: 5 rounds played, home on T. */
const state = (over: Partial<RestoreState> = {}): RestoreState => ({
  round: 6,
  homeSide: 'T',
  home: { score: 3, lossStreak: 0 },
  away: { score: 2, lossStreak: 2 },
  players: [player(), player({ steamId: '76561198000000002', name: 'Lana', team: 'away', defuseKit: true })],
  map: 'de_mirage',
  ...over,
});

const errorsOf = (s: RestoreState, known?: string[]) => validateRestoreState(s, { knownSteamIds: known }).errors;
const warningsOf = (s: RestoreState, known?: string[]) => validateRestoreState(s, { knownSteamIds: known }).warnings;

describe('accountIdOf', () => {
  it('gives the same number for the two spellings of one player', () => {
    expect(accountIdOf('76561198000000001')).toBe(39734273);
    expect(accountIdOf('[U:1:39734273]')).toBe(39734273);
    expect(accountIdOf(' [U:1:39734273] ')).toBe(39734273);
  });

  it.each(['', 'STEAM_0:1:123', '12345', '7656119800000000', '[U:2:5]', 'abc', null, undefined])('does not read %j as a SteamID', (value) => {
    expect(accountIdOf(value as never)).toBeNull();
  });
});

describe('the items a player can carry', () => {
  it('knows the weapons, the equipment and the knives of CS2', () => {
    for (const name of ['weapon_ak47', 'weapon_awp', 'weapon_glock', 'weapon_flashbang', 'weapon_c4', 'weapon_taser', 'weapon_knife', 'weapon_knife_t', 'weapon_knife_ursus', 'weapon_knife_m9_bayonet', 'weapon_bayonet']) {
      expect(isCarriableItem(name)).toBe(true);
    }
  });

  it('knows every name found in the real backups of a CS2 server (the fixtures)', () => {
    const fixtures = ['sample_round_backup_anonymized.txt', 'gglan19_match156_ot5_round53_anonymized.txt'];
    const names = new Set<string>();
    for (const file of fixtures) {
      const text = readFileSync(join(__dirname, '../../../../test/fixtures/backups', file), 'utf8');
      for (const m of text.matchAll(/"item"\s+"([a-z_0-9]+)"/g)) names.add(m[1]);
    }

    expect(names.size).toBeGreaterThan(10);
    for (const name of names) expect({ name, known: isCarriableItem(name) }).toEqual({ name, known: true });
  });

  it.each(['weapon_ak48', 'ak47', 'WEAPON_AK47', 'weapon_', 'item_kevlar', 'weapon_knife_', '', 'weapon_knife; quit', 'weapon_knife_ct', 'weapon_knifegg', 'weapon_m4a4', 'weapon_sg553'])('refuses "%s"', (name) => {
    expect(isCarriableItem(name)).toBe(false);
  });

  it('has no name twice', () => {
    expect(new Set(CARRIABLE_ITEMS).size).toBe(CARRIABLE_ITEMS.length);
  });

  it('tells a knife from the rest', () => {
    expect(isKnife('weapon_knife')).toBe(true);
    expect(isKnife('weapon_knife_widowmaker')).toBe(true);
    expect(isKnife('weapon_bayonet')).toBe(true);
    expect(isKnife('weapon_ak47')).toBe(false);
  });
});

describe('validateRestoreState : a good state', () => {
  it('has nothing to say', () => {
    expect(validateRestoreState(state())).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a SteamID in either spelling, and the knives of the family', () => {
    const s = state({ players: [player({ steamId: '[U:1:39734273]', items: ['weapon_knife_ursus', 'weapon_ak47', 'weapon_flashbang', 'weapon_flashbang', 'weapon_smokegrenade'] })] });
    expect(errorsOf(s)).toEqual([]);
  });
});

describe('validateRestoreState : the round and the score', () => {
  it.each([0, -1, 201, 1.5, '6', null])('refuses the round %j', (round) => {
    expect(errorsOf(state({ round: round as never })).join(' ')).toContain('round:');
  });

  it('wants the two scores to add up to the rounds already played', () => {
    const errors = errorsOf(state({ home: { score: 5, lossStreak: 0 } }));

    expect(errors).toEqual(['score: round 6 comes after 5 rounds, but the two scores add up to 7']);
  });

  it('accepts the first round at 0 - 0', () => {
    expect(errorsOf(state({ round: 1, home: { score: 0, lossStreak: 0 }, away: { score: 0, lossStreak: 0 } }))).toEqual([]);
  });

  it.each([
    ['a negative score', { home: { score: -1, lossStreak: 0 } }, 'home.score'],
    ['a score that is not whole', { away: { score: 1.5, lossStreak: 0 } }, 'away.score'],
    ['a loss streak that is too long', { home: { score: 3, lossStreak: 31 } }, 'home.lossStreak'],
    ['a negative loss streak', { away: { score: 2, lossStreak: -1 } }, 'away.lossStreak'],
  ])('refuses %s', (_label, over, field) => {
    expect(errorsOf(state(over as Partial<RestoreState>)).join(' ')).toContain(field);
  });

  it('refuses a side that is not CT or T, and a map that is not a map name', () => {
    expect(errorsOf(state({ homeSide: 'X' as never }))).toContain('homeSide: "CT" or "T"');
    expect(errorsOf(state({ map: 'de mirage; quit' })).join(' ')).toContain('map:');
  });
});

describe('validateRestoreState : the halves', () => {
  const afterHalftime = (over: Partial<RestoreState> = {}): RestoreState =>
    state({ round: 13, home: { score: 7, lossStreak: 0 }, away: { score: 5, lossStreak: 1 }, firstHalf: { home: 7, away: 5 }, ...over });

  it('wants the first half once 12 rounds are played, and checks it adds up to 12', () => {
    expect(errorsOf(afterHalftime({ firstHalf: undefined })).join(' ')).toContain('firstHalf: the rounds won by each team in rounds 1 to 12');
    expect(errorsOf(afterHalftime({ firstHalf: { home: 7, away: 4 } }))).toContain('firstHalf: two whole numbers that add up to 12');
    expect(errorsOf(afterHalftime())).toEqual([]);
  });

  it('does not want a half before it is over', () => {
    expect(errorsOf(state({ firstHalf: { home: 3, away: 2 } })).join(' ')).toContain('firstHalf: only after 12 rounds');
  });

  it('wants the second half too once 24 rounds are played', () => {
    const overtime = state({ round: 25, home: { score: 12, lossStreak: 0 }, away: { score: 12, lossStreak: 1 }, firstHalf: { home: 7, away: 5 } });

    expect(errorsOf(overtime).join(' ')).toContain('secondHalf: the rounds won by each team in rounds 13 to 24');
    expect(errorsOf({ ...overtime, secondHalf: { home: 5, away: 7 } })).toEqual([]);
  });

  it('refuses a half the team could not have won, given its total', () => {
    const errors = errorsOf(afterHalftime({ home: { score: 5, lossStreak: 0 }, away: { score: 7, lossStreak: 0 } }));

    expect(errors.join(' ')).toContain('home.score: lower than what the home team won in the halves (7)');
  });

  it('does not want a second half in the middle of the second half', () => {
    expect(errorsOf(afterHalftime({ secondHalf: { home: 6, away: 6 } })).join(' ')).toContain('secondHalf: only after 24 rounds');
  });
});

describe('validateRestoreState : the players', () => {
  it('wants at least one player, and at most five a team', () => {
    expect(errorsOf(state({ players: [] }))).toContain('players: at least one player');
    const six = Array.from({ length: 6 }, (_, i) => player({ steamId: `7656119800000000${i + 1}`, name: `P${i}` }));
    expect(errorsOf(state({ players: six }))).toContain('players: at most 5 players for the home team');
  });

  it('refuses a SteamID that is none, and one that is listed twice in either spelling', () => {
    expect(errorsOf(state({ players: [player({ steamId: 'abc' })] })).join(' ')).toContain('steamId: a SteamID64 or a [U:1:n]');
    const twice = state({ players: [player(), player({ steamId: '[U:1:39734273]', team: 'away' })] });
    expect(errorsOf(twice).join(' ')).toContain('this player is already listed');
  });

  it('flags a player nobody knows without refusing him (a corrected SteamID, a substitute)', () => {
    const warnings = warningsOf(state(), ['76561198000000001']);

    expect(warnings).toEqual(['players[1] (Lana): SteamID not among the players known for this match']);
    expect(errorsOf(state(), ['76561198000000001'])).toEqual([]);
  });

  it('does not flag anybody when nobody is known yet', () => {
    expect(warningsOf(state(), [])).toEqual([]);
  });

  it('knows a player by his account whatever the spelling', () => {
    expect(warningsOf(state(), ['[U:1:39734273]', '[U:1:39734274]'])).toEqual([]);
  });

  it.each([
    ['money above the maximum', { money: 16001 }, 'money'],
    ['negative money', { money: -1 }, 'money'],
    ['armour above 100', { armor: 101 }, 'armor'],
    ['a helmet that is not true or false', { helmet: 1 as never }, 'helmet'],
    ['no team', { team: undefined as never }, 'team'],
  ])('refuses %s', (_label, over, field) => {
    expect(errorsOf(state({ players: [player(over)] })).join(' ')).toContain(field);
  });

  it('warns about a helmet without armour', () => {
    expect(warningsOf(state({ players: [player({ armor: 0, helmet: true })] }))).toEqual(['players[0] (Garitos): a helmet without any armour']);
  });
});

describe('validateRestoreState : what a player carries', () => {
  const carrying = (items: string[], over: Partial<RestorePlayerState> = {}) => errorsOf(state({ players: [player({ items, ...over })] })).join(' | ');

  it('refuses an item that is not in CS2, and says which', () => {
    expect(carrying(['weapon_laser'])).toContain('"weapon_laser" is not a weapon or equipment of CS2');
  });

  it('keeps the slots of CS2: one primary, one pistol, one knife, one taser', () => {
    expect(carrying(['weapon_ak47', 'weapon_awp'])).toContain('only one primary weapon');
    expect(carrying(['weapon_glock', 'weapon_deagle'])).toContain('only one pistol');
    expect(carrying(['weapon_knife', 'weapon_knife_ursus'])).toContain('only one knife');
    expect(carrying(['weapon_taser', 'weapon_taser'])).toContain('only one taser');
  });

  it('keeps the grenades of CS2: two flashbangs, one of each other, four in all', () => {
    expect(carrying(['weapon_flashbang', 'weapon_flashbang', 'weapon_flashbang'])).toContain('at most two flashbangs');
    expect(carrying(['weapon_smokegrenade', 'weapon_smokegrenade'])).toContain('only one weapon_smokegrenade');
    expect(carrying(['weapon_flashbang', 'weapon_flashbang', 'weapon_hegrenade', 'weapon_smokegrenade', 'weapon_decoy'])).toContain('at most four grenades');
    expect(carrying(['weapon_flashbang', 'weapon_flashbang', 'weapon_hegrenade', 'weapon_smokegrenade'])).toBe('');
  });

  it('lets only the terrorists carry the bomb, one of them, and only the counter-terrorists a defusal kit', () => {
    expect(carrying(['weapon_c4'], { team: 'away' })).toContain('only the terrorists carry the bomb'); // away is CT when home is T
    expect(carrying(['weapon_c4'])).toBe('');
    expect(carrying([], { defuseKit: true })).toContain('only the counter-terrorists carry a defusal kit'); // home is T
    expect(carrying([], { team: 'away', defuseKit: true })).toBe('');
    const two = state({ players: [player({ items: ['weapon_c4'] }), player({ steamId: '76561198000000003', items: ['weapon_c4'] })] });
    expect(errorsOf(two).join(' ')).toContain('only one player of the home team can carry the bomb');
  });

  it('warns, without refusing, about the grenade of the other side', () => {
    const t = warningsOf(state({ players: [player({ items: ['weapon_incgrenade'] })] }));
    const ct = warningsOf(state({ players: [player({ team: 'away', items: ['weapon_molotov'] })] }));

    expect(t.join(' ')).toContain('an incendiary grenade is a counter-terrorist grenade');
    expect(ct.join(' ')).toContain('a molotov is a terrorist grenade');
  });

  it('refuses a list that is not a list', () => {
    expect(carrying(undefined as never)).toContain('items: a list of CS2 class names');
  });
});

describe('validateRestoreState : every problem at once', () => {
  it('gives them all, so that the admin fixes them in one go', () => {
    const errors = errorsOf(state({ round: 6, home: { score: 9, lossStreak: 0 }, homeSide: 'X' as never, players: [player({ money: 99999, items: ['weapon_laser'] })] }));

    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});
