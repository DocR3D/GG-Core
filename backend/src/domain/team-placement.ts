// src/domain/team-placement.ts
// Are the two teams on the sides chosen in the veto? Pure decision, taken when both teams are ready, before the live.
// Zero plugin: CS2 cannot force a player into a side, GG-Core can only check, swap both teams (mp_swapteams) or wait.

import { CanonicalSide, CS2_SIDE_CT, CS2_SIDE_T } from './side.types';

export type Logical = 'home' | 'away';

export interface PlacementInput {
  /** Side each team must start on (veto) */
  expected: Record<Logical, CanonicalSide>;
  /** SteamIDs of each roster (CS2 log format) */
  lineups: Record<Logical, string[]>;
  /** Where each player stands now (from the "switched from team" log lines): CT, TERRORIST, Spectator… */
  sides: Record<string, string | undefined>;
}

export interface MisplacedPlayer {
  steamId: string;
  team: Logical;
  on: CanonicalSide;
  expected: CanonicalSide;
}

export type PlacementVerdict =
  | { kind: 'ok' }
  /** every placed player is on the other side: both teams swapped (mp_swapteams) */
  | { kind: 'swap' }
  /** some players on the wrong side: wait until they move */
  | { kind: 'wrong'; misplaced: MisplacedPlayer[] }
  /** nothing to check against: no SteamID in a roster, or a team has nobody on a side */
  | { kind: 'unknown'; reason: string };

const playingSide = (side: string | undefined): CanonicalSide | null =>
  side === CS2_SIDE_CT ? CS2_SIDE_CT : side === 'TERRORIST' || side === CS2_SIDE_T ? CS2_SIDE_T : null;

export function decidePlacement(input: PlacementInput): PlacementVerdict {
  if (!input.lineups.home.length || !input.lineups.away.length) return { kind: 'unknown', reason: 'a roster has no SteamID' };

  const placed = (['home', 'away'] as Logical[]).flatMap((team) =>
    input.lineups[team]
      .map((steamId) => ({ steamId, team, on: playingSide(input.sides[steamId]) }))
      .filter((p): p is { steamId: string; team: Logical; on: CanonicalSide } => !!p.on),
  );
  if (!placed.some((p) => p.team === 'home') || !placed.some((p) => p.team === 'away')) {
    return { kind: 'unknown', reason: 'a team has no player on a side' };
  }

  const misplaced = placed.filter((p) => p.on !== input.expected[p.team]).map((p) => ({ ...p, expected: input.expected[p.team] }));
  if (!misplaced.length) return { kind: 'ok' };
  if (misplaced.length === placed.length) return { kind: 'swap' };
  return { kind: 'wrong', misplaced };
}
