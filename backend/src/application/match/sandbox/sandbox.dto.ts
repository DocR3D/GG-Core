// src/application/match/sandbox/sandbox.dto.ts
import { MatchPhase, RoundPhase } from '@domain/phase.types';
import { MatchSettings } from '@domain/match-settings.types';
import { ValveBackupPlayer } from '../backup/round-backup.service';

export class SandboxPlayerDto {
  steamId!: string;
  name!: string;
  side!: 'CT' | 'T';
  teamLogical?: 'home' | 'away';
  cash?: number;
  kills?: number;
  assists?: number;
  deaths?: number;
  score?: number;
}

export class InjectStateDto {
  matchId!: string;
  serverId?: string;
  phase?: MatchPhase;
  roundPhase?: RoundPhase;
  score?: { ct: number; t: number; home?: number; away?: number; round?: number };
  sides?: { home: 'CT' | 'T'; away: 'CT' | 'T' };
  teams?: { home_name?: string; away_name?: string; home_id?: string; away_id?: string };
  halftimePlayed?: boolean;
  overtimeCount?: number;
  lastScoredRound?: number;
  settings?: Partial<MatchSettings>;
  players?: SandboxPlayerDto[];
}

export class InGameRestoreDto {
  serverId!: string;
  matchId!: string;
  /** Round de la sauvegarde (calculé automatiquement depuis scoreCt + scoreT si omis) */
  round?: number;
  phase?: MatchPhase;
  scoreTeam1?: number;
  scoreTeam2?: number;
  scoreCt?: number;
  scoreT?: number;
  team1Name?: string;
  team2Name?: string;
  map?: string;
  firstHalfScore?: { team1: number; team2: number };
  secondHalfScore?: { team1: number; team2: number };
  overtimeScore?: { team1: number; team2: number; overtimeId?: number };
  playersTeam1?: ValveBackupPlayer[];
  playersTeam2?: ValveBackupPlayer[];
  playersCt?: ValveBackupPlayer[];
  playersT?: ValveBackupPlayer[];
  backupFileName?: string;
  applyViaRcon?: boolean;
  reloadMap?: boolean;
}

export class ReplayRawLogDto {
  matchId?: string;
  serverId?: string;
  fixtureName?: string;
  content?: string;
  speed?: 'instant' | 'fast' | 'realtime';
  maxLines?: number;
}

export class ReplayScenarioDto {
  matchId?: string;
  serverId?: string;
  fixtureName?: string;
  events?: any[];
  speed?: 'instant' | 'fast' | 'realtime';
}

/** Démarre un replay round par round (log brut ou scénario JSON, fixture ou contenu fourni). */
export class StartRoundReplayDto {
  matchId?: string;
  serverId?: string;
  fixtureName?: string;
  /** Log brut fourni directement */
  content?: string;
  /** Scénario fourni directement */
  events?: any[];
}

/** next / prev : un round ; goto : aller au round `round` (0 = avant le 1er round). */
export class StepRoundReplayDto {
  matchId?: string;
  action!: 'next' | 'prev' | 'goto';
  round?: number;
}

export interface AvailableFixture {
  id: string;
  name: string;
  type: 'raw-log' | 'scenario';
  sizeBytes?: number;
  eventsCount?: number;
  description: string;
}
