// application/rules/knife.rule.ts
import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BaseRule, LogicalTeam, PhaseRule, RuleContext} from '@domain/rules';
import { MatchStateService } from '../state/match-state.service';
import { CommandEvent } from '@domain/types/command.event';
import { KillEvent, PlayerRefLogs, TeamRoundWinEvent } from '@domain/types/match.event';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchPhaseService } from '@app/phase/match-phase.service';
import { Logical} from '@app/state/sides-score.service';
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
export class KnifeRule extends BaseRule implements PhaseRule {
  private state = new Map<string, KnifeState>();
  private readonly logger = new Logger(KnifeRule.name);

  constructor(
  private readonly mss: MatchStateService,
  @Inject(actionsPort.ACTIONS_PORT) private readonly mps: actionsPort.ActionsPort,
  @Inject(forwardRef(() => MatchPhaseService)) private readonly phases: MatchPhaseService, // ✅
  private readonly mcs: MatchCommandsService,
  ) {super(); 

      console.log('>>> KnifeRule constructed OK');
  }

  override async onStart(ctx: RuleContext) {
    const rosters = await this.mss.getPlayers(ctx.matchId);
    this.state.set(ctx.matchId, {
      playersHome: new Set((rosters.home||[]).map(p=>p.steamId).filter(Boolean)),
      playersAway: new Set((rosters.away||[]).map(p=>p.steamId).filter(Boolean)),
      deathsHome: new Set(),
      deathsAway: new Set(),
    });
    let serverId = await this.mss.getServerIdFromMatchId(ctx.matchId);
    if (!serverId) {
      throw new BadRequestException(`Aucun serveur lié au match ${ctx.matchId}`);
    }
    this.mcs.exec({
      serverId,
      matchId: ctx.matchId,
      cfgName: "ggbot/knife.cfg"
    });
  }

  override async onKill(ev: KillEvent) {
    let killed : PlayerRefLogs;

    switch (ev.payload.kind) {
      case 'player':
      case 'world':
        killed = ev.payload.victim;
        break;
      case 'suicide':
        killed = ev.payload.player; // ici player == victim
        break;
    }
    
    const st = this.state.get(ev.matchId); 
    if (!st) return;
    const logical = await this.mss.sideToLogical(ev.matchId, killed.team);
    if (logical === 'home') st.deathsHome.add(!killed.steamId || killed.steamId.toLowerCase().startsWith("bot") ? killed.name : killed.steamId );
    else if (logical === 'away') st.deathsAway.add(!killed.steamId ||killed.steamId.toLowerCase().startsWith("bot") ? killed.name : killed.steamId );
    this.logger.debug(killed.name +" et " + killed.steamId+ " "+logical+"is dead home = " +st.deathsHome.size + " away = " + st.deathsAway.size);

}

  override async onRoundEnd(ctx: TeamRoundWinEvent) {
    const st = this.state.get(ctx.matchId); if (!st) return;
    let winner: Logical = st.deathsAway.size > st.deathsHome.size ? 'home' : 'away' ;
    let serverId = await this.mss.getServerIdFromMatchId(ctx.matchId);
    if (!serverId) {
      throw new BadRequestException(`Aucun serveur lié au match ${ctx.matchId}`);
    }
    let TeamWinner = await this.mss.logicalToSide(ctx.matchId, winner)
    this.mcs.say({serverId, message: "Le gagnant est : "+ TeamWinner });
    this.mss.applyKnifeResult(ctx.matchId, ctx.payload.winner)
    this.mcs.exec({
      serverId,
      matchId: ctx.matchId,
      cfgName: "ggbot/knife_undo.cfg"
    });
    this.phases.startPhaseCountdown(ctx.matchId, MatchPhase.KNIFE_CHOICE,0);
  }

  // Optionnel: limiter les commandes durant knife (ex: interdire !pause des joueurs)
 override canCommand?(_: CommandEvent): boolean {
   return true;
  }

  

  
}
