// Calls to the backend: same origin (the front is served by NestJS), so the session cookie goes along by itself.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof body === 'object' && body?.message ? String(body.message) : `HTTP ${res.status}`);
  return body as T;
}

/** The logged-in user (GET /auth/me): a visitor when nobody is logged in. */
export type Session =
  | { role: 'visitor' }
  | { role: 'admin' | 'player'; sub: string; name: string; via: 'steam' | 'password' | 'token' };

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

export interface TournamentSummary {
  id: string;
  name: string;
  game: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
}
