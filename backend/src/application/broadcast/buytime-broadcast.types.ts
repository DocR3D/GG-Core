// src/application/broadcast/buytime-broadcast.types.ts

export interface ServerBroadcastProgress {
  serverId: string;
  roundsRemaining: number;
  roundsSent: number;
  lastSentRound?: number;
  lastSentAt?: number;
  completed: boolean;
  immediate?: boolean;
}

export interface BuytimeBroadcast {
  id: string;
  message: string;
  prefix: string;
  formattedMessage: string;
  roundsTotal: number;
  createdAt: number;
  createdBy: string;
  sendImmediateIfNoMatch: boolean;
  cancelled?: boolean;
  completed: boolean;
  servers: Record<string, ServerBroadcastProgress>;
}

export class CreateBroadcastDto {
  /** The message text to display in game chat. */
  message!: string;
  /** Number of rounds to display this message at buytime (e.g. 1 for next round, 3 for 3 rounds in a row). Default: 1. */
  roundsCount?: number;
  /** Target server names (e.g. ['srv-a', 'srv-b']), or 'all' for every server. Default: 'all'. */
  targets?: 'all' | string[];
  /** Prefix displayed before message in chat. Default: '[Annonce]'. */
  prefix?: string;
  /** If a server has no running competitive match (warmup, idle), send immediately instead of waiting. Default: true. */
  sendImmediateIfNoMatch?: boolean;
}

export class RearmBroadcastDto {
  /** How many additional rounds to arm this message for. Default: 1. */
  additionalRounds?: number;
}
