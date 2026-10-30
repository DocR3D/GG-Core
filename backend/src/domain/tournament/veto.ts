// src/domain/tournament/veto.ts
// Map veto (pure): sequence of bans / picks per series format, whose turn it is, maps played and their sides.
// "A" = the team that starts the veto (chosen by the rock-paper-scissors winner), "B" = the other one.

export type VetoFormat = 'BO1' | 'BO3' | 'BO5';
export type VetoTeam = 'A' | 'B';
export type Side = 'CT' | 'T';

/**
 * How starting sides are decided, per tournament or stage (decided with the user):
 * - knife: a knife round on every map (GG-Lan habit);
 * - pick: on a picked map the opponent of the picker chooses its side; the decider is still knifed.
 */
export type VetoSideMode = 'knife' | 'pick';

export interface VetoConfig {
  mapPool: string[];
  sideMode: VetoSideMode;
}

export type VetoKind = 'ban' | 'pick' | 'side';

/** A step already played. For a side step, `map` is the map it applies to and `side` the side of `team`. */
export interface VetoDone {
  kind: VetoKind;
  team: VetoTeam;
  map: string;
  side?: Side;
}

export interface VetoMap {
  map: string;
  /** null = decider (the map left at the end) */
  pickedBy: VetoTeam | null;
  /** side mode "pick": who chose the starting side and which side it took; absent = knife round */
  sideChosenBy?: VetoTeam;
  side?: Side;
}

export interface VetoState {
  /** maps neither banned nor picked yet */
  remaining: string[];
  next: { kind: VetoKind; team: VetoTeam; map?: string } | null;
  finished: boolean;
  /** maps to play, in order (picks, then the decider once the veto is finished) */
  maps: VetoMap[];
}

export class VetoError extends Error {}

const GAMES: Record<VetoFormat, number> = { BO1: 1, BO3: 3, BO5: 5 };
const other = (t: VetoTeam): VetoTeam => (t === 'A' ? 'B' : 'A');

/**
 * Bans and picks in order, teams alternating from A. With the 7-map pool:
 * BO1 = 6 bans (decider) · BO3 = ban ban pick pick ban ban (decider) · BO5 = ban ban pick pick pick pick (decider).
 * Other pool sizes: up to 2 bans first, the format's picks, then bans until one map is left.
 */
export function vetoSequence(format: VetoFormat, poolSize: number): ('ban' | 'pick')[] {
  const games = GAMES[format];
  if (!games) throw new VetoError(`unknown format ${format}`);
  if (poolSize < games) throw new VetoError(`a ${format} needs at least ${games} maps in the pool (${poolSize})`);
  if (games === 1) return Array(poolSize - 1).fill('ban');
  const firstBans = Math.min(2, poolSize - games);
  const lastBans = poolSize - games - firstBans;
  return [...Array(firstBans).fill('ban'), ...Array(games - 1).fill('pick'), ...Array(lastBans).fill('ban')];
}

export function validateVetoConfig(config: Partial<VetoConfig> | undefined): VetoConfig {
  const pool = (config?.mapPool ?? []).map((m) => String(m).trim()).filter(Boolean);
  if (!pool.length) throw new VetoError('mapPool is required (e.g. ["de_ancient", "de_dust2", ...])');
  if (new Set(pool).size !== pool.length) throw new VetoError('mapPool has duplicates');
  const sideMode = config?.sideMode ?? 'knife';
  if (sideMode !== 'knife' && sideMode !== 'pick') throw new VetoError('sideMode: knife | pick');
  return { mapPool: pool, sideMode };
}

/** Replays the steps already played; throws if they do not follow the sequence. */
export function vetoState(config: VetoConfig, format: VetoFormat, done: VetoDone[]): VetoState {
  const sequence = vetoSequence(format, config.mapPool.length);
  const remaining = [...config.mapPool];
  const maps: VetoMap[] = [];
  let i = 0; // index in `sequence`
  let pendingSide: VetoMap | null = null; // picked map waiting for its side (side mode "pick")

  const expected = (): VetoState['next'] => {
    if (pendingSide) return { kind: 'side', team: other(pendingSide.pickedBy!), map: pendingSide.map };
    if (i < sequence.length) return { kind: sequence[i], team: i % 2 === 0 ? 'A' : 'B' };
    return null;
  };

  for (const step of done) {
    const next = expected();
    if (!next) throw new VetoError('veto already finished');
    if (step.kind !== next.kind || step.team !== next.team) {
      throw new VetoError(`expected ${next.kind} by team ${next.team}, got ${step.kind} by team ${step.team}`);
    }
    if (step.kind === 'side') {
      if (step.side !== 'CT' && step.side !== 'T') throw new VetoError('side: CT | T');
      pendingSide!.sideChosenBy = step.team;
      pendingSide!.side = step.side;
      pendingSide = null;
      continue;
    }
    const at = remaining.indexOf(step.map);
    if (at < 0) throw new VetoError(`${step.map} is not available`);
    remaining.splice(at, 1);
    if (step.kind === 'pick') {
      const picked: VetoMap = { map: step.map, pickedBy: step.team };
      maps.push(picked);
      if (config.sideMode === 'pick') pendingSide = picked;
    }
    i++;
  }

  const next = expected();
  const finished = !next;
  if (finished) maps.push({ map: remaining[0], pickedBy: null });
  return { remaining: finished ? [] : remaining, next, finished, maps };
}

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export const RPS_CHOICES: RpsChoice[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** Rock-paper-scissors: 'first' / 'second' wins, null = tie (play again). */
export function rpsWinner(first: RpsChoice, second: RpsChoice): 'first' | 'second' | null {
  if (first === second) return null;
  return BEATS[first] === second ? 'first' : 'second';
}
