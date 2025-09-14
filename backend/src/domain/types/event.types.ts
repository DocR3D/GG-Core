export const EventTypes = {
  ROUND_START:        'round_start',
  BOMB_PLANTED:       'bomb_planted',
  BEGIN_BOMB_PLANT:   'begin_bomb_plant',
  TEAM_ROUND_WIN:     'team_round_win',
  SFUI_TARGET_BOMBED: 'sfui_target_bombed', // corrigé
  KILL:               'kill',

  PLAYER_CONNECTED:    'player_connected',    // corrigé
  PLAYER_DISCONNECTED: 'player_disconnected', // corrigé
  PLAYER_NAME_CHANGE:  'player_name_change',  // plus explicite

  DEFUSE_BEGIN:   'defuse_begin',
  DEFUSE_ABORT:   'defuse_abort',
  MATCH_PAUSED:   'match_paused',
  MATCH_UNPAUSED: 'match_unpaused',

  CHAT_MESSAGE: 'chat_message',
  COMMAND:      'command',
  LOG:          'raw_log',
  ROUND_STATS:  'round_stats',

  ITEM_PURCHASE:  'item_purchase',
  GRENADE_THROW:  'grenade_throw',
  GRENADE_LAND:   'grenade_land',
  PLAYER_BLINDED: 'player_blinded',

  PHASE_CHANGED: 'phase_changed',

} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
