export const REDIS_CHANNELS = {
  /** Canal principal Pub/Sub de distribution des événements de match */
  EVENTS: 'ggbot:events',
  /** Canal spécifique de flux primaire CS2 par serveur */
  eventsPrimary: (serverId: string) => `ggbot:events_primary:${serverId}`,
  /** Canal de commande RCON vers un agent spécifique */
  agentActions: (serverId: string) => `ggbot:agent:${serverId}:actions`,
} as const;

export const redisConst = {
  // Liaison serveur ↔ match
  serverMatch: (serverId: string) => `server:${serverId}:currentMatch`,
  matchServer: (matchId: string) => `match:${matchId}:server`,
  // Liaison match temps réel ↔ MatchMap PostgreSQL (UUID)
  dbMatchMap: (matchId: string) => `match:${matchId}:db_match_map`,

  // Bus d’événements & Canaux Pub/Sub
  events: REDIS_CHANNELS.EVENTS,
  eventsPrimary: REDIS_CHANNELS.eventsPrimary,
  agentActions: REDIS_CHANNELS.agentActions,

  // Match-level
  phase:        (m: string) => `match:${m}:phase`,
  roundPhase:   (m: string) => `match:${m}:roundPhase`,
  phasePending: (m: string) => `match:${m}:phase:pending`,
  phaseLock:    (m: string) => `match:${m}:phase:lock`,
  pause:        (m: string) => `match:${m}:pause`,          // hash
  clock:        (m: string) => `match:${m}:clock`,          // hash

  sides:        (m: string) => `match:${m}:sides`,          // hash
  score:        (m: string) => `match:${m}:score`,          // hash
  timeouts:     (m: string) => `match:${m}:timeouts`,       // hash
  teams:        (m: string) => `match:${m}:teams`,          // hash

  // Settings & Lifecycle
  settings:     (m: string) => `match:${m}:settings`,       // hash
  lastScoredRound: (m: string) => `match:${m}:last_scored_round`,
  halftimePlayed: (m: string) => `match:${m}:halftime_played`,
  overtimeCount:  (m: string) => `match:${m}:overtime_count`,

  // Map (hash)
  map:          (m: string) => `match:${m}:map`,            // hash { name, set_at }

  ready:        (m: string) => `match:${m}:ready`,          // hash
  playersHash:  (m: string) => `match:${m}:players`,
  playerStatsHash: (m: string) => `match:${m}:player_stats`,
  // Photo des stats joueurs au début de chaque round (champ = nb de rounds joués) : rollback sur backup restore
  playerStatsHistory: (m: string) => `match:${m}:player_stats_history`,
  lineupHome:   (m: string) => `match:${m}:lineup:home`,
  lineupAway:   (m: string) => `match:${m}:lineup:away`,

  // Économie
  economyTeam:  (m: string) => `match:${m}:economy:team`,
  moneyHash:    (m: string) => `match:${m}:money`,
  equipHash:    (m: string) => `match:${m}:equip`,

  // Séquence WS
  seq:          (m: string) => `match:${m}:seq`,

  // Knife
  knifeWinner:        (m: string) => `match:${m}:knife:winner`,
  knifeWinnerSide:    (m: string) => `match:${m}:knife_winner_side`,
  knifeWinnerLogical: (m: string) => `match:${m}:knife_winner_logical`,
  knifeChoice:        (m: string) => `match:${m}:knife_choice`,
  knifeChoiceT:       (m: string) => `match:${m}:knife:choice_deadline`,
} as const;
