// src/domain/rules/knife-choice.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/types/command.event';
import { MatchPhase } from '@domain/phase.types';
import { MessageMode, SaySpec } from '../messages/messages.types';

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
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  // === Commands =============================================================
  private async onStay(cmd: CommandEvent, ctx: RuleContext) {
    const knife = await ctx.orch.getKnifeResult(cmd.matchId);
    if (!knife) return ctx.say('[knife] Pas de résultat.');

    // seul le vainqueur peut choisir
    if (cmd.payload.sender.team !== knife.side) return;

    const serverId = cmd.serverId ?? (await ctx.state.getServerIdFromMatchId(cmd.matchId));

    await ctx.say('[knife] Choix: STAY. Passage au live…');
    // Lance le live avec un petit compte à rebours (ex: 5s)
    await ctx.orch.startPhaseCountdown(cmd.matchId, MatchPhase.LIVE_MAIN, 5, serverId);

    await ctx.orch.push(cmd.matchId, 'match:state', await ctx.state.getSnapshot(cmd.matchId));
    await ctx.pubEvent('knife_choice', { choice: 'stay', by: cmd.payload.sender.name });
  }

  private async onSwitch(cmd: CommandEvent, ctx: RuleContext) {
    const knife = await ctx.orch.getKnifeResult(cmd.matchId);
    if (!knife) return ctx.say('[knife] Pas de résultat.');

    if (cmd.payload.sender.team !== knife.side) return;

    const serverId = cmd.serverId ?? (await ctx.state.getServerIdFromMatchId(cmd.matchId));

    // swap des sides (Redis + projection)
    const swapped = await ctx.orch.swapSides(cmd.matchId);
    if (swapped) {
      await ctx.orch.push(cmd.matchId, 'sides:swapped', {});
    }

    await ctx.say('[knife] Choix: SWITCH. Passage au live…');
    await ctx.orch.startPhaseCountdown(cmd.matchId, MatchPhase.LIVE_MAIN, 5, serverId);

    await ctx.orch.push(cmd.matchId, 'match:state', await ctx.state.getSnapshot(cmd.matchId));
    await ctx.pubEvent('knife_choice', { choice: 'switch', by: cmd.payload.sender.name });
  }

  say() : SaySpec {
    let a = "Equipe A"
    return [
      {
        mode: MessageMode.Chain,
        items: [
          { text: `>>> ${a} vs Équipe B <<<`, intervalMs: 20_000 },
          { text: 'Tapez !switch si vous voulez swap et !stay sinon.', intervalMs: 20_000 },
        ],
      },
    ];
  }

}
