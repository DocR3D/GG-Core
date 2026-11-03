// src/application/match/commands/info.command.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';
import { GameSide } from '@domain/side.types';
import { PauseMatchService } from '../pause/pause.service';

@Injectable()
export class InfoCommand extends BaseCommand {
  private readonly logger = new Logger(InfoCommand.name);

  constructor(private readonly pauseService: PauseMatchService) {
    super();
  }

  canHandle(event: CommandEvent, _ctx: RuleContext): Promise<boolean> {
    const cmd = event.payload?.command;
    const handles =
      cmd === CS2_CHAT_COMMANDS.HELP ||
      cmd === CS2_CHAT_COMMANDS.COMMANDS ||
      cmd === CS2_CHAT_COMMANDS.AIDE ||
      cmd === CS2_CHAT_COMMANDS.PAUSES ||
      cmd === CS2_CHAT_COMMANDS.SCORE;
    return Promise.resolve(handles);
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const cmd = event.payload?.command;
    const sender = event.payload?.sender;
    const matchId = event.matchId;
    const side = sender?.team as GameSide;

    // 1) Commande !pauses
    if (cmd === CS2_CHAT_COMMANDS.PAUSES) {
      const team = (await ctx.orch.sideToLogical(matchId, side)) ?? 'home';
      const bank = await this.pauseService.getTacBank(matchId, team);
      await ctx.say(`[GG-Core] Temps de pause tactique restant pour votre équipe : ${bank} secondes.`);
      return true;
    }

    // 2) Commande !score
    if (cmd === CS2_CHAT_COMMANDS.SCORE) {
      const snap = await ctx.state.getSnapshot(matchId);
      const ct = snap?.score?.ct ?? 0;
      const t = snap?.score?.t ?? 0;
      const round = snap?.score?.round ?? 0;
      await ctx.say(`[GG-Core] Score : CT ${ct} - ${t} T (Round ${round})`);
      return true;
    }

    // 3) Commande !help / !commands / !aide
    const snap = await ctx.state.getSnapshot(matchId);
    const phase = snap?.phase ?? 'live_main';

    if (phase.includes('warmup') || phase === 'halftime') {
      await ctx.say('[GG-Core] Commandes Warmup : !ready, !unready, !admin <message>');
    } else if (phase === 'knife_choice') {
      await ctx.say('[GG-Core] Choix de camp : !stay, !switch, !ct, !t, !admin <message>');
    } else {
      await ctx.say(
        '[GG-Core] Commandes Live : !pause, !tech [raison], !unpause, !backup, !restore [num], !pauses, !score, !admin <message>',
      );
    }

    return true;
  }
}
