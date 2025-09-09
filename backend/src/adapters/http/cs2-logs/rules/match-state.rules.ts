import { EventTypes } from '@domain/types/event.types';
import type { Rule } from './types';

export const MATCH_STATE_RULES: Rule[] = [
  // Round start
  {
    re: /World triggered "Round_Start"/,
    build: (_m, build) => build(EventTypes.ROUND_START, {}),
  },
  // Pause / unpause
  {
    re: /Match Paused/,
    build: (_m, build) => build(EventTypes.MATCH_PAUSED, {}),
  },
  {
    re: /Match Unpaused/,
    build: (_m, build) => build(EventTypes.MATCH_UNPAUSED, {}),
  },
  // Connexions / déconnexions / rename
  {
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>[^>]+)>" connected(?:, address "(?<address>[^"]+)")?$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.PLAYER_CONNECTED, {
        player: { name: g.name, steamId: g.steam, team: g.team },
      });
    },
  },
  {
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><[^>]+>" disconnected \(reason "(?<reason>[^"]+)"\)$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.PLAYER_DISCONNECTED, {
        player: { name: g.name, steamId: g.steam },
        reason: g.reason,
      });
    },
  },
  {
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
];
