export const redisConst = {
  // Liaison serveur ↔ match
  serverMatch: (serverId: string) => `server:${serverId}:currentMatch`,
  matchServer: (matchId: string) => `match:${matchId}:server`,

  // Bus d’événements
  eventsPrimary: (serverId: string) => `ggbot:events_primary:${serverId}`,

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

  // 🔹 NEW: map (hash)
  map:          (m: string) => `match:${m}:map`,            // hash { name, set_at }

  ready:        (m: string) => `match:${m}:ready`,          // hash
  rdyPlayers:   (m: string) => `match:${m}:rdy_players`,   // Redis Set (steamIds)
  playersHash:  (m: string) => `match:${m}:players`,
  lineupHome:   (m: string) => `match:${m}:lineup:home`,
  lineupAway:   (m: string) => `match:${m}:lineup:away`,

  // Économie
  economyTeam:  (m: string) => `match:${m}:economy:team`,
  moneyHash:    (m: string) => `match:${m}:money`,
  equipHash:    (m: string) => `match:${m}:equip`,

  // Séquence WS
  seq:          (m: string) => `match:${m}:seq`,

  // Config serveur CS2 (mp_maxrounds, mp_overtime_enable, …)
  matchConfig: (m: string) => `match:${m}:config`,          // hash

  // Knife
  knifeWinner:        (m: string) => `match:${m}:knife:winner`,
  knifeWinnerSide:    (m: string) => `match:${m}:knife_winner_side`,
  knifeWinnerLogical: (m: string) => `match:${m}:knife_winner_logical`,
  knifeChoice:        (m: string) => `match:${m}:knife_choice`,
  knifeChoiceT:       (m: string) => `match:${m}:knife:choice_deadline`,

  // Série (Bo1/Bo3/Bo5)
  seriesConfig:        (s: string) => `series:${s}:config`,        // hash: {bo, overtimeEnabled, homeId, awayId}
  seriesScores:        (s: string) => `series:${s}:scores`,        // hash: {home, away} — victoires de maps
  seriesMaps:          (s: string) => `series:${s}:maps`,          // string (JSON MapEntry[])
  seriesMatch:         (s: string, n: number) => `series:${s}:match:${n}`, // string: matchId pour la map n
  seriesDbId:          (s: string) => `series:${s}:dbId`,          // string: PG id de Series
} as const;
