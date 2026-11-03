// src/application/match/restore/round-restore.types.ts

export interface RoundRestoreCandidate {
  round: number;
  backupFile: string;
  scoreHome: number;
  scoreAway: number;
  scoreCt: number;
  scoreT: number;
  isCurrent: boolean;
  canDirectRestore: boolean; // true si entre currentRound et currentRound - 2
}

export interface RestoreProposal {
  matchId: string;
  serverId: string;
  targetRound: number;
  backupFile: string;
  proposingTeam: 'home' | 'away';
  proposingPlayer: { name: string; steamId?: string };
  proposedAt: number;
  expiresAt: number;
  requiresAdmin: boolean;
  opponentAgreed: boolean;
  adminApproved: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
}

export class ProposeRestoreDto {
  targetRound!: number;
}

export class ConfirmRestoreDto {
  targetRound?: number;
}

export class CancelRestoreDto {
  reason?: string;
}
