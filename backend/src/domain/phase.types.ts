// domain/phase.types.ts
export type Phase =
  | 'warmup'
  | 'knife'
  | 'knife_decision'
  | 'live'
  | 'halftime'
  | 'overtime'
  | 'postgame';
// domain/phase.types.ts
export enum MatchPhase {
  WARMUP_MAIN  = 'warmup_main',
  KNIFE_WARMUP = 'warmup_knife',
  KNIFE_LIVE   = 'knife_live',
  KNIFE_CHOICE = 'knife_choice',
  LIVE_MAIN    = 'live_main',
  PAUSED_TAC   = 'paused_tac',
  PAUSED_TECH  = 'paused_tech',
}


// Les phases qu’on peut cibler via un countdown (on ne “va pas” vers warmup)
export type NextPhase = Exclude<Phase, 'warmup'>;
