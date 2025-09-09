export type EventSource = 'logs' | 'cstv' | 'manual';
export type EventKind = 'primary' | 'telemetry';

export interface BaseEvent<TType extends string, TPayload = unknown> {
  v: 1;
  id: string;
  timestamp: number;
  source: EventSource;
  kind: EventKind;

  serverId: string;
  matchId: string;
  map?: string;
  round?: number;
  tick?: number;

  type: TType;
  payload: TPayload;
}
