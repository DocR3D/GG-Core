// domain/phase.types.ts
export type Phase =
  | 'warmup'
  | 'knife'
  | 'knife_decision'
  | 'live'
  | 'halftime'
  | 'overtime'
  | 'postgame';

// Les phases qu’on peut cibler via un countdown (on ne “va pas” vers warmup)
export type NextPhase = Exclude<Phase, 'warmup'>;
