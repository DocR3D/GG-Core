import type { Rule } from './types';
import { ROUND_WIN_RULES } from './round-win.rules';
import { KILL_RULES } from './kill.rules';
import { BOMB_RULES } from './bomb.rules';
import { DEFUSE_RULES } from './defuse.rules';
import { MATCH_STATE_RULES } from './match-state.rules';

export * from './types';

// L’ordre a de l’importance (ex : source primaire avant fallback si besoin)
export const RULES: Rule[] = [
  ...ROUND_WIN_RULES,
  ...KILL_RULES,
  ...BOMB_RULES,
  ...DEFUSE_RULES,
  ...MATCH_STATE_RULES,
];
