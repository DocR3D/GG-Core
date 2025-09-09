// src/adapters/http/cs2-logs/rules.ts

import { EventTypes } from '../../../domain/types/event.types';
import type { MatchEvent, PlayerRefLogs, TeamRoundWinReason } from '../../../domain/types/match.event';
import type { BaseEvent } from '../../../domain/types/base.event';
import { withCtx } from '../../../domain/types/factory';

// --------- Utils (inchangés) ---------

const CS2_PREFIX_RE = /^(?:L\s\d{2}\/\d{2}\/\d{4}\s-\s\d{2}:\d{2}:\d{2}:\s+)/;
export function stripCs2Prefix(line: string): string {
  return line.replace(CS2_PREFIX_RE, '');
}

const toT = (s: string) => (s === 'TERRORIST' ? 'T' : 'CT');

// --------- Types locaux ---------

type BuildFn = ReturnType<typeof withCtx>;
type Extra = Partial<Pick<BaseEvent<any, any>, 'map' | 'round' | 'tick'>>;

type Rule = {
  re: RegExp;
  /**
   * Construit un MatchEvent complet via build/buildTel (enveloppe créée par withCtx)
   */
  build: (m: RegExpMatchArray, build: BuildFn, buildTel: BuildFn, extra: Extra) => MatchEvent;
};

// --------- Règles (ex- HANDLERS) ---------

/**
 * Round win fixes SFUI (fallback télémétrie)
 */
const winFixed = (re: RegExp, winner: 'T' | 'CT', reason?: TeamRoundWinReason): Rule => ({
  re,
  build: (_m, build) =>
    build(
      EventTypes.TEAM_ROUND_WIN,
      { winner, ...(reason && { reason }) },
      // Ces SFUI sont moins “forts” que le Round_Win explicite → on marque telemetry
    ),
});

// IMPORTANT: si tu veux VRAIMENT marquer ces SFUI en telemetry au niveau de l’enveloppe,
// utilises buildTel (kind: 'telemetry') au lieu de build :
const winFixedTelemetry = (re: RegExp, winner: 'T' | 'CT', reason?: TeamRoundWinReason): Rule => ({
  re,
  build: (_m, _build, buildTel) =>
    buildTel(EventTypes.TEAM_ROUND_WIN, { winner, ...(reason && { reason }) }),
});

export const RULES: Rule[] = [
  // ---------- Round Win (SFUI fallback) ----------
  // Choisis l’une des deux variantes (build OU buildTel). Ici je prends telemetry pour marquer “fallback”.
  winFixedTelemetry(/SFUI_Notice_Target_Bombed/, 'T', 'bomb_exploded'),
  winFixedTelemetry(/SFUI_Notice_Terrorists_Win/, 'T', 'elim'),
  winFixedTelemetry(/SFUI_Notice_Bomb_Defused/, 'CT', 'defused'),
  winFixedTelemetry(/SFUI_Notice_Target_Saved/, 'CT', 'time'),
  winFixedTelemetry(/SFUI_Notice_CTs_Win/, 'CT', 'elim'),

  // ---------- Round Win (source de vérité primaire) ----------
  {
    re: /Team "(TERRORIST|CT)".*?Round_Win.*?reason "([^"]+)"/,
    build: (m, build) =>
      build(EventTypes.TEAM_ROUND_WIN, {
        winner: toT(m[1]),
        reason: m[2] as TeamRoundWinReason,
      }),
  },

  // ---------- Player connected ----------
  {
    re: /"(.+)<\d+><(STEAM_[^>]*)><.*>" connected, address "(.*)"/,
    build: (m, build) =>
      build(EventTypes.PLAYER_CONNECTED, {
        player: { name: m[1], steamId: m[2], team: 'Unassigned' },
      }),
  },

  // ---------- Round start ----------
  {
    re: /World triggered "Round_Start"/,
    build: (_m, build) =>
      build(EventTypes.ROUND_START, {}),
  },

  // ---------- KILL: joueur → joueur (positions obligatoires) ----------
  {
    // "Killer<id><STEAM|[U:]|BOT><CT|TERRORIST>" [x y z] killed "Victim<...>" [x y z] with "weapon" (headshot)
    re: /^"(?<kName>.+?)<\d+><(?<kSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<kTeam>TERRORIST|CT)>"\s*\[(?<kX>-?\d+)\s+(?<kY>-?\d+)\s+(?<kZ>-?\d+)\]\s+killed\s+"(?<vName>.+?)<\d+><(?<vSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<vTeam>TERRORIST|CT)>"\s*\[(?<vX>-?\d+)\s+(?<vY>-?\d+)\s+(?<vZ>-?\d+)\]\s+with\s+"(?<weapon>[^"]+)"(?<tail>.*)$/,
    build: (m, _build, buildTel, extra) => {
      const g = (m as any).groups!;
      const headshot = g.tail?.includes('headshot') ?? false;
      const teamkill = g.kTeam === g.vTeam ? true : undefined;

      return buildTel(
        EventTypes.KILL,
        {
          kind: 'player',
          killer: { name: g.kName, steamId: g.kSteam, team: g.kTeam } as PlayerRefLogs,
          victim: { name: g.vName, steamId: g.vSteam, team: g.vTeam } as PlayerRefLogs,
          weapon: g.weapon,
          headshot,
          ...(teamkill && { teamkill }),
          killerPos: { x: Number(g.kX), y: Number(g.kY), z: Number(g.kZ) },
          victimPos: { x: Number(g.vX), y: Number(g.vY), z: Number(g.vZ) },
        },
        extra,
      );
    },
  },

  // ---------- KILL: suicide ----------
  {
    // "Player<id><STEAM|[U:]|BOT><team>" [x y z] committed suicide with "weapon"
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<team>TERRORIST|CT|SPECTATOR|Unassigned)>"\s*\[(?<x>-?\d+)\s+(?<y>-?\d+)\s+(?<z>-?\d+)\]\s+committed\s+suicide\s+with\s+"(?<weapon>[^"]+)"$/,
    build: (m, _build, buildTel, extra) => {
      const g = (m as any).groups!;
      return buildTel(
        EventTypes.KILL,
        {
          kind: 'suicide',
          player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
          weapon: g.weapon,
          victimPos: { x: Number(g.x), y: Number(g.y), z: Number(g.z) },
        },
        extra,
      );
    },
  },

  // ---------- Bomb planted ----------
  {
    // "Name<id><STEAM|[U:]><TERRORIST|CT>" planted the bomb [at A|B]
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" planted the bomb(?: at (?:[Bb]ombsite )?(?<site>[AB]))?$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      const site = g.site === 'A' || g.site === 'B' ? (g.site as 'A' | 'B') : undefined;
      return build(
        EventTypes.BOMB_PLANTED,
        {
          planter: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
          ...(site && { site }),
        },
      );
    },
  },

  // ---------- Player connected (variante adresse optionnelle) ----------
  {
    // "Cap<7><STEAM_1:0:111><Unassigned>" connected, address "192.168.0.10:27005"
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>[^>]+)>" connected(?:, address "(?<address>[^"]+)")?$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.PLAYER_CONNECTED, {
        player: {
          name: g.name,
          steamId: g.steam,
          team: g.team,
        },
      });
    },
  },

  // ---------- Player disconnected ----------
  {
    // "Cap<7><STEAM_1:0:111><CT>" disconnected (reason "Kicked by Console")
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><[^>]+>" disconnected \(reason "(?<reason>[^"]+)"\)$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.PLAYER_DISCONNECTED, {
        player: { name: g.name, steamId: g.steam },
        reason: g.reason,
      });
    },
  },

  // ---------- Name change ----------
  {
    // "Cap<7><STEAM_1:0:111><CT>" changed name to "Captain"
    re: /^"(?<oldName>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><[^>]+>" changed name to "(?<newName>.+)"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.PLAYER_NAME_CHANGE, {
        steamId: g.steam,
        oldName: g.oldName,
        newName: g.newName,
      });
    },
  },

  // ---------- Defuse begin (sans kit) ----------
  {
    // "Alex<9><STEAM_1:0:222><CT>" triggered "Begin_Bomb_Defuse_Without_Kit"
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_Without_Kit"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_BEGIN, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
        hasKit: false,
      });
    },
  },

  // ---------- Defuse begin (avec kit) ----------
  {
    // "Alex<9><STEAM_1:0:222><CT>" triggered "Begin_Bomb_Defuse_With_Kit"
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_With_Kit"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_BEGIN, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
        hasKit: true,
      });
    },
  },

  // ---------- Defuse abort ----------
  {
    // "Alex<9><STEAM_1:0:222><CT>" triggered "Abort_Bomb_Defuse"
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Abort_Bomb_Defuse"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_ABORT, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
      });
    },
  },

  // ---------- Pause/unpause ----------
  {
    re: /Match Paused/,
    build: (_m, build) => build(EventTypes.MATCH_PAUSED, {}),
  },
  {
    re: /Match Unpaused/,
    build: (_m, build) => build(EventTypes.MATCH_UNPAUSED, {}),
  },
];
