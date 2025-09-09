export const redisConst = {
  serverMatchid: (serverId: string) => `server:${serverId}:matchId`,
  sides:       (matchId: string)   => `match:${matchId}:sides`,
  score:       (matchId: string)   => `match:${matchId}:score`,
  timeouts:    (matchId: string)   => `match:${matchId}:timeouts`,
  teams:       (matchId: string)   => `match:${matchId}:teams`,
} as const;