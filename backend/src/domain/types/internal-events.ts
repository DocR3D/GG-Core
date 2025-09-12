// events/internal-event.ts
export type Audience = 'admin' | 'public' | 'both';

export type InternalEventName =
  | 'KILL'
  | 'ROUND_START'
  | 'ROUND_END'
  | 'SCORE_UPDATE'
  | 'PAUSE_UPDATE'
  | 'SIDES_SWAPPED'
  | 'CHAT_PUBLIC'
  | 'CHAT_ADMIN'
  | 'MATCH_STATE'
  | 'COMMAND'
  // NEW (aligne tes WS/agent/debug)
  | 'AGENT_ACTION'
  | 'AGENT_RESULT'
  | 'LOG_RAW'
  | 'TEAM_ROUND_WIN';

export interface InternalEvent {
  v?: 1;
  id?: string;

  name: InternalEventName;

  // On laisse audience optionnel: on le default à l’ingestion
  audience?: Audience;

  // Pivots
  serverId: string;
  matchId: string;

  // Contexte jeu (facultatifs)
  map?: string | null;
  round?: number | null;
  tick?: number | null;

  // Horodatage/ordre
  ts?: number;   // epoch ms (default: Date.now())
  seq?: number;  // attribué par le broadcaster

  // Métadonnées (optionnelles)
  source?: 'logs' | 'api' | 'system';
  kind?: 'primary' | 'telemetry';

  payload?: unknown;
}

// Builder contextuel (inchangé, mais audience/ts deviennent optionnels ici aussi)
export function withCtxInternal(ctx: {
  serverId: string; matchId: string;
  map?: string|null; round?: number|null; tick?: number|null;
}) {
  const base = {
    serverId: ctx.serverId,
    matchId : ctx.matchId,
    map     : ctx.map ?? null,
    round   : ctx.round ?? null,
    tick    : ctx.tick ?? null,
  };
  return function build(
    name: InternalEventName,
    payload: unknown,
    opts?: {
      audience?: Audience;
      ts?: number;
      id?: string;
      source?: 'logs'|'api'|'system';
      kind?: 'primary'|'telemetry';
    }
  ): InternalEvent {
    return {
      v: 1,
      id: opts?.id ?? (globalThis.crypto?.randomUUID?.() ?? undefined),
      ts: opts?.ts ?? Date.now(),
      name,
      audience: opts?.audience ?? 'both',
      ...base,
      source: opts?.source,
      kind: opts?.kind,
      payload,
    };
  };
}
