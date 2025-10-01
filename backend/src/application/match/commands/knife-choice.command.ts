// src/application/match/commands/knife-choice.command.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { MatchPhase } from '@domain/phase.types';
import { GameSide } from '@app/match/state';

@Injectable()
export class KnifeChoiceCommand extends BaseCommand {
  private readonly logger = new Logger(KnifeChoiceCommand.name);

  constructor() {
    super();
  }

  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const knife = await ctx.orch.getKnifeResult(event.matchId);

    // Vérifie si le joueur qui envoie la commande est bien le vainqueur du knife round.
    if (!knife || event.payload.sender.team !== knife.side) {
      await ctx.say('[knife] Seul le vainqueur du knife round peut choisir son camp.');
      return false;
    }
    return true;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isStay = event.payload.command === 'stay';
    this.logCommand(isStay ? '!stay' : '!switch', event);

    const serverId = event.serverId ?? (await ctx.state.getServerIdFromMatchId(event.matchId));
    if (!serverId) {
      this.logger.error(`Impossible de trouver le serveur pour le match ${event.matchId}`);
      return false;
    }

    if (isStay) {
      // Logique pour !stay
      await ctx.say('[knife] Choix: STAY. Passage au live…');
      await ctx.orch.startPhaseCountdown(event.matchId, MatchPhase.LIVE_MAIN, 5, serverId);
      await ctx.pubEvent('knife_choice', { choice: 'stay', by: event.payload.sender.name });
    } else {
      // Logique pour !switch
      const swapped = await ctx.orch.swapSides(event.matchId);
      if (swapped) {
        await ctx.orch.push(event.matchId, 'sides:swapped', {});
      }
      await ctx.say('[knife] Choix: SWITCH. Passage au live…');
      await ctx.orch.startPhaseCountdown(event.matchId, MatchPhase.LIVE_MAIN, 5, serverId);
      await ctx.pubEvent('knife_choice', { choice: 'switch', by: event.payload.sender.name });
    }

    await ctx.orch.push(event.matchId, 'match:state', await ctx.state.getSnapshot(event.matchId));
    return true;
  }
}