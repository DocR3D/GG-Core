// src/domain/side.types.ts

export const CS2_SIDE_TERRORIST = 'TERRORIST' as const;
export const CS2_SIDE_T = 'T' as const;
export const CS2_SIDE_CT = 'CT' as const;
export const CS2_SIDE_SPECTATOR = 'SPECTATOR' as const;
export const CS2_SIDE_UNASSIGNED = 'Unassigned' as const;

export type CanonicalSide = typeof CS2_SIDE_CT | typeof CS2_SIDE_T;
export type GameSide = CanonicalSide | typeof CS2_SIDE_TERRORIST;
export type NonPlayingSide = typeof CS2_SIDE_SPECTATOR | typeof CS2_SIDE_UNASSIGNED;
export type PlayerTeam = GameSide | NonPlayingSide;

/**
 * Normalise les variantes CS2 ('TERRORIST' -> 'T') vers le format canonique court.
 */
export function normalizeSide(side: GameSide): CanonicalSide {
  return side === CS2_SIDE_TERRORIST ? CS2_SIDE_T : side;
}

/**
 * Vérifie si le side correspond à une entité non-joueuse (spectateur ou non-assigné).
 */
export function isNonPlayingSide(side?: string | null): boolean {
  if (!side) return true;
  const s = side.toLowerCase();
  return s === 'spectator' || s === 'unassigned';
}
