/**
 * The state an admin asks a round to be put back to: the round, the score and the loss streak of each team, and for each
 * player the money, the armour and what he carries. It is what a CS2 round backup file holds, written in GG-Core's own
 * words (home / away, not "team1" / "team2"). The backend refuses any value outside it, in every mode (the check is in
 * the service, not in the global validation pipe). Its description for the OpenAPI contract is in adapters/http/matches/dto/restore-state.dto.ts.
 *
 * Item names: the weapon class names of CS2. Every name below is an entity name of Valve's own item data (items_game.txt of
 * SteamTracking/GameTracking-CS2, read in full on 2026-11-12: 66 `weapon_*` names, all of them here but the gun game knife),
 * and the names found in real backups written by a CS2 server (test/fixtures/backups) are all in the list.
 */

export const TEAM_SIDES = ['CT', 'T'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

export const PISTOLS = ['weapon_glock', 'weapon_hkp2000', 'weapon_usp_silencer', 'weapon_p250', 'weapon_elite', 'weapon_fiveseven', 'weapon_tec9', 'weapon_cz75a', 'weapon_deagle', 'weapon_revolver'] as const;
export const SMGS = ['weapon_mac10', 'weapon_mp9', 'weapon_mp7', 'weapon_mp5sd', 'weapon_ump45', 'weapon_p90', 'weapon_bizon'] as const;
export const RIFLES = ['weapon_galilar', 'weapon_famas', 'weapon_ak47', 'weapon_m4a1', 'weapon_m4a1_silencer', 'weapon_aug', 'weapon_sg556'] as const;
export const SNIPERS = ['weapon_ssg08', 'weapon_awp', 'weapon_g3sg1', 'weapon_scar20'] as const;
export const SHOTGUNS = ['weapon_nova', 'weapon_xm1014', 'weapon_mag7', 'weapon_sawedoff'] as const;
export const MACHINE_GUNS = ['weapon_m249', 'weapon_negev'] as const;
export const GRENADES = ['weapon_flashbang', 'weapon_hegrenade', 'weapon_smokegrenade', 'weapon_molotov', 'weapon_incgrenade', 'weapon_decoy'] as const;
export const EQUIPMENT = ['weapon_taser', 'weapon_c4', 'weapon_healthshot'] as const;
/** The knives: the default ones and the skinned ones a player may carry (a knife is one slot, whatever its skin). */
export const KNIVES = [
  'weapon_knife', 'weapon_knife_t', 'weapon_bayonet', 'weapon_knife_butterfly', 'weapon_knife_canis', 'weapon_knife_cord',
  'weapon_knife_css', 'weapon_knife_falchion', 'weapon_knife_flip', 'weapon_knife_gut', 'weapon_knife_gypsy_jackknife',
  'weapon_knife_karambit', 'weapon_knife_kukri', 'weapon_knife_m9_bayonet', 'weapon_knife_outdoor', 'weapon_knife_push',
  'weapon_knife_skeleton', 'weapon_knife_stiletto', 'weapon_knife_survival_bowie', 'weapon_knife_tactical', 'weapon_knife_ursus',
  'weapon_knife_widowmaker',
] as const;

export const PRIMARY_WEAPONS = [...SMGS, ...RIFLES, ...SNIPERS, ...SHOTGUNS, ...MACHINE_GUNS] as const;

/** Every item name a player can carry. */
export const CARRIABLE_ITEMS = [...PISTOLS, ...PRIMARY_WEAPONS, ...GRENADES, ...EQUIPMENT, ...KNIVES] as const;
export type CarriableItem = (typeof CARRIABLE_ITEMS)[number];

const ALL = new Set<string>(CARRIABLE_ITEMS);
const isOneOf = (list: readonly string[], name: string) => list.includes(name);

export const isKnife = (name: string) => isOneOf(KNIVES, name);
export const isCarriableItem = (name: string) => ALL.has(name);

export const MAX_MONEY = 16000;
export const MAX_PLAYERS_PER_TEAM = 5;
export const MAX_LOSS_STREAK = 30;

export interface RestoreTeamState {
  /** Rounds the team has won so far (before the round that is replayed) */
  score: number;
  /** Rounds lost in a row, the number CS2 keeps for the loss bonus */
  lossStreak: number;
}

export interface RestorePlayerState {
  /** SteamID64 (`76561198000000001`) or `[U:1:n]` */
  steamId: string;
  /** Name shown, when known */
  name?: string;
  team: 'home' | 'away';
  /** Money at the start of the round, in dollars */
  money: number;
  /** Armour points, 0 to 100 */
  armor: number;
  helmet: boolean;
  /** Defusal kit (counter-terrorists only) */
  defuseKit: boolean;
  /** What the player carries, as CS2 class names */
  items: string[];
}

/** Rounds won by each team in one half of the match. */
export interface RestoreHalfScore {
  home: number;
  away: number;
}

export interface RestoreState {
  /** The round to replay (1 = the first round). Rounds played so far = round - 1 = the two scores added */
  round: number;
  /** The side the home team plays during that round */
  homeSide: TeamSide;
  home: RestoreTeamState;
  away: RestoreTeamState;
  players: RestorePlayerState[];
  /** The map, e.g. `de_mirage` */
  map?: string;
  /** Rounds 1 to 12 won by each team: needed once 12 rounds are played (CS2 keeps the score of each half) */
  firstHalf?: RestoreHalfScore;
  /** Rounds 13 to 24 won by each team: needed once 24 rounds are played */
  secondHalf?: RestoreHalfScore;
}

export interface RestoreIssues {
  errors: string[];
  warnings: string[];
}

const STEAM64_BASE = 76561197960265728n;

/** The account number of a SteamID64 or of a `[U:1:n]`, so that both spellings of one player are the same player. */
export function accountIdOf(steamId: string): number | null {
  const clean = String(steamId ?? '').trim();
  const u = /^\[U:1:(\d{1,10})\]$/.exec(clean);
  if (u) return Number(u[1]);
  if (/^7656119\d{10}$/.test(clean)) return Number(BigInt(clean) - STEAM64_BASE);
  return null;
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Everything wrong or doubtful in a state, so the admin sees it all at once. `errors` stop the file from being made,
 * `warnings` do not. `knownSteamIds`: the players GG-Core already knows for this match; a player outside it is accepted
 * (an admin may correct a SteamID, or bring in a substitute) but flagged.
 */
export function validateRestoreState(state: RestoreState, opts: { knownSteamIds?: Iterable<string> } = {}): RestoreIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isInt(state.round, 1, 200)) errors.push('round: a whole number from 1 to 200');
  if (!TEAM_SIDES.includes(state.homeSide)) errors.push('homeSide: "CT" or "T"');
  for (const key of ['home', 'away'] as const) {
    const team = state[key];
    if (!isInt(team?.score, 0, 200)) errors.push(`${key}.score: a whole number from 0 to 200`);
    if (!isInt(team?.lossStreak, 0, MAX_LOSS_STREAK)) errors.push(`${key}.lossStreak: a whole number from 0 to ${MAX_LOSS_STREAK}`);
  }
  if (isInt(state.round, 1, 200) && isInt(state.home?.score, 0, 200) && isInt(state.away?.score, 0, 200)) {
    const played = state.home.score + state.away.score;
    if (played !== state.round - 1) {
      errors.push(`score: round ${state.round} comes after ${state.round - 1} rounds, but the two scores add up to ${played}`);
    }
  }
  if (state.map !== undefined && !/^[a-z0-9_]{3,40}$/.test(state.map)) errors.push('map: a CS2 map name such as "de_mirage"');
  if (isInt(state.round, 1, 200) && isInt(state.home?.score, 0, 200) && isInt(state.away?.score, 0, 200)) {
    checkHalves(state, errors);
  }

  const players = Array.isArray(state.players) ? state.players : [];
  if (!Array.isArray(state.players) || players.length === 0) errors.push('players: at least one player');

  const known = new Set<number>();
  for (const id of opts.knownSteamIds ?? []) {
    const account = accountIdOf(id);
    if (account !== null) known.add(account);
  }
  const seen = new Set<number>();
  const perTeam = { home: 0, away: 0 };
  const c4: Array<'home' | 'away'> = [];

  players.forEach((p, i) => {
    const who = `players[${i}]${p?.name ? ` (${p.name})` : ''}`;
    const account = accountIdOf(p?.steamId);
    if (account === null) errors.push(`${who}.steamId: a SteamID64 or a [U:1:n]`);
    else if (seen.has(account)) errors.push(`${who}.steamId: this player is already listed`);
    else {
      seen.add(account);
      if (known.size > 0 && !known.has(account)) warnings.push(`${who}: SteamID not among the players known for this match`);
    }
    if (p?.team !== 'home' && p?.team !== 'away') {
      errors.push(`${who}.team: "home" or "away"`);
      return;
    }
    perTeam[p.team] += 1;
    const side: TeamSide = (p.team === 'home') === (state.homeSide === 'CT') ? 'CT' : 'T';

    if (!isInt(p.money, 0, MAX_MONEY)) errors.push(`${who}.money: a whole number from 0 to ${MAX_MONEY}`);
    if (!isInt(p.armor, 0, 100)) errors.push(`${who}.armor: a whole number from 0 to 100`);
    if (typeof p.helmet !== 'boolean') errors.push(`${who}.helmet: true or false`);
    else if (p.helmet && p.armor === 0) warnings.push(`${who}: a helmet without any armour`);
    if (typeof p.defuseKit !== 'boolean') errors.push(`${who}.defuseKit: true or false`);
    else if (p.defuseKit && side !== 'CT') errors.push(`${who}.defuseKit: only the counter-terrorists carry a defusal kit`);

    if (!Array.isArray(p.items)) {
      errors.push(`${who}.items: a list of CS2 class names`);
      return;
    }
    const names: string[] = [];
    for (const item of p.items) {
      if (typeof item !== 'string' || !isCarriableItem(item)) errors.push(`${who}.items: "${String(item)}" is not a weapon or equipment of CS2`);
      else names.push(item);
    }
    const count = (name: string) => names.filter((n) => n === name).length;
    if (names.filter((n) => isOneOf(PRIMARY_WEAPONS, n)).length > 1) errors.push(`${who}.items: only one primary weapon`);
    if (names.filter((n) => isOneOf(PISTOLS, n)).length > 1) errors.push(`${who}.items: only one pistol`);
    if (names.filter(isKnife).length > 1) errors.push(`${who}.items: only one knife`);
    if (count('weapon_taser') > 1) errors.push(`${who}.items: only one taser`);
    if (count('weapon_flashbang') > 2) errors.push(`${who}.items: at most two flashbangs`);
    for (const g of ['weapon_hegrenade', 'weapon_smokegrenade', 'weapon_molotov', 'weapon_incgrenade', 'weapon_decoy']) {
      if (count(g) > 1) errors.push(`${who}.items: only one ${g}`);
    }
    if (names.filter((n) => isOneOf(GRENADES, n)).length > 4) errors.push(`${who}.items: at most four grenades`);
    if (count('weapon_c4') > 0) {
      if (side !== 'T') errors.push(`${who}.items: only the terrorists carry the bomb`);
      c4.push(p.team);
    }
    if (count('weapon_c4') > 1) errors.push(`${who}.items: only one bomb`);
    if (side === 'T' && count('weapon_incgrenade') > 0) warnings.push(`${who}: an incendiary grenade is a counter-terrorist grenade (terrorists carry a molotov)`);
    if (side === 'CT' && count('weapon_molotov') > 0) warnings.push(`${who}: a molotov is a terrorist grenade (counter-terrorists carry an incendiary)`);
  });

  for (const team of ['home', 'away'] as const) {
    if (perTeam[team] > MAX_PLAYERS_PER_TEAM) errors.push(`players: at most ${MAX_PLAYERS_PER_TEAM} players for the ${team} team`);
  }
  for (const team of ['home', 'away'] as const) {
    if (c4.filter((t) => t === team).length > 1) errors.push(`players: only one player of the ${team} team can carry the bomb`);
  }
  return { errors, warnings };
}

/** CS2 keeps the score of each half in its backup: after 12 rounds the first half is needed, after 24 the second too. */
function checkHalves(state: RestoreState, errors: string[]): void {
  const played = state.round - 1;
  const half = (name: 'firstHalf' | 'secondHalf', h: RestoreHalfScore | undefined): h is RestoreHalfScore => {
    if (!h) {
      errors.push(`${name}: the rounds won by each team in ${name === 'firstHalf' ? 'rounds 1 to 12' : 'rounds 13 to 24'}, needed after ${name === 'firstHalf' ? 12 : 24} rounds`);
      return false;
    }
    if (!isInt(h.home, 0, 12) || !isInt(h.away, 0, 12) || h.home + h.away !== 12) {
      errors.push(`${name}: two whole numbers that add up to 12`);
      return false;
    }
    return true;
  };
  if (played < 12) {
    if (state.firstHalf) errors.push('firstHalf: only after 12 rounds, before that the scores are the first half');
    if (state.secondHalf) errors.push('secondHalf: only after 24 rounds');
    return;
  }
  const first = half('firstHalf', state.firstHalf);
  if (played < 24) {
    if (state.secondHalf) errors.push('secondHalf: only after 24 rounds');
  }
  const second = played >= 24 ? half('secondHalf', state.secondHalf) : true;
  if (!first || !second) return;
  for (const team of ['home', 'away'] as const) {
    const regulation = (state.firstHalf as RestoreHalfScore)[team] + (played >= 24 ? (state.secondHalf as RestoreHalfScore)[team] : 0);
    if (regulation > state[team].score) errors.push(`${team}.score: lower than what the ${team} team won in the halves (${regulation})`);
  }
}
