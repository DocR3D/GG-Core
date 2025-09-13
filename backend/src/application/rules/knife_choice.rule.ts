// application/rules/knife.rule.ts
import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BaseRule, LogicalTeam, PhaseRule, RuleContext} from '@domain/rules';
import { MatchStateService } from '../state/match-state.service';
import { CommandEvent } from '@domain/types/command.event';
import { KillEvent, PlayerRefLogs, TeamRoundWinEvent } from '@domain/types/match.event';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchPhaseService } from '@app/phase/match-phase.service';
import * as actionsPort from '@app/ports/actions.port';
import { MatchPhase } from '@domain/phase.types';
export type TeamSide = 'CT'|'T';


type SteamId = string;
type KnifeState = {
  playersHome: Set<SteamId>;
  playersAway: Set<SteamId>;
  deathsHome:  Set<SteamId>;
  deathsAway:  Set<SteamId>;
};

@Injectable()
export class KnifeChoiceRule extends BaseRule implements PhaseRule {
  private state = new Map<string, KnifeState>();
  private readonly logger = new Logger(KnifeChoiceRule.name);

  constructor(
    private readonly mss: MatchStateService,
    @Inject(actionsPort.ACTIONS_PORT) private readonly mps: actionsPort.ActionsPort,
    // Si tu envoies les actions directement via le service concret :
    private readonly mcs: MatchCommandsService,
    @Inject(forwardRef(() => MatchPhaseService)) private readonly phases: MatchPhaseService, // ✅

    // Si tu préfères le port : @Inject(ACTIONS_PORT) private readonly actions: ActionsPort,
  ) {super(); }

  override async onStart(ctx: RuleContext) {
    let serverId = await this.mss.getServerIdFromMatchId(ctx.matchId);
    if (!serverId) {
      throw new BadRequestException(`Aucun serveur lié au match ${ctx.matchId}`);
    }
    this.mcs.exec({
      serverId,
      matchId: ctx.matchId, 
      cfgName: "ggbot/warmup.cfg"
    });
  }

  override async onKill(ev: KillEvent) {

  }

  override async onRoundEnd(ctx: TeamRoundWinEvent) {
    const st = this.state.get(ctx.matchId); if (!st) return;
  }

  // Optionnel: limiter les commandes durant knife (ex: interdire !pause des joueurs)
 override canCommand?(_: CommandEvent): boolean {
   return true;
  }
  override async onCommandExecuted(command: CommandEvent) {
        const knifeWinner = await this.mss.getKnifeResult(command.matchId);

    this.logger.debug("OnCommandCalled : " + command.payload.command + "From" +(command.payload.sender.team != knifeWinner.side) )
    if(command.payload.sender.team != knifeWinner.side) return;
    if(command.payload.command == "stay"){

    }else if (command.payload.command == "swap"){
      this.mss.swapSides(command.matchId);
      this.mps.swapSides({matchId:command.matchId});
    }else{
      return;
    }
    this.phases.startPhaseCountdown(command.matchId, MatchPhase.LIVE_MAIN,7,command.serverId);
  }

  
}
