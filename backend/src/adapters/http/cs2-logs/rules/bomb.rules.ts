import { EventTypes } from '@domain/types/event.types';
import type { Rule } from './types';
import type { PlayerRefLogs } from '@domain/types/match.event';

const BOMB_PLANTED_RE =
  /^"(?<name>.+?)<\d+><(?<steam>STEAM_[^>]+|\[U:[^>]+\])><(?<team>TERRORIST|CT)>" planted the bomb(?: at (?:[Bb]ombsite )?(?<site>[AB]))?$/;

export const BOMB_RULES: Rule[] = [
  {
    re: BOMB_PLANTED_RE,
    build: (m, build) => {
      const g = (m as any).groups!;
      const site = g.site === 'A' || g.site === 'B' ? (g.site as 'A' | 'B') : undefined;
      return build(EventTypes.BOMB_PLANTED, {
        planter: { name: g.name, steamId: g.steam, team: g.team } as PlayerRefLogs,
        ...(site && { site }),
      });
    },
  },
];
