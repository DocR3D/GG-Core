// src/domain/rules/knife-choice.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/types/command.event';
import { MatchPhase } from '@domain/phase.types';
import { MessageMode, SaySpec } from '../messages/messages.types';

export class WarmupRule extends BaseRule implements PhaseRule {

  // côté front, seuls ces messages ont du sens ici
  publicTypes = new Set<string>([
    'match:state',
    'pause:update',
  ]) as any;

  constructor() {
    super();
    this.commands.set('ready', this.onReady.bind(this));
    this.commands.set('notready', this.onNotReady.bind(this));
  }

  // === Lifecycle ============================================================
  async onEnter(ctx: RuleContext) {
    // Annonce utilisateur
    await ctx.say('[knife] Choix du vainqueur: tapez !stay pour garder vos sides, !switch pour échanger.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  // === Commands =============================================================
  private async onReady(cmd: CommandEvent, ctx: RuleContext) {
    if(cmd.payload.sender.team == 'CT' || cmd.payload.sender.team == 'T' ){
      let team = await ctx.orch.sideToLogical(ctx.matchId, cmd.payload.sender.team);
      if(team){
        ctx.orch.setReady(ctx.matchId,team, true);
        ctx.say(`${team} is now ready !`);
      }      
      if(await ctx.orch.isBothReady(ctx.matchId)){
        await ctx.orch.startPhaseCountdown(cmd.matchId, MatchPhase.KNIFE_LIVE, 5, cmd.serverId);
      }
    }
  }

  private async onNotReady(cmd: CommandEvent, ctx: RuleContext) {
    if(cmd.payload.sender.team == 'CT' || cmd.payload.sender.team == 'T' ){
      let team = await ctx.orch.sideToLogical(ctx.matchId, cmd.payload.sender.team);
      if(team) ctx.orch.setReady(ctx.matchId,team, false);
    }
  }

  async say(rct: RuleContext) : Promise<SaySpec> {
    let state = await rct.state.getSnapshot(rct.matchId);
    return [
      {
        mode: MessageMode.Chain,
        items: [
          { text: `>>> ${state.teams.home_name} vs ${state.teams.away_name} <<<`, intervalMs: 20_000 },
          { text: 'Tapez !ready quand vous êtes prêts.', intervalMs: 20_000 },
        ],
      },
      {
        mode: MessageMode.Random,
        intervalMs: 60_000,
        items: [
          'La GG-Lan est entierement financé par vos participations ! Merci à vous ! ',
          'Presque dix ans que la GG-Lan existe !',
          'Nous avons eu le plaisir d\'accueillir Croissant Strikeà la 17ême édition',
        ],
      },
    ];
  }
}
