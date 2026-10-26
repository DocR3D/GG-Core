// src/application/match/commands/knife-choice.command.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { MatchPhase } from '@domain/phase.types';
import { CS2_RULES, CS2_CHAT_COMMANDS, CS2_RCON_COMMANDS, normalizeChatCommand } from '@domain/rules/rules.constants';

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
    const cleanCmd = normalizeChatCommand(event.payload.command);
    const isStay = cleanCmd === CS2_CHAT_COMMANDS.STAY;
    this.logCommand(isStay ? '!stay' : '!switch', event);

    const serverId = event.serverId ?? (await ctx.state.getServerIdFromMatchId(event.matchId));
    if (!serverId) {
      this.logger.error(`Impossible de trouver le serveur pour le match ${event.matchId}`);
      return false;
    }

    if (!isStay) {
      if (serverId && typeof ctx.orch.rcon === 'function') {
        await ctx.orch.rcon({ serverId, matchId: event.matchId, command: CS2_RCON_COMMANDS.SWAP_TEAMS });
      }
      const swapped = await ctx.orch.swapSides(event.matchId);
      if (swapped) {
        await ctx.orch.push(event.matchId, 'sides:swapped' as any, {});
      }
    }

    const choice = isStay ? 'stay' : 'switch';
    await ctx.pubEvent('knife_choice', { choice, by: event.payload.sender.name });

    const settings = await ctx.state.getSettings(event.matchId);
    if (settings.warmupAfterKnife) {
      await ctx.say(
        `[knife] Choix: ${isStay ? 'STAY' : 'SWITCH'}. Passage en échauffement tactique. Tapez !ready quand vous êtes prêts.`,
      );
      await ctx.orch.setPhase(event.matchId, MatchPhase.WARMUP_MAIN);
    } else {
      await ctx.say(`[knife] Choix: ${isStay ? 'STAY' : 'SWITCH'}. Lancement du match…`);
      await ctx.orch.startPhaseCountdown(event.matchId, MatchPhase.LIVE_MAIN, CS2_RULES.COUNTDOWN_DELAY_SEC, serverId);
    }

    await ctx.orch.push(event.matchId, 'match:state', await ctx.state.getSnapshot(event.matchId));
    return true;
  }
}
