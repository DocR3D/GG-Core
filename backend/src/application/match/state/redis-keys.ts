export const redisConst = {
  // Liaison serveur ↔ match
  serverMatch: (serverId: string) => `server:${serverId}:currentMatch`,
  matchServer: (matchId: string) => `match:${matchId}:server`,

  // Bus d’événements
  eventsPrimary: (serverId: string) => `ggbot:events_primary:${serverId}`,

  // Match-level (séparés)
  phase:        (m: string) => `match:${m}:phase`,          // string
  roundPhase:        (m: string) => `match:${m}:roundPhase`,          // string
  phasePending: (m: string) => `match:${m}:phase:pending`,  // string
  phaseLock:    (m: string) => `match:${m}:phase:lock`,     // string
  pause:        (m: string) => `match:${m}:pause`,          // hash { state, ... }
  clock:        (m: string) => `match:${m}:clock`,          // hash { phaseEndsAt, ... }

  sides:        (m: string) => `match:${m}:sides`,          // hash { home, away } -> 'CT'|'T'
  score:        (m: string) => `match:${m}:score`,          // hash { ct, t }
  timeouts:     (m: string) => `match:${m}:timeouts`,       // hash
  teams:        (m: string) => `match:${m}:teams`,          // hash
  ready:        (m: string) => `match:${m}:ready`,          // hash { home, away } -> '0'|'1'
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
  knifeWinner:        (m: string) => `match:${m}:knife:winner`,            // 'home'|'away'
  knifeWinnerSide:    (m: string) => `match:${m}:knife_winner_side`,       // 'CT'|'T'
  knifeWinnerLogical: (m: string) => `match:${m}:knife_winner_logical`,    // 'home'|'away'
  knifeChoice:        (m: string) => `match:${m}:knife_choice`,            // 'pending'|'stay'|'switch'
  knifeChoiceT:       (m: string) => `match:${m}:knife:choice_deadline`,   // ts ms
} as const;
