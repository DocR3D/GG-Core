// domain/phase.types.ts
export type Phase =
  | 'warmup_knife'
  | 'knife_live'
  | 'knife_choice'
  | 'warmup_main'
  | 'live_main'
  | 'half_time'
  | 'overtime'
  | 'postgame'
  | 'paused_tac'
  | 'paused_tech' ;
// domain/phase.types.ts
export enum MatchPhase {
  WARMUP_MAIN  = 'warmup_main',
  KNIFE_WARMUP = 'warmup_knife',
  KNIFE_LIVE   = 'knife_live',
  HALFTIME     = "half_time",
  KNIFE_CHOICE = 'knife_choice',
  LIVE_MAIN    = 'live_main',
  OVERTIME    = 'overtime',
  POSTGAME    = 'postgame',
  PAUSED_TAC   = 'paused_tac',
  PAUSED_TECH  = 'paused_tech',
}

// Les phases qu’on peut cibler via un countdown (on ne “va pas” vers warmup)
export type NextPhase = Exclude<Phase, 'warmup'>;
