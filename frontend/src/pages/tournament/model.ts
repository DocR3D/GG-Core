// Small shared rules of the tournament screens (one place instead of a copy per component).
import type { OverviewMatch, OverviewStage } from '../../lib/api';

/** Where a match's veto stands, as shown on its line (vetoLine), with its colour class. */
export type VetoLine = { text: string; tone: string } | null;

/**
 * Address of a tournament screen. Always absolute: React Router 7 resolves a relative path inside a splat route
 * ("matchs/*") from the full address, which stacked addresses ("Phase introuvable", seen by the user).
 */
export const tournamentPath = (tournamentId: string, sub = '') => `/admin/tournaments/${tournamentId}${sub ? `/${sub}` : ''}`;

/** A match with nothing left to play: finished, or cancelled (groups closed early). */
export const isSettled = (m: Pick<OverviewMatch, 'status'>) => m.status === 'FINISHED' || m.status === 'CANCELLED';

/** Every match of a stage (bracket matches, or the matches of its groups). */
export const stageMatches = (s: OverviewStage) => [...s.matches, ...s.groups.flatMap((g) => g.matches)];

/** Matches of a stage still to play. */
export const matchesLeft = (s: OverviewStage) => stageMatches(s).filter((m) => !isSettled(m)).length;

/** Groups generated / bracket generated. */
export const isGenerated = (s: OverviewStage) => (s.type === 'ROUND_ROBIN' ? s.groups.length > 0 : s.matches.length > 0);

/** [from, from + 1, ..., to] (empty when to < from). */
export const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Group sizes after the snake spread (the same sizes the backend makes). */
export const groupSizes = (teams: number, groups: number) =>
  Array.from({ length: groups }, (_, i) => Math.floor(teams / groups) + (i < teams % groups ? 1 : 0));
