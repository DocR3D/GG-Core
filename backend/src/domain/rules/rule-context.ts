// src/domain/rules/rule-context.ts
// What a phase rule may use: the orchestrator's commands and the match state, described here with domain types
// only (the domain does not import the application). The application's MatchOrchestrator / MatchStateService
// satisfy these interfaces structurally (RuleContextFactory): a rule calling a method that does not exist, or with
// wrong arguments, does not compile.

import type { MatchPhase, Phase } from '../phase.types';
import type { GameSide } from '../side.types';
import type { MatchSettings } from '../match-settings.types';

export type LogicalTeam = 'home' | 'away';
type Target = { serverId: string; matchId: string };

/** The parts of the match snapshot the rules read (the full snapshot is built by the application). */
export interface RuleSnapshot {
  phase: Phase | string | null;
  score: { ct: number; t: number; round: number };
  sides: { home: GameSide; away: GameSide } | null;
  teams: { home_id: string | null; away_id: string | null; home_name: string | null; away_name: string | null };
  /** forwarded as is to the WebSocket (score:update) */
  economy?: unknown;
  streaks?: unknown;
}

export interface KnifeResult {
  side: GameSide | null;
  logical: LogicalTeam | null;
  team: { id: string | null; name: string | null } | null;
}

export interface IRuleContextOrchestrator {
  /** WebSocket push (event type: see the adapters' WsEventType) */
  push(matchId: string, eventType: string, payload: unknown): Promise<void>;
  execCfg(target: Target, cfgName: string): Promise<unknown>;
  rcon(target: Target & { command: string }): Promise<unknown>;
  restartGame(target: Target & { delay: number }): Promise<unknown>;
  setPhase(matchId: string, phase: Phase): Promise<unknown>;
  getPhase(matchId: string): Promise<Phase | null>;
  swapSides(matchId: string): Promise<unknown>;
  roundEnd(matchId: string, winner: GameSide): Promise<unknown>;
  endMatch(matchId: string, winnerSide: GameSide | null, ctx: RuleContext): Promise<unknown>;
  applyKnifeResult(matchId: string, winnerSide: 'CT' | 'T'): Promise<unknown>;
  getKnifeResult(matchId: string): Promise<KnifeResult>;
  startPhaseCountdown(matchId: string, nextPhase: MatchPhase, seconds: number, serverId: string): Promise<unknown>;
  isCountdownActive(matchId: string): Promise<boolean>;
  sideToLogical(matchId: string, side: GameSide): Promise<LogicalTeam | null>;
  logicalToSide(matchId: string, logical: LogicalTeam): Promise<GameSide | null>;
  isBothReady(matchId: string): Promise<boolean>;
  setReady(matchId: string, team: LogicalTeam, ready: boolean): Promise<unknown>;
  resetReady(matchId: string): Promise<void>;
  checkTeamPlacement(matchId: string, serverId: string): Promise<boolean>;
  startWarmup(serverId: string): void;
}

export interface IRuleContextState {
  getSnapshot(matchId: string): Promise<RuleSnapshot>;
  getScore(matchId: string): Promise<{ ct: number; t: number; round: number }>;
  getServerIdFromMatchId(matchId: string): Promise<string | undefined>;
  getMatchIdFromServerId(serverId: string): Promise<string | undefined>;
  getPlayers(matchId: string): Promise<{ home: { steamId: string; name?: string }[]; away: { steamId: string; name?: string }[] }>;
  getSettings(matchId: string): Promise<Required<MatchSettings>>;
  setSettings(matchId: string, settings: Partial<MatchSettings>): Promise<void>;
  getLastScoredRound(matchId: string): Promise<number>;
  setLastScoredRound(matchId: string, round: number): Promise<void>;
  isHalftimePlayed(matchId: string): Promise<boolean>;
  setHalftimePlayed(matchId: string, played: boolean): Promise<void>;
  getOvertimeCount(matchId: string): Promise<number>;
  setOvertimeCount(matchId: string, count: number): Promise<void>;
  reconcileScore(matchId: string, ct: number, t: number): Promise<unknown>;
}

export type RuleContext = {
  matchId: string;
  serverId?: string;
  orch: IRuleContextOrchestrator;
  state: IRuleContextState;
  say: (msg: string) => Promise<void>;
  pubEvent: (type: string, payload: unknown) => Promise<void>;
};
