import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_PUB } from '@adapters/redis/redis.tokens';
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
export class Cs2LogsService {
  private readonly logger = new Logger(Cs2LogsService.name);
  constructor(@Inject(REDIS_PUB) private readonly pub: Redis) {}

  // --------- Ingest public API ---------
// === 2) handleLogLine: minimal, un seul passage par tryParseEvent ===
async handleLogLine(serverId: string, rawLine: string): Promise<void>;
async handleLogLine(ctx: LogCtx, rawLine: string): Promise<void>;
async handleLogLine(a: string | LogCtx, rawLine: string): Promise<void> {
  const ctx: LogCtx = typeof a === 'string'
    ? { serverId: a, matchId: null, map: null, round: null, tick: null }
    : a;

  const line = stripCs2Prefix(rawLine);
  this.logger.debug(`[CS2-LOGS] shortened line = ${line}`);

  const ev = this.tryParseEvent(line, {
    serverId: ctx.serverId,
    matchId : ctx.matchId ?? 'unknown',
    map     : ctx.map ?? null,
    round   : ctx.round ?? null,
    tick    : ctx.tick ?? null,
  });

  this.logger.debug(`[CS2-LOGS] parsed event = ${ev ? ev.type : 'none'}`);

  if (ev) {
    // Publie le BaseEvent (MatchEvent) comme le reste du pipeline
    await this.publish('ggbot:events', ev);
  }
}



// --- SURCHARGES ---
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


  // --------- Internals ---------
  private async publish(channel: string, payload: unknown) {
    return this.pub.publish(channel, JSON.stringify(payload));
  }

  private tryParseEvent(
    line: string,
    ctx: { serverId: string; matchId: string; map?: string|null; round?: number|null; tick?: number|null }
  ): MatchEvent | null {
    // Builders BaseEvent (comme avant)
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

      // Chaque règle retourne un MatchEvent (grâce à la signature Rule.build)
      const ev = r.build(m, build, buildTel, extra);
      if (ev) return ev; // (si tu as gardé un COMMAND_RE, ev n'est jamais null ici)
    }
    return null;
  }
}
