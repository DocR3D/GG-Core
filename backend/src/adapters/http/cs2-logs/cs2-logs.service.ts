import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_PUB, REDIS_CMD } from '@adapters/redis/redis.tokens';
import type { MatchEvent } from '@domain/types/match.event';
import { EventTypes } from '@domain/types/event.types';
import { InternalEvent } from '@domain/types/internal-events';
import { withCtx } from '@domain/types/factory';
import { withCtxInternal } from '@domain/types/internal-events';

import { RULES, stripCs2Prefix } from './rules';

const CMD_PREFIXES = ['!', '/'];
const ALLOWED_COMMANDS = new Set(['pause','unpause','tech','tac','start','knife','stop','ready','unready','timeout','restart']);

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
    serverId: p.serverId ?? 'unknown',   // => string garanti
    matchId: p.matchId ?? null,
    map: p.map ?? null,
    round: p.round ?? null,
    tick: p.tick ?? null,
    source: p.source ?? 'logs',
    recvAt: Date.now(),
    lineTs: null,
  };
}
export function makeCtxFromServerId(serverId: string): LogCtx {
  return {
    serverId,
    matchId: null,
    map: null,
    round: null,
    tick: null,
    source: 'logs',
    recvAt: Date.now(),
    lineTs: null,
    serverBound: false,
  };
}

function normTeam(team: string): 'CT'|'TERRORIST'|'Spectator'|'Unassigned'|string {
  const t = (team || '').toLowerCase();
  if (t.startsWith('ct')) return 'CT';
  if (t.startsWith('t') || t.startsWith('terror')) return 'TERRORIST';
  if (t.startsWith('spec')) return 'Spectator';
  if (t.startsWith('unass') || t === '' ) return 'Unassigned';
  return team;
}

@Injectable()
export class Cs2LogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Cs2LogsService.name);
  private abort?: AbortController;

  constructor(
    @Inject(REDIS_PUB) private readonly pub: Redis,   // publish vers "ggbot:events" (bus interne)
    @Inject(REDIS_CMD) private readonly redis: Redis, // commandes (XREADGROUP/XACK/…)
  ) {}

  // ---------- Lifecycle ----------
  async onModuleInit() {
    // Liste initiale des serveurs (simple) — peut être remplacée par discovery via heartbeats.
    const serverIds = (process.env.SERVER_IDS ?? 'unknown')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (serverIds.length === 0) {
      this.logger.warn('consumePrimary: no SERVER_IDS configured; consumer not started.');
      return;
    }

    // Crée le groupe consumer si besoin
    await this.ensureGroups(serverIds);

    // Lance la boucle consumer
    this.abort = new AbortController();
    this.consumePrimary(serverIds, this.abort.signal).catch(err =>
      this.logger.error(`consumePrimary crashed: ${err instanceof Error ? err.stack : String(err)}`),
    );
  }

  async onModuleDestroy() {
    this.abort?.abort();
  }

  // ---------- Ingest HTTP (fallback optionnel) ----------
  // === handleLogLine: minimal, fallback derrière USE_HTTP_PARSE ===
  async handleLogLine(serverId: string, rawLine: string): Promise<void>;
  async handleLogLine(ctx: LogCtx, rawLine: string): Promise<void>;
  async handleLogLine(a: string | LogCtx, rawLine: string): Promise<void> {
    const ctx: LogCtx = typeof a === 'string'
      ? { serverId: a, matchId: null, map: null, round: null, tick: null }
      : a;

    const line = stripCs2Prefix(rawLine);
    this.logger.debug(`[CS2-LOGS] shortened line = ${line}`);

    const USE_HTTP_PARSE = process.env.USE_HTTP_PARSE === 'true';
    this.logger.debug(
      `[logs] serverId=${ctx.serverId||'∅'} headerMatchId=${ctx.matchId||'∅'}`
    );
    if (USE_HTTP_PARSE) {
      const ev = this.tryParseEvent(line, {
        serverId: ctx.serverId,
        matchId : ctx.matchId ?? 'unknown',
        map     : ctx.map ?? null,
        round   : ctx.round ?? null,
        tick    : ctx.tick ?? null,
      });
      this.logger.debug(`[CS2-LOGS] parsed event = ${ev ? ev.type : 'none'}`);
      if (ev) {
        await this.publish('ggbot:events', ev);
      }
    }
    // Sinon: no-op — les events arrivent via Redis Streams (consumePrimary)
  }

  // --- SURCHARGES JSON (round_stats) : inchangé ---
  async handleJson(serverId: string, seg: string): Promise<void>;
  async handleJson(ctx: LogCtx, seg: string): Promise<void>;
  async handleJson(a: string | LogCtx, seg: string): Promise<void> {
    const ctx: LogCtx = typeof a === 'string' ? makeCtxFromServerId(a) : a;
    const BEGIN = 'JSON_BEGIN{', END = '}}JSON_END';
    if (!seg || seg.length > 256 * 1024) return;

    const b = seg.indexOf(BEGIN), e = seg.indexOf(END, b >= 0 ? b : 0);
    if (b === -1 || e === -1 || e <= b) return;

    // 1) extrait { … } tel que loggé par CS2
    const contentStart = b + 'JSON_BEGIN'.length; // sur '{'
    const contentEnd   = e + 1;                   // dernier '}'
    let raw = seg.slice(contentStart, contentEnd);

    // 2) normalisation: retire préfixes de timestamp, enlève \n *dans* les chaînes
    const tsPrefix = /(^|\n)(?:L\s+)?\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*[-:]\s*/g;
    raw = raw.replace(/\r/g, '').replace(tsPrefix, '$1').trim();
    raw = removeNewlinesInsideJsonStrings(raw);

    // 3) parse "loose" (ne dépend pas d’un JSON strict)
    const doc = parseRoundStatsLoose(raw);
    if (!doc) return;
    if (doc.name !== 'round_stats') return;

    // 4) fields -> players + conversions
    const fields = (doc.fields ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const players: any[] = [];
    const pObj = doc.players ?? {};
    for (const key of Object.keys(pObj)) {
      const vals = String(pObj[key]).split(',').map(s => s.trim());
      const rec: any = {};
      for (let i = 0; i < fields.length; i++) {
        const k = fields[i], v = vals[i] ?? '';
        const n = Number(v);
        rec[k] = Number.isFinite(n) ? n : v;
      }
      if (rec.team === 2) rec.team = 'T';
      else if (rec.team === 3) rec.team = 'CT';
      players.push(rec);
    }

    const evt = {
      v: 1,
      id: (global as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type: EventTypes.ROUND_STATS,
      kind: 'telemetry' as const,
      source: 'logs' as const,
      serverId: ctx.serverId,
      matchId: ctx.matchId ?? 'unknown',
      map: undefined,
      round: undefined,
      tick: undefined,
      payload: {
        round: Number(doc.round_number),
        score_t: Number(doc.score_t),
        score_ct: Number(doc.score_ct),
        map: doc.map ?? '',
        server: doc.server ?? '',
        players,
      },
    };

    this.logger.log('publishing round_stats');
    await this.publish('ggbot:events', evt);

    // ---------- helpers ----------
    function removeNewlinesInsideJsonStrings(s: string): string {
      let out = '', inStr = false, esc = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!inStr) {
          if (ch === '"') { inStr = true; esc = false; }
          out += ch;
        } else {
          if (esc) { out += ch; esc = false; continue; }
          if (ch === '\\') { out += ch; esc = true; continue; }
          if (ch === '"') { inStr = false; out += ch; continue; }
          if (ch !== '\n' && ch !== '\r') out += ch; // retire \n/\r *dans* les chaînes
        }
      }
      return out;
    }

    function parseRoundStatsLoose(txt: string) {
      txt = txt.trim();
      if (!txt.startsWith('{')) txt = '{' + txt;
      if (!txt.endsWith('}')) txt = txt + '}';

      const need = /"name"\s*:\s*"round_stats"/m;
      if (!need.test(txt)) return null;

      const getStr = (k: string) =>
        txt.match(new RegExp(`"${k}"\\s*:\\s*"([\\s\\S]*?)"`, 'm'))?.[1] ?? null;

      const getNum = (k: string) => {
        const m = txt.match(new RegExp(`"${k}"\\s*:\\s*"(\\d+)"`, 'm'));
        return m ? Number(m[1]) : null;
      };

      // players: accepte contenu non-JSON strict
      const playersBlock = txt.match(/"players"\s*:\s*\{([\s\S]*?)\}/m)?.[1] ?? '';
      const players: Record<string, string> = {};
      let idx = 0;
      for (const m of playersBlock.matchAll(/"player_\d+"\s*:\s*"([^"]*)"/g)) {
        players[`player_${idx++}`] = m[1];
      }

      return {
        name: 'round_stats',
        round_number: getNum('round_number'),
        score_t: getNum('score_t'),
        score_ct: getNum('score_ct'),
        map: getStr('map') ?? '',
        server: getStr('server') ?? '',
        fields: getStr('fields') ?? '',
        players,
      };
    }
  }

  // --------- Internals: publication bus interne ---------
  private async publish(channel: string, payload: unknown) {
    return this.pub.publish(channel, JSON.stringify(payload));
  }

  // --------- Ancien parseur HTTP (fallback) ---------
  private tryParseEvent(
    line: string,
    ctx: { serverId: string; matchId: string; map?: string|null; round?: number|null; tick?: number|null }
  ): MatchEvent | null {
    const build    = withCtx({ matchId: ctx.matchId, serverId: ctx.serverId, source: 'logs', kind: 'primary' });
    const buildTel = withCtx({ matchId: ctx.matchId, serverId: ctx.serverId, source: 'logs', kind: 'telemetry' });
    const extra = {
      map:   ctx.map   ?? undefined,
      round: ctx.round ?? undefined,
      tick:  ctx.tick  ?? undefined,
    };

    for (const r of RULES) {
      const m = line.match(r.re);
      if (!m) continue;
      const ev = r.build(m, build, buildTel, extra);
      if (ev) return ev;
    }
    return null;
  }

  // --------- Nouveau: consommation Redis Streams (events_primary) ---------
  private async ensureGroups(serverIds: string[]) {
    const group = 'backend';
    for (const sid of serverIds) {
      const key = `ggbot:events_primary:${sid}`;
      try {
        await this.redis.xgroup('CREATE', key, group, '$', 'MKSTREAM');
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (!msg.includes('BUSYGROUP')) throw e;
      }
    }
  }

  private async consumePrimary(serverIds: string[], signal: AbortSignal) {
    
    const group = 'backend';
    const consumer = `nest-${process.pid}`;
    const streams = serverIds.map(sid => `ggbot:events_primary:${sid}`);

    this.logger.log(`consumePrimary: listening on ${streams.join(', ')}`);

    while (!signal.aborted) {
      try {
        const res = await this.redis.xreadgroup(
          'GROUP', group, consumer,
          'COUNT', 300, 'BLOCK', 2000,
          'STREAMS', ...streams, ...streams.map(() => '>')
        );

        if (!res) continue;

        const acks: Array<[string, string]> = [];
        for (const streamEntry of (res as any[])) {
          const stream = streamEntry[0] as string;
          const entries = streamEntry[1] as any[];

          for (const entry of entries) {
            const id   = entry[0] as string;
            const arr  = entry[1] as string[]; // ["field","value","field2","value2", ...]

            // ✅ convertir le tableau plat en Map<string,string>
            const fields = new Map<string, string>();
            for (let i = 0; i < arr.length; i += 2) {
              const k = arr[i];
              const v = arr[i + 1];
              fields.set(k, v);
            }

            try {
              const ev = await this.fromStreamFieldsAsync(fields);
              if (ev) await this.publish('ggbot:events', ev);
            } catch (e) {
              this.logger.warn(`consumePrimary error: ${String(e)}`);
            } finally {
              acks.push([stream, id]);
            }
          }
        }
        if (acks.length) {
          const pipe = this.redis.pipeline();
          for (const [stream, id] of acks) pipe.xack(stream, group, id);
          await pipe.exec();
        }
      } catch (e) {
        this.logger.error(`consumePrimary loop failure: ${String(e)}`);
        // petit sleep pour éviter busy-loop en cas d’erreur
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

// Transforme un message Stream (écrit par l’agent Go) en MatchEvent (DTO interne)
private async fromStreamFieldsAsync(fields: Map<string, string>): Promise<MatchEvent | null> {
  const type = fields.get('type');
  const payloadStr = fields.get('payload') ?? '{}';

  const { serverId, matchId } = await this.resolveMatchIdFromFields(fields);
  const build = withCtx({ matchId, serverId, source: 'logs', kind: 'primary' });

  const payload = JSON.parse(payloadStr);
  try{

    switch (type) {
      case EventTypes.CHAT_MESSAGE:          return build(EventTypes.CHAT_MESSAGE, payload);
      case EventTypes.COMMAND:               return build(EventTypes.COMMAND, payload);
      case EventTypes.KILL:                  return build(EventTypes.KILL, payload);
      case EventTypes.ROUND_START:           return build(EventTypes.ROUND_START, payload);
      case EventTypes.TEAM_ROUND_WIN:        return build(EventTypes.TEAM_ROUND_WIN, payload);
      case EventTypes.BOMB_PLANTED:          return build(EventTypes.BOMB_PLANTED, payload);
      case EventTypes.BEGIN_BOMB_PLANT:      return build(EventTypes.BEGIN_BOMB_PLANT, payload);
      case EventTypes.DEFUSE_BEGIN:          return build(EventTypes.DEFUSE_BEGIN, payload);
      case EventTypes.DEFUSE_ABORT:          return build(EventTypes.DEFUSE_ABORT, payload);
      case EventTypes.MATCH_PAUSED:          return build(EventTypes.MATCH_PAUSED, payload);
      case EventTypes.MATCH_UNPAUSED:        return build(EventTypes.MATCH_UNPAUSED, payload);
      case EventTypes.PLAYER_CONNECTED:      return build(EventTypes.PLAYER_CONNECTED, payload);
      case EventTypes.PLAYER_DISCONNECTED:   return build(EventTypes.PLAYER_DISCONNECTED, payload);
      case EventTypes.PLAYER_NAME_CHANGE:    return build(EventTypes.PLAYER_NAME_CHANGE, payload);
      case EventTypes.ROUND_STATS:           return build(EventTypes.ROUND_STATS, payload);
      case EventTypes.GRENADE_THROW:         return build(EventTypes.GRENADE_THROW, payload);
      case EventTypes.GRENADE_LAND:          return build(EventTypes.GRENADE_LAND, payload);
      case EventTypes.PLAYER_BLINDED:        return build(EventTypes.PLAYER_BLINDED, payload);
      case EventTypes.SFUI_TARGET_BOMBED:
        this.logger.debug(`fromStreamFields: got sfui_target_bombed payload=${payloadStr}`);
        return build(EventTypes.SFUI_TARGET_BOMBED, payload);
      case EventTypes.LOG:                   return build(EventTypes.LOG, payload);
      default:
        this.logger.debug(`fromStreamFields: ignore unknown type=${type}`);
        return null;
    }
  } catch (e) {
    this.logger.warn(`fromStreamFields: bad payload JSON: ${(e as Error).message}`);
    return null;
  }
}

  private async resolveMatchIdFromFields(fields: Map<string,string>) {
    const serverId = (fields.get('serverId') || '').trim();
    let matchId    = (fields.get('matchId') || '').trim();

    if (!matchId || matchId === 'unknown') {
      matchId = serverId
        ? (await this.redis.get(`ggbot:server:${serverId}:currentMatch`)) || 'unknown'
        : 'unknown';
    }
    return { serverId, matchId };
  }
}
