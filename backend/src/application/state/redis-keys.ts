export const redisConst = {
  // Liaison serveur ↔ match
  serverMatch: (serverId: string) => `server:${serverId}:currentMatch`,
  matchServer: (matchId: string) => `match:${matchId}:server`,
  
  eventsPrimary: (serverId: string) => `ggbot:events_primary:${serverId}`,
  // Match-level keys existantes
  sides:       (matchId: string) => `match:${matchId}:sides`,
  score:       (matchId: string) => `match:${matchId}:score`,
  timeouts:    (matchId: string) => `match:${matchId}:timeouts`,
  teams:       (matchId: string) => `match:${matchId}:teams`,
  playersHash: (matchId: string) => `match:${matchId}:players`,
  lineupHome:  (matchId: string) => `match:${matchId}:lineup:home`,
  lineupAway:  (matchId: string) => `match:${matchId}:lineup:away`,

  // Économie
  economyTeam: (matchId: string) => `match:${matchId}:economy:team`,
  moneyHash:   (matchId: string) => `match:${matchId}:money`,
  equipHash:   (matchId: string) => `match:${matchId}:equip`,

  // Nouveaux pour état/horloge/ready
  state:       (matchId: string) => `match:${matchId}:state`,   // phase, subphase, round, etc.
  clock:       (matchId: string) => `match:${matchId}:clock`,   // phaseEndsAt, pauseEndsAt, etc.
  ready:       (matchId: string) => `match:${matchId}:ready`,   // home=0|1, away=0|1
  seq:         (matchId: string) => `match:${matchId}:seq`,     // incrément global pour WS/events
  phase:       (matchId: string) => `match:${matchId}:phase`,        // string
  phasePending:(matchId: string) => `match:${matchId}:phase:pending`,// string
  phaseLock:   (matchId: string) => `match:${matchId}:phase:lock`,   // string (SET NX EX)
  pause:       (matchId: string) => `match:${matchId}:pause`,        // hash { state, ... } optionnel

  knifeWinner:  (m: string) => `match:${m}:knife:winner`,            // 'home' | 'away'
  knifeChoiceT: (m: string) => `match:${m}:knife:choice_deadline`,   // ts ms


} as const;
