// src/application/broadcast/buytime-broadcast.types.ts

export interface ServerBroadcastProgress {
  serverId: string;
  roundsRemaining: number;
  roundsSent: number;
  lastSentRound?: number;
  lastSentAt?: number;
  completed: boolean;
  immediate?: boolean;
  warmupRepeatsRemaining?: number;
}

export interface BuytimeBroadcast {
  id: string;
  message: string;
  prefix: string;
  formattedMessage: string;
  roundsTotal: number;
  warmupRepeats: number;
  warmupIntervalSec: number;
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
  /** Number of rounds to display this message at buytime in competitive match (default: 1 round, configurable to N rounds). */
  roundsCount?: number;
  /** Target server names (e.g. ['srv-a', 'srv-b']), or 'all' for every server. Default: 'all'. */
  targets?: 'all' | string[];
  /** Prefix displayed before message in chat. Default: '[Annonce]'. */
  prefix?: string;
  /** If a server has no running competitive match (warmup, idle), send immediately instead of waiting. Default: true. */
  sendImmediateIfNoMatch?: boolean;
  /** In warmup: number of times to repeat the message (default: 1 for immediate dispatch, configurable to N repeats). */
  warmupRepeats?: number;
  /** In warmup: interval in seconds between repeated messages (default: 60 seconds). */
  warmupIntervalSec?: number;
}

export class RearmBroadcastDto {
  /** How many additional rounds to arm this message for (default: 1 round, configurable). */
  additionalRounds?: number;
  /** Alias for additionalRounds if caller passes roundsCount instead. */
  roundsCount?: number;
  /** In warmup: additional repeats if server is in warmup. Default: 1. */
  warmupRepeats?: number;
}
