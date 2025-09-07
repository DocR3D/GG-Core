import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

import { EventTypes, MatchEvent, type EventType, type KnownEventType, type EventByType, TeamRoundWinReason  } from '../types/match-event';
import { MatchStateService } from '../match-state/match-state/match-state.service';

import { log } from 'console';

const matchStateSync = new MatchStateService();

export type RawLogEvent = {
  type: 'log';
  serverId: string;
  line: string;
  ts: number;          // timestamp de réception côté backend
};

export type ChatEvent = {
  type: 'chat';
  serverId: string;
  ts: number;          // timestamp de réception côté backend
  channel: 'say' | 'say_team';
  player: {
    name: string;
    userId: number | null;
    steamId: string | null;   // peut être STEAM_X:Y:Z ou un autre format
    team: 'CT' | 'TERRORIST' | 'Spectator' | 'Unassigned' | string;
  };
  message: string;
};

export type CommandEvent = {
  type: 'command';
  serverId: string;
  ts: number;
  name: string;
  args: string[];
  from: { name: string; steamId: string | null; team: string; channel: 'say' | 'say_team' };
};

type Handler<T extends KnownEventType> = {           // ⬅️ ici (pas EventType)
  type: T;
  re: RegExp;
  build: (m: RegExpMatchArray) =>
    Pick<EventByType[T], 'type' | 'payload'> &
    Partial<Pick<EventByType[T], 'kind'>>;
};

const defineHandler = <T extends KnownEventType>(h: Handler<T>) => h;  // ⬅️ ici aussi

const toCanonicalTeam = (s: string) => (s === 'TERRORIST' ? 'T' : 'CT');


const winFixed = (re: RegExp, winner: 'T' | 'CT', reason?: TeamRoundWinReason) =>
  defineHandler({
    type: EventTypes.TEAM_ROUND_WIN,
    re,
    build: () => ({
      type: EventTypes.TEAM_ROUND_WIN,
      kind: 'telemetry', // ← marquer SFUI en fallback
      payload: { winner, ...(reason && { reason }) },
    }),
  });

const CS2_PREFIX_RE = /^(?:L\s\d{2}\/\d{2}\/\d{4}\s-\s\d{2}:\d{2}:\d{2}:\s+)/;

export function stripCs2Prefix(line: string): string {
  return line.replace(CS2_PREFIX_RE, '');
}

const toT = (s: string) => (s === 'TERRORIST' ? 'T' : 'CT');
const buildPos = (x: string, y: string, z: string) => ({ x: Number(x), y: Number(y), z: Number(z) });

export const HANDLERS = [
    //Round Win
  winFixed(/SFUI_Notice_Target_Bombed/, 'T', 'bomb_exploded'),
  winFixed(/SFUI_Notice_Terrorists_Win/, 'T', 'elim'),
  winFixed(/SFUI_Notice_Bomb_Defused/, 'CT', 'defused'),        // ← harmonisé
  winFixed(/SFUI_Notice_Target_Saved/, 'CT', 'time'),           // ← “time” cohérent
  winFixed(/SFUI_Notice_CTs_Win/, 'CT', 'elim'),

  defineHandler({
    type: EventTypes.TEAM_ROUND_WIN,
    re: /Team "(TERRORIST|CT)".*?Round_Win.*?reason "([^"]+)"/,
    build: (m) => ({
      type: EventTypes.TEAM_ROUND_WIN,
      kind: 'primary', // ← c’est ta source de vérité
      payload: { winner: toT(m[1]), reason: m[2] as TeamRoundWinReason },
    }),
  }),

  defineHandler({
    type: EventTypes.PLAYER_CONNECTED,
    re: /"(.+)<\d+><(STEAM_[^>]*)><.*>" connected, address "(.*)"/,
    build: (m) => ({ type: EventTypes.PLAYER_CONNECTED, payload: { player: { name: m[1], steamId: m[2], team: 'Unassigned' }} }),
  }),

  // Round start
  defineHandler({ type: EventTypes.ROUND_START,
    re: /World triggered "Round_Start"/,
    build: () => ({ type: EventTypes.ROUND_START, payload: {} })
  }),

// A) KILL joueur → joueur (positions OBLIGATOIRES pour killer & victim)
defineHandler({
  type: EventTypes.KILL,
  // "Killer<id><STEAM|[U:]|BOT><CT|TERRORIST>" [x y z] killed "Victim<id><...><CT|TERRORIST>" [x y z] with "weapon" (headshot)
  re: /^"(?<kName>.+?)<\d+><(?<kSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<kTeam>TERRORIST|CT)>"\s*\[(?<kX>-?\d+)\s+(?<kY>-?\d+)\s+(?<kZ>-?\d+)\]\s+killed\s+"(?<vName>.+?)<\d+><(?<vSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<vTeam>TERRORIST|CT)>"\s*\[(?<vX>-?\d+)\s+(?<vY>-?\d+)\s+(?<vZ>-?\d+)\]\s+with\s+"(?<weapon>[^"]+)"(?<tail>.*)$/,
  build: (m) => {
    const g = (m as any).groups!;
    const headshot = g.tail?.includes('headshot') ?? false;
    const teamkill = g.kTeam === g.vTeam ? true : undefined;

    return {
      type: EventTypes.KILL,
      payload: {
        kind: 'player',
        killer: { name: g.kName, steamId: g.kSteam, team: g.kTeam },
        victim: { name: g.vName, steamId: g.vSteam, team: g.vTeam },
        weapon: g.weapon,
        headshot,
        ...(teamkill && { teamkill }),
        killerPos: { x: Number(g.kX), y: Number(g.kY), z: Number(g.kZ) },
        victimPos: { x: Number(g.vX), y: Number(g.vY), z: Number(g.vZ) },
      },
    };
  },
}),

// B) KILL suicide (position OBLIGATOIRE pour la victime)
defineHandler({
  type: EventTypes.KILL,
  // "Player<id><STEAM|[U:]|BOT><team>" [x y z] committed suicide with "weapon"
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<team>TERRORIST|CT|SPECTATOR|Unassigned)>"\s*\[(?<x>-?\d+)\s+(?<y>-?\d+)\s+(?<z>-?\d+)\]\s+committed\s+suicide\s+with\s+"(?<weapon>[^"]+)"$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.KILL,
      payload: {
        kind: 'suicide',
        player: { name: g.name, steamId: g.steam, team: g.team },
        weapon: g.weapon,
        victimPos: { x: Number(g.x), y: Number(g.y), z: Number(g.z) },
      },
    };
  },
}),

  // Bomb
defineHandler({
  type: EventTypes.BOMB_PLANTED,
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" planted the bomb(?: at (?:[Bb]ombsite )?(?<site>[AB]))?$/,
  build: (m) => {
    const g = (m as any).groups!;
    const site = g.site === 'A' || g.site === 'B' ? (g.site as 'A'|'B') : undefined;
    return {
      type: EventTypes.BOMB_PLANTED,
      payload: {
        planter: { name: g.name, steamId: g.steam, team: g.team },
        ...(site && { site }),
      },
    };
  },
}),
// 1) PLAYER_CONNECTED (adresse optionnelle)
defineHandler({
  type: EventTypes.PLAYER_CONNECTED,
  // "Cap<7><STEAM_1:0:111><Unassigned>" connected, address "192.168.0.10:27005"
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>[^>]+)>" connected(?:, address "(?<address>[^"]+)")?$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.PLAYER_CONNECTED,
      payload: {
        player: {
          name: g.name,
          steamId: g.steam,
          // team peut être "Unassigned"/"SPECTATOR" à la connexion → garde optionnel côté type
          team: g.team,
        },
      },
    };
  },
}),

// 2) PLAYER_DISCONNECTED
defineHandler({
  type: EventTypes.PLAYER_DISCONNECTED,
  // "Cap<7><STEAM_1:0:111><CT>" disconnected (reason "Kicked by Console")
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><[^>]+>" disconnected \(reason "(?<reason>[^"]+)"\)$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.PLAYER_DISCONNECTED,
      payload: {
        player: { name: g.name, steamId: g.steam },
        reason: g.reason,
      },
    };
  },
}),

// 3) NAME_CHANGE
defineHandler({
  type: EventTypes.PLAYER_NAME_CHANGE,
  // "Cap<7><STEAM_1:0:111><CT>" changed name to "Captain"
  re: /^"(?<oldName>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><[^>]+>" changed name to "(?<newName>.+)"$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.PLAYER_NAME_CHANGE,
      payload: {
        steamId: g.steam,
        oldName: g.oldName,
        newName: g.newName,
      },
    };
  },
}),

// 6) DEFUSE_BEGIN (sans kit)
defineHandler({
  type: EventTypes.DEFUSE_BEGIN,
  // "Alex<9><STEAM_1:0:222><CT>" triggered "Begin_Bomb_Defuse_Without_Kit"
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_Without_Kit"$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.DEFUSE_BEGIN,
      payload: {
        player: { name: g.name, steamId: g.steam, team: g.team },
        hasKit: false,
      },
    };
  },
}),

// 7) DEFUSE_BEGIN (avec kit)
defineHandler({
  type: EventTypes.DEFUSE_BEGIN,
  // "Alex<9><STEAM_1:0:222><CT>" triggered "Begin_Bomb_Defuse_With_Kit"
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_With_Kit"$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.DEFUSE_BEGIN,
      payload: {
        player: { name: g.name, steamId: g.steam, team: g.team },
        hasKit: true,
      },
    };
  },
}),

// 8) DEFUSE_ABORT
defineHandler({
  type: EventTypes.DEFUSE_ABORT,
  // "Alex<9><STEAM_1:0:222><CT>" triggered "Abort_Bomb_Defuse"
  re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Abort_Bomb_Defuse"$/,
  build: (m) => {
    const g = (m as any).groups!;
    return {
      type: EventTypes.DEFUSE_ABORT,
      payload: {
        player: { name: g.name, steamId: g.steam, team: g.team },
      },
    };
  },
}),

// 9) PAUSE_STARTED / PAUSE_ENDED (pas de payload)
defineHandler({
  type: EventTypes.MATCH_PAUSED,
  re: /Match Paused/,
  build: () => ({ type: EventTypes.MATCH_PAUSED, payload: {} }),
}),
defineHandler({
  type: EventTypes.MATCH_UNPAUSED,
  re: /Match Unpaused/,
  build: () => ({ type: EventTypes.MATCH_UNPAUSED, payload: {} }),
}),];

const CHAT_RE =
  /^L\s+\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2}:\d{2}:\s+"(?<name>[^"<]+)<(?<userid>\d+)><(?<steam>[^>]+)><(?<team>[^>]+)>"\s+(?<channel>say|say_team)\s+"(?<msg>.*)"\s*$/i;

function normTeam(team: string): 'CT'|'TERRORIST'|'Spectator'|'Unassigned'|string {
  const t = (team || '').toLowerCase();
  if (t.startsWith('ct')) return 'CT';
  if (t.startsWith('t') || t.startsWith('terror')) return 'TERRORIST';
  if (t.startsWith('spec')) return 'Spectator';
  if (t.startsWith('unass') || t === '' ) return 'Unassigned';
  return team;
}


// commandes autorisées (minuscule). Ajoute ce que tu veux.
const ALLOWED_COMMANDS = new Set([
  'pause', 'unpause', 'tech', 'tac', 'start', 'knife', 'stop', 'ready', 'unready', 'timeout', 'restart'
]);

// préfixes de commande reconnus
const CMD_PREFIXES = ['!', '/'];

@Injectable()
export class Cs2LogsService {
  private readonly logger = new Logger(Cs2LogsService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

async handleJson(serverId: string, seg: string): Promise<void> {
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
    id: (global as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    type: 'round_stats',
    ts: Date.now(),
    serverId,
    source: 'logs',
    payload: {
      round: Number(doc.round_number),
      score_t: Number(doc.score_t),
      score_ct: Number(doc.score_ct),
      map: doc.map ?? '',
      server: doc.server ?? '',
      players
    },
  };
  this.logger.log('publishing' + evt);
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
        if (ch !== '\n' && ch !== '\r') out += ch; // supprime \n/\r *dans* les chaînes
      }
    }
    return out;
  }

  function parseRoundStatsLoose(txt: string) {
    // Sécurise l’objet (bords facultatifs)
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

    // Bloc players (accepte contenu non-JSON strict)
    const playersBlock = txt.match(/"players"\s*:\s*\{([\s\S]*?)\}/m)?.[1] ?? '';
    const players: Record<string, string> = {};
    for (const m of playersBlock.matchAll(/"player_\d+"\s*:\s*"([^"]*)"/g)) {
      const id = playersBlock.slice(0, m.index!).match(/"player_\d+"/g)?.length ?? 1;
      players[`player_${id - 1}`] = m[1];
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



  /**
   * Entrée depuis le controller.
   */
  async handleLogLine(serverId: string, line: unknown) {
    let text: string;
    if (typeof line === 'string') text = line;
    else if (Buffer.isBuffer(line as any)) text = (line as Buffer).toString('utf8');
    else text = JSON.stringify(line ?? '');

    text = stripCs2Prefix(text);
    const ts = Date.now();
    await this.publish('ggbot:logs', { type: 'log', serverId, line: text, ts });
    // suite du parsing…
    const chat = this.tryParseChat(text, serverId, ts);
    if (chat) {
      const cmd = this.tryParseCommand(chat);
      if (cmd) {
        await this.publish('ggbot:commands', cmd);
        this.logger.log(`[command] ${cmd.name} ${cmd.args.join(' ')} @${serverId} by ${cmd.from.name}`);
        return;
      }
      await this.publish('ggbot:chat', chat);
      return;
    }else{
      const event = this.tryParseEvent(text,serverId, "TODO: id");
      if(event){
        this.logger.log('publishing', event);
        await this.publish('ggbot:events', event);
      }
    }
  }


private async publish(channel: string, payload: unknown) {
  return await this.redis.publish(channel, JSON.stringify(payload));
}

  private tryParseChat(line: string, serverId: string, ts: number): ChatEvent | null {
  const m = CHAT_RE.exec(line);
    if (!m?.groups) return null;
    return {
      type: 'chat',
      serverId,
      ts,
      channel: (m.groups.channel === 'say_team' ? 'say_team' : 'say'),
      player: {
        name: m.groups.name,
        userId: Number.isFinite(+m.groups.userid) ? +m.groups.userid : null,
        steamId: m.groups.steam || null,
        team: normTeam(m.groups.team),
      },
      message: (m.groups.msg ?? '').trim(),
    };
  }

  private tryParseCommand(chat: ChatEvent): CommandEvent | null {
    let msg = chat.message.trim();

      // Préfixe requis
      const first = msg[0];
      if (!CMD_PREFIXES.includes(first)) return null;
      msg = msg.slice(1).trim(); // retire le préfixe

      // tokenisation simple
      const parts = msg.split(/\s+/);
      if (parts.length === 0) return null;

      // alias
      const cmd0 = parts[0].toLowerCase();
      let name = cmd0;
      if (cmd0 === 'tactical' || cmd0 === 'timeout') name = 'tac';
      if (cmd0 === 'p') name = 'pause';
      if (cmd0 === 'technical') name = 'tech';

      if (!ALLOWED_COMMANDS.has(name)) return null;

      const args = parts.slice(1);

      return {
        type: 'command',
        serverId: chat.serverId,
        ts: chat.ts,
        name,
        args,
        from: {
          name: chat.player.name,
          steamId: chat.player.steamId,
          team: chat.player.team,
          channel: chat.channel,
        },
      };
  }

  private tryParseEvent(
    line: string,
    serverId: string,
    matchId: string,
    map?: string | null,
    round?: number | null,
    tick?: number | null
  ): MatchEvent | null {
const ts = Date.now();
  for (const h of HANDLERS) {
    const m = line.match(h.re);
    if (!m) continue;
    const base = h.build(m);
    return {
      id: crypto.randomUUID(),
      ts,
      serverId,
      matchId,
      map,
      round,
      tick,
      source: 'logs',
      type: base.type,
      payload: base.payload
    };
  }
  return null;
}
}
