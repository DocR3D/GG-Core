import { EventTypes } from '@domain/types/event.types';
import type { Rule } from './types';
import type { PlayerRefLogs } from '@domain/types/match.event';

export const DEFUSE_RULES: Rule[] = [
  // Begin without kit
  {
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_Without_Kit"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_BEGIN, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
        hasKit: false,
      });
    },
  },
  // Begin with kit
  {
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Begin_Bomb_Defuse_With_Kit"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_BEGIN, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
        hasKit: true,
      });
    },
  },
  // Abort
  {
    re: /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" triggered "Abort_Bomb_Defuse"$/,
    build: (m, build) => {
      const g = (m as any).groups!;
      return build(EventTypes.DEFUSE_ABORT, {
        player: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
      });
    },
  },
];
