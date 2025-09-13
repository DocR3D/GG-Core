// application/rules/knife.rule.ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { BaseRule, LogicalTeam, PhaseRule, RuleContext} from '@domain/rules';
import { MatchStateService } from '../state/match-state.service';
import { CommandEvent } from '@domain/types/command.event';
import { KillEvent, TeamRoundWinEvent } from '@domain/types/match.event';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import * as actionsPort from '@app/ports/actions.port';
export type TeamSide = 'CT'|'T';


type SteamId = string;

@Injectable()
export class LiveRule extends BaseRule implements PhaseRule {

  constructor(
    private readonly mss: MatchStateService,
    @Inject(actionsPort.ACTIONS_PORT) private readonly mps: actionsPort.ActionsPort,
     // Si tu envoies les actions directement via le service concret :
     private readonly mcs: MatchCommandsService,
  ){ super(); }

  override async onStart(ctx: RuleContext) {
    let serverId = await this.mss.getServerIdFromMatchId(ctx.matchId);
    if (!serverId) {
      throw new BadRequestException(`Aucun serveur lié au match ${ctx.matchId}`);
    }
    this.mcs.rcon({
      serverId,
      matchId:ctx.matchId,
      command:"exec gamemode_competitive.cfg; exec gamemode_competitive_tmm; mp_warmup_end 1"
    })
    this.mcs.restartGame({serverId,matchId:ctx.matchId});
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
