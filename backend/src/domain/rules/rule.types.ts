import { MatchPhase } from '@domain/phase.types';
import { CommandEvent } from '@domain/types/command.event';
import { KillEvent, TeamRoundWinEvent } from '@domain/types/match.event';

export type TeamSide = 'CT'|'T';
export type LogicalTeam = 'home'|'away';

export type Command = '!ready'|'!unready'|'!stay'|'!switch'|'!pause'|'!unpause'|'!restart';

export interface RuleContext { matchId: string; phase: MatchPhase; ts: number; }

export interface PhaseRule {
  onStart?(ctx: RuleContext): Promise<void>|void;
  onKill?(ev: KillEvent): Promise<void>|void;
  onRoundStart?(ctx: RuleContext & { roundNumber?: number }): Promise<void>|void;
  onRoundEnd?(ctx: TeamRoundWinEvent): Promise<void>|void;
  onDisconnect?(ctx: RuleContext & { steamId: string }): Promise<void>|void;
  onStop?(ctx: RuleContext): Promise<void>|void;
  canCommand?(cmd: CommandEvent): boolean;
  onCommandExecuted?(command: CommandEvent): Promise<void>|void;
}
