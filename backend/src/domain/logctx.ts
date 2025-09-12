export type LogCtx = {
  serverId: string;           // non-nullable
  matchId: string | null;
  map: string | null;
  round: number | null;
  tick: number | null;
  source?: 'logs' | 'cstv' | 'demo';
  recvAt?: number;
  lineTs?: number | null;
  serverBound?: boolean;
};

export function makeCtx(p: {
  serverId: string | null | undefined;
  matchId?: string | null;
  map?: string | null;
  round?: number | null;
  tick?: number | null;
  source?: LogCtx['source'];
}): LogCtx {
  return {
    serverId: p.serverId ?? 'unknown',
    matchId: p.matchId ?? null,
    map: p.map ?? null,
    round: p.round ?? null,
    tick: p.tick ?? null,
    source: p.source ?? 'logs',
    recvAt: Date.now(),
    lineTs: null,
    serverBound: false,
  };
}

export function makeCtxFromServerId(serverId: string): LogCtx {
  return makeCtx({ serverId, source: 'logs' });
}
