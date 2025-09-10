export const EventTypes = {
  ROUND_START: 'round_start',
  BOMB_PLANTED: 'bomb_planted',
  TEAM_ROUND_WIN: 'team_round_win',
  SFUI_TARGET_BOMBED: 'sfui_notice_target_bombed',
  KILL: 'kill',
  PLAYER_CONNECTED: 'player_connect',
  PLAYER_DISCONNECTED: 'player_disconnect',
  PLAYER_NAME_CHANGE: 'name_change',
  DEFUSE_BEGIN: 'defuse_begin',
  DEFUSE_ABORT: 'defuse_abort',
  MATCH_PAUSED: 'match_paused',
  MATCH_UNPAUSED: 'match_unpaused',

  CHAT_MESSAGE: 'chat_message',
  COMMAND: 'command',
  LOG: 'raw_log',
  ROUND_STATS: 'round_stats',

} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];