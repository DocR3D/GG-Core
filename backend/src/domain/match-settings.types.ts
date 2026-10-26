import { CS2_RULES } from './rules/rules.constants';

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
   * Whether knife round is enabled before the match.
   * Default: true
   */
  knifeEnabled?: boolean;
}

export const DEFAULT_MATCH_SETTINGS: Required<MatchSettings> = {
  warmupAfterKnife: false,
  warmupAtHalftime: false,
  warmupAtOvertime: false,
  postgameAction: 'soft_reset',
  mrFormat: CS2_RULES.DEFAULT_MR_HALF,
  overtimeMrFormat: CS2_RULES.DEFAULT_OT_HALF,
  overtimeEnabled: true,
  knifeEnabled: true,
};
