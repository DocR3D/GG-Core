import { EventTypes } from '@domain/types/event.types';
import type { Rule } from './types';
import { toT } from './types';

// Variante “fallback SFUI” (télémétrie)
const winFixedTelemetry = (re: RegExp, winner: 'T' | 'CT', reason?: any): Rule => ({
  re,
  build: (_m, _build, buildTel) =>
    buildTel(EventTypes.TEAM_ROUND_WIN, { winner, ...(reason && { reason }) }),
});

export const ROUND_WIN_RULES: Rule[] = [
  // SFUI fallback → telemetry
  winFixedTelemetry(/SFUI_Notice_Target_Bombed/, 'T', 'bomb_exploded'),
  winFixedTelemetry(/SFUI_Notice_Terrorists_Win/, 'T', 'elim'),
  winFixedTelemetry(/SFUI_Notice_Bomb_Defused/, 'CT', 'defused'),
  winFixedTelemetry(/SFUI_Notice_Target_Saved/, 'CT', 'time'),
  winFixedTelemetry(/SFUI_Notice_CTs_Win/, 'CT', 'elim'),

  // Source primaire (Round_Win explicite) → primary
  {
    re: /Team "(TERRORIST|CT)".*?Round_Win.*?reason "([^"]+)"/,
    build: (m, build) =>
      build(EventTypes.TEAM_ROUND_WIN, {
        winner: toT(m[1]),
        reason: m[2],
      }),
  },
];
