import { CS2_RULES, DEFAULT_TAC_BANK_SEC } from './rules/rules.constants';

export interface MatchSettings {
  /**
   * Whether to insert a warmup phase after knife choice.
   * Default: false (Fast LAN mode: passes directly into live_main with 5s countdown)
   */
  warmupAfterKnife?: boolean;

  /**
   * Whether to insert a warmup/ready phase at halftime.
   * Default: false (Fast LAN mode: swaps sides and restarts automatically)
   */
  warmupAtHalftime?: boolean;

  /**
   * Whether to insert a warmup/ready phase before starting overtime.
   * Default: false (Fast LAN mode: begins OT automatically)
   */
  warmupAtOvertime?: boolean;

  /**
   * Action to perform on the CS2 server when match ends.
   * - 'soft_reset': Stops GOTV and resets server to warmup mode via RCON
   * - 'restart': Kicks players and restarts CS2 process/container via RCON quit (purges RAM)
   * Default: 'soft_reset'
   */
  postgameAction?: 'soft_reset' | 'restart';

  /**
   * Seconds to wait after Game Over before applying postgameAction, so players keep the end screen
   * and scoreboard during CS2's intermission (mp_match_restart_delay).
   * Default: 30
   */
  postgameResetDelaySec?: number;

  /**
   * Seconds after Game Over before every player still connected is kicked, so nobody stays on a
   * server whose match is over (common at the LAN). 0 disables it.
   * Default: 120
   */
  postgameKickDelaySec?: number;

  /**
   * Regulation MR format (e.g. 12 rounds per half, 13 to win in CS2).
   * Default: 12
   */
  mrFormat?: number;

  /**
   * Overtime MR format (e.g. 3 rounds per half in OT, MR3 Valve official).
   * Default: 3
   */
  overtimeMrFormat?: number;

  /**
   * Whether overtime is enabled on regulation tie (12-12).
   * Default: true
   */
  overtimeEnabled?: boolean;

  /**
   * Tactical pause bank per team, in seconds, for the whole match: each team uses it as it wants
   * (several short pauses or one long one); a pause ends on !unpause or when the bank is empty.
   * Default: DEFAULT_TAC_BANK_SEC
   */
  tacticalPauseBankSec?: number;

  /**
   * Whether knife round is enabled before the match.
   * Default: true
   */
  knifeEnabled?: boolean;
}

/**
 * Server and GG-Core disagree on the end of the match (e.g. CS2 declared a draw after OT1 while the
 * rules require another overtime). The result is frozen until an admin decides.
 */
export interface MatchReview {
  reason: 'server_ended_match' | 'final_score_mismatch';
  serverScore: { ct: number; t: number };
  ggScore: { ct: number; t: number };
  ggPhase: string;
  openedAt: number;
}

export const DEFAULT_MATCH_SETTINGS: Required<MatchSettings> = {
  warmupAfterKnife: false,
  warmupAtHalftime: false,
  warmupAtOvertime: false,
  postgameAction: 'soft_reset',
  postgameResetDelaySec: 30,
  postgameKickDelaySec: 120,
  mrFormat: CS2_RULES.DEFAULT_MR_HALF,
  overtimeMrFormat: CS2_RULES.DEFAULT_OT_HALF,
  overtimeEnabled: true,
  knifeEnabled: true,
  tacticalPauseBankSec: DEFAULT_TAC_BANK_SEC,
};
