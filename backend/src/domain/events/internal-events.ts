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
  // Agent / debug
  | 'AGENT_ACTION'
  | 'AGENT_RESULT'
  | 'LOG_RAW'
  // Parser Go — événements “primaires”
  | 'TEAM_ROUND_WIN'
  | 'BOMB_PLANTED'
  | 'BEGIN_BOMB_PLANT'
  | 'DEFUSE_BEGIN'
  | 'DEFUSE_ABORT'
  | 'MATCH_PAUSED'
  | 'MATCH_UNPAUSED'
  | 'PLAYER_CONNECTED'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_NAME_CHANGE'
  | 'ITEM_PURCHASE'
  | 'GRENADE_THROW'
  | 'GRENADE_LAND'
  | 'PLAYER_BLINDED'
  | 'PHASE_COUNTDOWN'
  | 'PHASE_CHANGED'
  | 'PHASE_CANCELLED'
  | 'SFUI_TARGET_BOMBED';

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
  source?: 'logs' | 'api' | 'system' | 'agent';
  kind?: 'primary' | 'telemetry';

  payload?: unknown;
}

// Builder contextuel
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
      source?: 'logs'|'api'|'system'|'agent';
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
