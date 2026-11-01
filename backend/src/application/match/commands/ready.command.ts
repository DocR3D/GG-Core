// src/application/match/commands/ready.command.ts

import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { isNonPlayingSide, GameSide } from '@domain/side.types';
import { CS2_CHAT_COMMANDS, normalizeChatCommand } from '@domain/rules/rules.constants';

@Injectable()
export class ReadyCommand extends BaseCommand {
  private readonly logger = new Logger(ReadyCommand.name);

  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const sender = event.payload.sender;

    if (isNonPlayingSide(sender.team)) {
      await ctx.say('Vous devez être dans une équipe pour utiliser cette commande.');
      return false;
    }

    const clean = normalizeChatCommand(event.payload.command);
    const isReadyCommand = clean === CS2_CHAT_COMMANDS.READY;
    const isUnreadyCommand = clean === CS2_CHAT_COMMANDS.UNREADY || clean === CS2_CHAT_COMMANDS.NOTREADY;

    if (!isReadyCommand && !isUnreadyCommand) {
      return false;
    }

    const team = await ctx.orch.sideToLogical(event.matchId, sender.team as GameSide);
    return !!team;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const sender = event.payload.sender;
    if(isNonPlayingSide(sender.team)) {
        this.logger.debug('Vous devez être dans une équipe pour utiliser cette commande.');
        return false;
    }
    const team = await ctx.orch.sideToLogical(event.matchId, sender.team as GameSide);
    
    // Si la validation canHandle a échoué, on arrête ici
    if (!team) return false;

    const clean = normalizeChatCommand(event.payload.command);
    const isReady = clean === CS2_CHAT_COMMANDS.READY;

    this.logCommand(isReady ? '!ready' : '!unready', event);

    await ctx.orch.setReady(event.matchId, team, isReady);

    if (isReady) {
      await ctx.say(`[GG] ${sender.name} est maintenant prêt !`);
    } else {
      await ctx.say(`[GG] ${sender.name} n'est plus prêt.`);
    }

    return true;
  }
}