// src/application/match/commands/admin-call.command.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';
import { GameSide } from '@domain/side.types';
import { AdminCallService } from '../admin-call/admin-call.service';

@Injectable()
export class AdminCallCommand extends BaseCommand {
  private readonly logger = new Logger(AdminCallCommand.name);

  constructor(private readonly adminCallService: AdminCallService) {
    super();
  }

  canHandle(event: CommandEvent, _ctx: RuleContext): Promise<boolean> {
    const cmd = event.payload?.command;
    const handles =
      cmd === CS2_CHAT_COMMANDS.ADMIN ||
      cmd === CS2_CHAT_COMMANDS.CALLADMIN ||
      cmd === CS2_CHAT_COMMANDS.ARBITRE;
    return Promise.resolve(handles);
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const sender = event.payload?.sender;
    const matchId = event.matchId;
    const serverId = event.serverId ?? '';
    const params = event.payload?.parameters ?? [];

    const side = sender?.team as GameSide;
    const who = sender?.name ?? 'Joueur';
    const steamId = sender?.steamId ?? undefined;

    const team = (await ctx.orch.sideToLogical(matchId, side)) ?? 'home';
    const message = params.map(String).join(' ').trim();

    await this.adminCallService.createCall(matchId, serverId, {
      team,
      player: { name: who, steamId },
      message,
    });

    return true;
  }
}
