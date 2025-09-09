import { EventTypes } from '@domain/types/event.types';
import type { Rule } from './types';
import type { PlayerRefLogs } from '@domain/types/match.event';

// A) Joueur → joueur (positions obligatoires)
const KILL_PLAYER_RE =
  /^"(?<kName>.+?)<\d+><(?<kSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<kTeam>TERRORIST|CT)>"\s*\[(?<kX>-?\d+)\s+(?<kY>-?\d+)\s+(?<kZ>-?\d+)\]\s+killed\s+"(?<vName>.+?)<\d+><(?<vSteam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<vTeam>TERRORIST|CT)>"\s*\[(?<vX>-?\d+)\s+(?<vY>-?\d+)\s+(?<vZ>-?\d+)\]\s+with\s+"(?<weapon>[^"]+)"(?<tail>.*)$/;

// B) Suicide (position victime obligatoire)
const KILL_SUICIDE_RE =
  /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\]|BOT)><(?<team>TERRORIST|CT|SPECTATOR|Unassigned)>"\s*\[(?<x>-?\d+)\s+(?<y>-?\d+)\s+(?<z>-?\d+)\]\s+committed\s+suicide\s+with\s+"(?<weapon>[^"]+)"$/;

export const KILL_RULES: Rule[] = [
  {
    re: KILL_PLAYER_RE,
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
          killerPos: { x: +g.kX, y: +g.kY, z: +g.kZ },
          victimPos: { x: +g.vX, y: +g.vY, z: +g.vZ },
        },
        extra,
      );
    },
  },
  {
    re: KILL_SUICIDE_RE,
    build: (m, _build, buildTel, extra) => {
      const g = (m as any).groups!;
      return buildTel(
        EventTypes.KILL,
        {
          kind: 'suicide',
          player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
          weapon: g.weapon,
          victimPos: { x: +g.x, y: +g.y, z: +g.z },
        },
        extra,
      );
    },
  },
];
