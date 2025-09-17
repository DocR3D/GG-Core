export enum MessageMode {
  Chain = 'chain',
  Rotate = 'rotate',
  Random = 'random',
}

export interface ChainSay {
  mode: MessageMode.Chain;
  items: { text: string; intervalMs: number }[];
}

export interface RotateSay {
  mode: MessageMode.Rotate;
  intervalMs: number;
  items: string[];
}

export interface RandomSay {
  mode: MessageMode.Random;
  intervalMs: number;
  items: string[];
}

export type SayUnit = ChainSay | RotateSay | RandomSay;
export type SaySpec = SayUnit | SayUnit[];