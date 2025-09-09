// events/factory.ts
import { EventTypes } from './event.types';
import type { BaseEvent, EventKind, EventSource } from './base.event';
import type {
  Team, TeamRoundWinEvent, TeamRoundWinReason,
} from './match.event';

type EventType = typeof EventTypes[keyof typeof EventTypes];

/** Helper générique, robuste */
export function makeEvent<TType extends EventType, TPayload>(
  type: TType,
  base: Omit<BaseEvent<TType, TPayload>, 'v' | 'id' | 'timestamp' | 'type' | 'payload'> & {
    payload: TPayload;
  }
): BaseEvent<TType, TPayload> {
  return {
    v: 1,
    id: (global as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    type,
    ...base, // kind/source/serverId/matchId/... + payload
  };
}

export function withCtx(ctx: {
  matchId: string; serverId: string; source: EventSource; kind?: EventKind;
}) {
  const kind = ctx.kind ?? 'primary';
  return function <TType extends EventType, TPayload>(
    type: TType, payload: TPayload, extra?: Partial<Pick<BaseEvent<TType, TPayload>, 'map'|'round'|'tick'>>
  ) {
    return makeEvent(type, { ...ctx, kind, ...(extra ?? {}), payload });
  };
}

/** Exemple spécialisé : TeamRoundWin */
export function makeTeamRoundWin(args: {
  matchId: string;
  serverId: string;
  source: EventSource;
  kind?: EventKind; // par défaut 'primary'
  payload: { winner: Team; reason?: TeamRoundWinReason };
}): TeamRoundWinEvent {
  const { kind = 'primary', ...rest } = args;
  return makeEvent(EventTypes.TEAM_ROUND_WIN, { kind, ...rest });
}
