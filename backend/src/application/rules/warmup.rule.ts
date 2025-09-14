// src/domain/rules/knife-choice.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/types/command.event';
import { MatchPhase } from '@domain/phase.types';

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
    await ctx.ws.push(ctx.matchId, 'match:state', await ctx.matchStateService.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  // === Commands =============================================================
  private async onReady(cmd: CommandEvent, ctx: RuleContext) {
    if(cmd.payload.sender.team == 'CT' || cmd.payload.sender.team == 'T' ){
      let team = await ctx.matchStateService.sideToLogical(ctx.matchId, cmd.payload.sender.team);
      if(team) ctx.phase.setReady(ctx.matchId,team, true);
      if(await ctx.phase.isBothReady(ctx.matchId)){
        await ctx.phase.startPhaseCountdown(cmd.matchId, MatchPhase.KNIFE_LIVE, 5, ctx.serverId);
      }
    }
  }

  private async onNotReady(cmd: CommandEvent, ctx: RuleContext) {
    if(cmd.payload.sender.team == 'CT' || cmd.payload.sender.team == 'T' ){
      let team = await ctx.matchStateService.sideToLogical(ctx.matchId, cmd.payload.sender.team);
      if(team) ctx.phase.setReady(ctx.matchId,team, false);
    }
  }
}
