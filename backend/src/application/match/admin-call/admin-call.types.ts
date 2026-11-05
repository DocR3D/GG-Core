// src/application/match/admin-call/admin-call.types.ts

export interface AdminCall {
  id: string;
  matchId: string;
  serverId: string;
  team: 'home' | 'away' | 'system';
  player: { name: string; steamId?: string };
  message: string;
  calledAt: number;
  status: 'open' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

export class CreateAdminCallDto {
  message!: string;
}
