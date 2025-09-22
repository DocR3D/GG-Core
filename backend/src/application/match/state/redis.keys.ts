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
  playersHash:  (m: string) => `match:${m}:players`,
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
