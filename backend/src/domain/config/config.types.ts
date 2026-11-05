// src/domain/config/config.types.ts

export type CanonicalCommand =
  | 'ready'
  | 'unready'
  | 'pause'
  | 'tech'
  | 'unpause'
  | 'restore'
  | 'backup'
  | 'cancel'
  | 'admin'
  | 'help'
  | 'pauses'
  | 'score'
  | 'stay'
  | 'switch'
  | 'init';

export type MessageKey =
  | 'BOT_TAG'
  | 'ADMIN_CALL_ACK'
  | 'ADMIN_ACTION_TECH'
  | 'ADMIN_ACTION_FORCE_START'
  | 'ADMIN_ACTION_SWAP'
  | 'ADMIN_ACTION_REPLAY_ROUND'
  | 'PAUSE_TAC_ARMED'
  | 'PAUSE_TAC_LIVE'
  | 'PAUSE_TECH_ARMED'
  | 'PAUSE_TECH_LIVE'
  | 'PAUSE_RESUME_INTERRUPTED'
  | 'UNPAUSE_WAITING'
  | 'UNPAUSE_AGREED'
  | 'MATCH_RESUMED'
  | 'READY_ANNOUNCED'
  | 'UNREADY_ANNOUNCED'
  | 'RESTORE_PROPOSED'
  | 'RESTORE_PROPOSAL_EXPIRY'
  | 'RESTORE_ADMIN_REVIEW'
  | 'RESTORE_ADMIN_NOTIFIED'
  | 'RESTORE_MUTUAL_AGREED'
  | 'RESTORE_VALIDATED'
  | 'RESTORE_REFUSED'
  | 'RESTORE_CANCELLED'
  | 'RESTORE_RESUME_DELAY'
  | 'RESTORE_RESUMED'
  | 'RESTORE_INVALID_ROUND'
  | 'RESTORE_ALREADY_ACTIVE'
  | 'RESTORE_ERROR'
  | 'RESTORE_NO_CHECKPOINTS'
  | 'RESTORE_CHECKPOINTS_HEADER'
  | 'INFO_PAUSES_REMAINING'
  | 'INFO_SCORE'
  | 'INFO_WARMUP_COMMANDS'
  | 'INFO_KNIFE_CHOICE_COMMANDS'
  | 'INFO_LIVE_COMMANDS'
  | 'SIDES_BAD_PLACEMENT'
  | 'SIDES_CHANGE_NEEDED'
  | 'SIDES_INVERTED_SWAP'
  | 'MATCH_CONFIGURED'
  | 'MATCH_END_WINNER'
  | 'MATCH_END_DRAW'
  | 'HALFTIME_ANNOUNCED'
  | 'HALFTIME_READY_PROMPT'
  | 'OVERTIME_ANNOUNCED'
  | 'OVERTIME_READY_PROMPT'
  | 'OVERTIME_HALFTIME'
  | 'OVERTIME_NEW_OT'
  | 'GAME_OVER_DISPUTED';

export interface TournamentMatchRulesConfig {
  tacticalPauseBankSec?: number;
  technicalPauseMaxDurationSec?: number;
  postgameResetDelaySec?: number;
  postgameKickDelaySec?: number;
}

export interface TournamentCustomConfig {
  botTag?: string;
  commandAliases?: Partial<Record<CanonicalCommand, string[]>>;
  disabledCommands?: CanonicalCommand[];
  messages?: Partial<Record<MessageKey, string>>;
  matchRules?: TournamentMatchRulesConfig;
}

export interface TournamentEffectiveConfig {
  botTag: string;
  commandAliases: Record<CanonicalCommand, string[]>;
  disabledCommands: CanonicalCommand[];
  messages: Record<MessageKey, string>;
  matchRules: Required<TournamentMatchRulesConfig>;
}

export interface ResolvedCommand {
  canonical: CanonicalCommand;
  rawInput: string;
  isAllowed: boolean;
}
