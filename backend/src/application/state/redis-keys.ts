export const redisConst = {
  serverMatchid: (serverId: string) => `server:${serverId}:matchId`,
  sides:       (matchId: string)   => `match:${matchId}:sides`,
  score:       (matchId: string)   => `match:${matchId}:score`,
  timeouts:    (matchId: string)   => `match:${matchId}:timeouts`,
  teams:       (matchId: string)   => `match:${matchId}:teams`,
  playersHash: (matchId: string) => `match:${matchId}:players`,
  lineupHome:  (matchId: string) => `match:${matchId}:lineup:home`,
  lineupAway:  (matchId: string) => `match:${matchId}:lineup:away`,

  economyTeam: (matchId: string) => `match:${matchId}:economy:team`,
  moneyHash:   (matchId: string) => `match:${matchId}:money`,
  equipHash:   (matchId: string) => `match:${matchId}:equip`,
} as const;