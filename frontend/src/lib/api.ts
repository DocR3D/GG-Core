// Calls to the backend: same origin (the front is served by NestJS), so the session cookie goes along by itself.

export class ApiError extends Error {
  constructor(
    /** HTTP status, 0 when the server could not be reached */
    readonly status: number,
    message: string,
    readonly method = 'GET',
    readonly path = '',
    /** what was sent (JSON body), for the diagnosis */
    readonly sent?: string,
  ) {
    super(message);
  }
}

/** Every API error is announced (popup of components/errors, browser console) - asked to diagnose refusals. */
export const API_ERROR_EVENT = 'gg:api-error';

function report(error: ApiError, response?: unknown) {
  console.error(`[API] ${error.status || 'réseau'} ${error.method} ${error.path} : ${error.message}`, { sent: error.sent, response });
  window.dispatchEvent(new CustomEvent<ApiError>(API_ERROR_EVENT, { detail: error }));
}

/**
 * Calls the API. A refusal throws an ApiError carrying the API's reason, and is reported (popup + console) unless
 * `quiet` (a call whose failure is expected, e.g. polling while the server restarts).
 */
export async function api<T>(path: string, init?: RequestInit & { quiet?: boolean }): Promise<T> {
  const { quiet, ...request } = init ?? {};
  const method = (request.method ?? 'GET').toUpperCase();
  const sent = typeof request.body === 'string' ? request.body : undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      ...request,
      headers: { Accept: 'application/json', ...(request.body ? { 'Content-Type': 'application/json' } : {}), ...request.headers },
    });
  } catch (e) {
    const error = new ApiError(0, `serveur injoignable (${e instanceof Error ? e.message : String(e)})`, method, path, sent);
    if (!quiet) report(error);
    throw error;
  }
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const reason =
      typeof body === 'object' && body?.message ? (Array.isArray(body.message) ? body.message.join(' ; ') : String(body.message)) : `HTTP ${res.status}`;
    const error = new ApiError(res.status, reason, method, path, sent);
    if (!quiet) report(error, body);
    throw error;
  }
  return body as T;
}

/** The logged-in user (GET /auth/me): a visitor when nobody is logged in. */
export type Session = { role: 'visitor' } | { role: 'admin' | 'player'; sub: string; name: string; via: 'steam' | 'password' | 'token' };

/** A game being played (GET /api/tournament/live). */
export interface LiveGame {
  gameId: string;
  order: number;
  mapName: string;
  startedAt: string | null;
  server: string;
  tournament: { id: string; name: string };
  match: { id: string; format: string; scoreHome: number; scoreAway: number };
  home: string | null;
  away: string | null;
  phase: string | null;
  sides: { home: 'CT' | 'T'; away: 'CT' | 'T' } | null;
  score: { home: number; away: number; round: number };
  pause: { state: string; reason: string | null; team: string | null; startedAt: number | null } | null;
  review: { reason: string } | null;
}

/** A Sandbox simulation (GET /sandbox/tournament/runs): a tournament being played with fake results. */
export interface SimulationRun {
  id: string;
  tournamentId: string;
  status: 'running' | 'paused' | 'done' | 'stopped' | 'error';
  phase: string;
  seriesPlayed: number;
  gamesPlayed: number;
  error?: string;
}

/** A game server with what its agent reports (GET /api/tournament/servers). */
export interface ServerRow {
  id: string;
  name: string;
  ip: string;
  port: number;
  tvPort: number;
  game: string;
  availability: 'free' | 'busy' | 'disabled';
  busyWith: { matchId: string; phase: string } | null;
  agent: { online: boolean; rconConnected?: boolean; rconError?: string; lastLogAt?: string | null; lastBadTokenAt?: string };
}

/** A team of a tournament with its roster (GET /api/tournament/tournaments/:id/teams). */
export interface TournamentTeam {
  id: string;
  name: string;
  tag: string | null;
  players: { id: string; username: string; steamId: string | null; captain: boolean; role: string }[];
}

/** Overview of a tournament (GET /api/tournament/tournaments/:id/overview), the parts the admin screen uses. */
export interface OverviewMatch {
  id: string;
  label?: string;
  home: string | null;
  away: string | null;
  homeId?: string | null;
  awayId?: string | null;
  /** where a team still unknown comes from, e.g. "Vainq. H T1#3" */
  homeFrom?: string | null;
  awayFrom?: string | null;
  round?: number;
  format: 'BO1' | 'BO3' | 'BO5';
  status: 'PENDING' | 'LIVE' | 'FINISHED' | string;
  scoreHome: number;
  scoreAway: number;
  winner: string | null;
  isForfeit: boolean;
  bracket?: string;
  /** maps the home team starts with (grand final: the upper-bracket finalist is one map up) */
  advantageHome?: number;
  placement?: number | null;
  games: { id?: string; order: number; mapName: string; status: string; scoreHome: number; scoreAway: number; server: string | null }[];
}
export interface StandingRow {
  rank: number;
  team: string;
  teamId?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  /** rounds won / lost (tiebreakers) */
  scoreFor?: number;
  scoreAgainst?: number;
  scoreDiff: number;
  /** tie the admin must settle (manual order) */
  tied: boolean;
}
export interface OverviewStage {
  id: string;
  name: string;
  type: 'ROUND_ROBIN' | 'DOUBLE_ELIM' | string;
  order: number;
  groups: { id?: string; name: string; standings: StandingRow[]; matches: OverviewMatch[] }[];
  matches: OverviewMatch[];
  participants?: { id: string; name: string; seed: number }[];
  ranking?: { place: string; team: string }[];
}
export interface Overview {
  name: string;
  game: string;
  stages: OverviewStage[];
  bonusMatches: OverviewMatch[];
}

/** Veto of a match in the admin overview (GET /api/tournament/tournaments/:id/vetos). */
export interface VetoItem {
  matchId: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
  phase: 'unavailable' | 'rps' | 'rps_decision' | 'veto' | 'done';
  reason?: string;
  waitingFor: string[];
  lastActionAt: string | null;
}

export interface VetoConfig {
  mapPool: string[];
  sideMode: 'knife' | 'pick';
}

export interface TournamentSummary {
  id: string;
  name: string;
  game: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
}
