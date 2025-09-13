import { KillEvent, TeamRoundWinEvent } from '@domain/types/match.event';
import { PhaseRule, RuleContext,} from './rule.types';
import { CommandEvent } from '@domain/types/command.event';


export abstract class BaseRule implements PhaseRule {
  onStart?(_: RuleContext): void {}
  onKill?(_: KillEvent): void {}
  onRoundStart?(_: RuleContext & { roundNumber?: number }): void {}
  onRoundEnd?(_: TeamRoundWinEvent): void {}
  onDisconnect?(_: RuleContext & { steamId: string }): void {}
  onStop?(_: RuleContext): void {}
  canCommand?(_: CommandEvent): boolean { return true; }
  onCommandExecuted?(__: CommandEvent): void {}
}
