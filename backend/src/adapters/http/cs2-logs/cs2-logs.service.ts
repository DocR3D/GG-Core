import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_PUB } from '@adapters/redis/redis.tokens';
import type { MatchEvent } from '@domain/types/match.event';
import { EventTypes } from '@domain/types/event.types';
import { withCtx } from '@domain/types/factory';

import { RULES, stripCs2Prefix } from './rules';

const CHAT_RE =
  /^L\s+\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2}:\d{2}:\s+"(?<name>[^"<]+)<(?<userid>\d+)><(?<steam>[^>]+)><(?<team>[^>]+)>"\s+(?<channel>say|say_team)\s+"(?<msg>.*)"\s*$/i;

const CMD_PREFIXES = ['!', '/'];
const ALLOWED_COMMANDS = new Set(['pause','unpause','tech','tac','start','knife','stop','ready','unready','timeout','restart']);

// types utilitaires
type LogCtx = {
  serverId: string;
  matchId?: string | null;
  map?: string | null;
  round?: number | null;
  tick?: number | null;
};

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
async handleLogLine(serverId: string, rawLine: string): Promise<void>;
async handleLogLine(ctx: LogCtx, rawLine: string): Promise<void>;
async handleLogLine(a: string | LogCtx, rawLine: string): Promise<void> {    
  const ctx: LogCtx = typeof a === 'string'
    ? { serverId: a, matchId: null, map: null, round: null, tick: null }
    : a;

  const line = stripCs2Prefix(rawLine);

  // Chat / Command
  const chat = this.tryParseChat(line, ctx.serverId, ctx.matchId ?? 'unknown');
  if (chat) {
    const cmd = this.tryParseCommand(chat);
    if (cmd) { await this.publish('ggbot:commands', cmd); return; }
    await this.publish('ggbot:chat', chat);
    return;
  }

  // Événements via RULES (en un seul endroit)
  const ev = this.tryParseEvent(line, {
    serverId: ctx.serverId,
    matchId: ctx.matchId ?? 'unknown',
    map: ctx.map ?? null,
    round: ctx.round ?? null,
    tick: ctx.tick ?? null,
  });
  if (ev) {
    await this.publish('ggbot:events', ev);
    return;
  }

  // Fallback (optionnel) : publier la ligne brute
  // await this.publish('ggbot:events', {
  //   v: 1, id: crypto.randomUUID(), timestamp: Date.now(),
  //   type: EventTypes.LOG, kind: 'telemetry', source: 'logs',
  //   serverId: ctx.serverId, matchId: ctx.matchId ?? 'unknown',
  //   payload: { line }
  // });
}



// --- SURCHARGES ---
async handleJson(serverId: string, seg: string): Promise<void>;
async handleJson(ctx: LogCtx, seg: string): Promise<void>;
async handleJson(a: string | LogCtx, seg: string): Promise<void> {
  const ctx: LogCtx = typeof a === 'string' ? { serverId: a, matchId: null } : a;

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
    const build    = withCtx({ matchId: ctx.matchId, serverId: ctx.serverId, source: 'logs', kind: 'primary' });
    const buildTel = withCtx({ matchId: ctx.matchId, serverId: ctx.serverId, source: 'logs', kind: 'telemetry' });
    const extra = { map: ctx.map ?? undefined, round: ctx.round ?? undefined, tick: ctx.tick ?? undefined };

    for (const r of RULES) {
        const m = line.match(r.re);
        if (!m) continue;
        return r.build(m, build, buildTel, extra);
    }
    return null;
    }


  private tryParseChat(line: string, serverId: string, matchId: string,) {
    const m = CHAT_RE.exec(line);
    if (!m?.groups) return null;
    const ts = Date.now();
    return {
      type: EventTypes.CHAT_MESSAGE,
      timestamp: ts,
      source: 'logs',
      serverId,
      matchId,
      map: null,
      round: null,
      tick: null,
      payload: {
        channel: m.groups.channel === 'say_team' ? 'say_team' : 'say',
        message: (m.groups.msg ?? '').trim(),
        player: {
          name: m.groups.name,
          userId: Number.isFinite(+m.groups.userid) ? +m.groups.userid : null,
          steamId: m.groups.steam || null,
          team: normTeam(m.groups.team),
        },
      },
    };
  }

  private tryParseCommand(chat: any) {
    let msg = (chat.payload.message || '').trim();
    if (!msg) return null;
    if (!CMD_PREFIXES.includes(msg[0])) return null;

    msg = msg.slice(1).trim();
    const parts = msg.split(/\s+/);
    if (!parts.length) return null;

    let name = parts[0].toLowerCase();
    if (name === 'tactical' || name === 'timeout') name = 'tac';
    if (name === 'p') name = 'pause';
    if (name === 'technical') name = 'tech';
    if (!ALLOWED_COMMANDS.has(name)) return null;

    const parameters = parts.slice(1);
    return {
      type: EventTypes.COMMAND,
      timestamp: chat.timestamp,
      source: chat.source,
      serverId: chat.serverId,
      matchId: chat.matchId,
      map: chat.map ?? null,
      round: chat.round ?? null,
      tick: chat.tick ?? null,
      payload: {
        command: name,
        parameters,
        sender: {
          name: chat.payload.player.name,
          steamId: chat.payload.player.steamId,
          team: chat.payload.player.team,
          channel: chat.payload.channel,
        },
      },
    };
  }
}
