// application/rules/knife.rule.ts
import { Injectable } from '@nestjs/common';
import { BaseRule, LogicalTeam, PhaseRule, RuleContext} from '@domain/rules';
import { MatchStateService } from '../state/match-state.service';
import { CommandEvent } from '@domain/types/command.event';
import { KillEvent, TeamRoundWinEvent } from '@domain/types/match.event';
export type TeamSide = 'CT'|'T';


type SteamId = string;
type KnifeState = {
  playersHome: Set<SteamId>;
  playersAway: Set<SteamId>;
  deathsHome:  Set<SteamId>;
  deathsAway:  Set<SteamId>;
};

@Injectable()
export class DefaultRule extends BaseRule implements PhaseRule {
  private state = new Map<string, KnifeState>();

  constructor(
    private readonly ms: MatchStateService,
  ){ super(); }

  override async onStart(ctx: RuleContext) {

  }

  override async onKill(ev: KillEvent) {
  }

  override async onRoundEnd(ctx: TeamRoundWinEvent & { winner?: LogicalTeam|null }) {
  }

  // Optionnel: limiter les commandes durant knife (ex: interdire !pause des joueurs)
 override canCommand?(_: CommandEvent): boolean { 
    return true; 
}

  
}
