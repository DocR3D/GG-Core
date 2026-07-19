export const EventTypes = {
  ROUND_START:        'round_start',
  BOMB_PLANTED:       'bomb_planted',
  BEGIN_BOMB_PLANT:   'begin_bomb_plant',
  TEAM_ROUND_WIN:     'team_round_win',
  SFUI_TARGET_BOMBED: 'sfui_notice_target_bombed',
  BOMB_DEFUSED:       'bomb_defused',

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

  PHASE_COUNTDOWN_CANCELLED: 'phase_change_canceled',
  PHASE_CHANGED: 'phase_changed',

  ROUND_FREEZE_START: 'round_freeze_start',

  // ---- Score / match-state autoritaires (émis par l'agent depuis les events CS2) ----
  TEAM_SCORE:           'team_score',           // score absolu par équipe (teamId=2 T, 3 CT)
  ROUND_END:            'round_end',            // fin de round avec winner + scores
  TEAM_INFO:            'team_info',            // nom d'équipe par teamid
  CS_WIN_PANEL_MATCH:   'cs_win_panel_match',   // match terminé définitivement
  CS_INTERMISSION:      'cs_intermission',      // halftime ou fin de prolongation
  BEGIN_NEW_MATCH:      'begin_new_match',      // restart / nouvelle map
  MATCH_END_CONDITIONS: 'match_end_conditions', // win_rounds + max_rounds du serveur
  TEAM_SWAP:           'team_swap',             // échange de côté CT↔T (halftime)
  MATCH_STATUS_SCORE:  'match_status_score',    // MatchStatus: Score: CT:T RoundsPlayed: N

} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
