// src/domain/rules/knife-choice.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/types/command.event';
import { MatchPhase } from '@domain/phase.types';

export class KnifeChoiceRule extends BaseRule implements PhaseRule {
  name = 'knife_choice' as const;

  // côté front, seuls ces messages ont du sens ici
  publicTypes = new Set<string>([
    'match:state',
    'pause:update',
  ]) as any;

  constructor() {
    super();
    this.commands.set('stay', this.onStay.bind(this));
    this.commands.set('switch', this.onSwitch.bind(this));
    this.commands.set('swap', this.onSwitch.bind(this));
  }

  // === Lifecycle ============================================================
  async onEnter(ctx: RuleContext) {
    // Annonce utilisateur
    await ctx.say('[knife] Choix du vainqueur: tapez !stay pour garder vos sides, !switch pour échanger.');
    await ctx.ws.push(ctx.matchId, 'match:state', await ctx.matchStateService.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  // === Commands =============================================================
  private async onStay(cmd: CommandEvent, ctx: RuleContext) {
    const knife = await ctx.matchStateService.getKnifeResult(cmd.matchId);
    if (!knife) return ctx.say('[knife] Pas de résultat.');

    // seul le vainqueur peut choisir
    if (cmd.payload.sender.team !== knife.side) return;

    const serverId = cmd.serverId ?? (await ctx.matchStateService.getServerIdFromMatchId(cmd.matchId));

    await ctx.say('[knife] Choix: STAY. Passage au live…');
    // Lance le live avec un petit compte à rebours (ex: 5s)
    await ctx.phase.startPhaseCountdown(cmd.matchId, MatchPhase.LIVE_MAIN, 5, serverId);

    await ctx.ws.push(cmd.matchId, 'match:state', await ctx.matchStateService.getSnapshot(cmd.matchId));
    await ctx.pubEvent('knife_choice', { choice: 'stay', by: cmd.payload.sender.name });
  }

  private async onSwitch(cmd: CommandEvent, ctx: RuleContext) {
    const knife = await ctx.matchStateService.getKnifeResult(cmd.matchId);
    if (!knife) return ctx.say('[knife] Pas de résultat.');

    if (cmd.payload.sender.team !== knife.side) return;

    const serverId = cmd.serverId ?? (await ctx.matchStateService.getServerIdFromMatchId(cmd.matchId));

    // swap des sides (Redis + projection)
    const swapped = await ctx.matchStateService.swapSides(cmd.matchId);
    if (swapped) {
      await ctx.ws.push(cmd.matchId, 'sides:swapped', {});
    }

    await ctx.say('[knife] Choix: SWITCH. Passage au live…');
    await ctx.phase.startPhaseCountdown(cmd.matchId, MatchPhase.LIVE_MAIN, 5, serverId);

    await ctx.ws.push(cmd.matchId, 'match:state', await ctx.matchStateService.getSnapshot(cmd.matchId));
    await ctx.pubEvent('knife_choice', { choice: 'switch', by: cmd.payload.sender.name });
  }
}
