// src/domain/rules/warmup.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/events/command.event';
import { MatchPhase } from '@domain/phase.types';
import { MessageMode, SaySpec } from '../messages/messages.types';
import { ReadyCommand } from '@app/match/commands/ready.command'; // Import de la commande
import { CS2_RULES, CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';

export class WarmupRule extends BaseRule implements PhaseRule {
  name = 'warmup_rule' as const;

  publicTypes = new Set<string>([
    'match:state',
    'pause:update',
  ]) as any;

  constructor(private readonly readyCmd: ReadyCommand) {
    super();
    this.commands.set(CS2_CHAT_COMMANDS.READY, this.onReadyCommand.bind(this));
    this.commands.set(CS2_CHAT_COMMANDS.NOTREADY, this.onNotReadyCommand.bind(this));
    this.commands.set(CS2_CHAT_COMMANDS.UNREADY, this.onNotReadyCommand.bind(this));
  }

  async onEnter(ctx: RuleContext) {
    await ctx.say('[Warmup] Tapez !ready quand vous êtes prêts.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  private async onReadyCommand(cmd: CommandEvent, ctx: RuleContext) {
    const success = await this.readyCmd.handle(cmd, ctx);

    if (success) {
      if (await ctx.orch.isBothReady(ctx.matchId)) {
        const currentPhase = await ctx.orch.getPhase(cmd.matchId);
        const targetPhase =
          currentPhase === MatchPhase.KNIFE_WARMUP
            ? MatchPhase.KNIFE_LIVE
            : MatchPhase.LIVE_MAIN;

        await ctx.say('Les deux équipes sont prêtes ! Lancement du décompte.');
        await ctx.orch.startPhaseCountdown(cmd.matchId, targetPhase, CS2_RULES.COUNTDOWN_DELAY_SEC, cmd.serverId ?? '');
      }
    }
  }

  // Nouvelle version qui délègue à la commande pour !unready
  private async onNotReadyCommand(cmd: CommandEvent, ctx: RuleContext) {
    // La logique est gérée par la commande ready.command.ts
    await this.readyCmd.handle(cmd, ctx);
  }

  async say(rct: RuleContext): Promise<SaySpec> {
    const state = await rct.state.getSnapshot(rct.matchId);
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
          'La GG-Lan est entièrement financée par vos participations ! Merci à vous !',
          'Presque dix ans que la GG-Lan existe !',
          "Nous avons eu le plaisir d'accueillir Croissant Strike à la 17ème édition",
        ],
      },
    ];
  }
}
