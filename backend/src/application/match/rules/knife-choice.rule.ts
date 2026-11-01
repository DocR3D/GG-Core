// src/domain/rules/knife-choice.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/events/command.event';
import { MessageMode, SaySpec } from '../messages/messages.types';
import { KnifeChoiceCommand } from '@app/match/commands/knife-choice.command'; // NOUVEAU
import { Injectable } from '@nestjs/common';

@Injectable()
export class KnifeChoiceRule extends BaseRule implements PhaseRule {
  name = 'knife_choice' as const;


  constructor(
    private readonly knifeChoiceCmd: KnifeChoiceCommand // Injection de la commande
  ) {
    super();
    const onCommand = (cmd: CommandEvent, ctx: RuleContext) => this.onCommand(cmd, ctx);
    this.commands.set('stay', onCommand);
    this.commands.set('switch', onCommand);
    this.commands.set('swap', onCommand);
  }

  // === Lifecycle ============================================================
  async onEnter(ctx: RuleContext) {
    await ctx.say('[knife] Choix du vainqueur: tapez !stay pour garder vos sides, !switch pour échanger.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {}

  // === Commands =============================================================
  private async onCommand(cmd: CommandEvent, ctx: RuleContext) {
    await this.knifeChoiceCmd.handle(cmd, ctx);
  }

  async say(rct: RuleContext) : Promise<SaySpec> {
    const state = await rct.state.getSnapshot(rct.matchId);
    const winner = await rct.orch.getKnifeResult(rct.matchId);
    return [
      {
        mode: MessageMode.Chain,
        items: [
          { text: `>>> ${state.teams.home_name} vs ${state.teams.away_name} <<<`, intervalMs: 20_000 },
          { text: `>>> ${winner.team?.name} a remporté le knife round<<<`, intervalMs: 20_000 },
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