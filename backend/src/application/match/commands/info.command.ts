// src/application/match/commands/info.command.ts
import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TournamentConfigService } from '@app/config/tournament-config.service';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';
import { GameSide } from '@domain/side.types';
import { PauseMatchService } from '../pause/pause.service';

@Injectable()
export class InfoCommand extends BaseCommand {
  private readonly logger = new Logger(InfoCommand.name);

  constructor(
    @Inject(forwardRef(() => PauseMatchService))
    private readonly pauseService: PauseMatchService,
    @Optional() private readonly configService?: TournamentConfigService,
  ) {
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
      const msg = this.configService
        ? await this.configService.formatMessage(matchId, 'INFO_PAUSES_REMAINING', { bank })
        : `[GG-Core] Temps de pause tactique restant pour votre équipe : ${bank} secondes.`;
      await ctx.say(msg);
      return true;
    }

    // 2) Commande !score
    if (cmd === CS2_CHAT_COMMANDS.SCORE) {
      const snap = await ctx.state.getSnapshot(matchId);
      const ct = snap?.score?.ct ?? 0;
      const t = snap?.score?.t ?? 0;
      const round = snap?.score?.round ?? 0;
      const msg = this.configService
        ? await this.configService.formatMessage(matchId, 'INFO_SCORE', { ct, t, round })
        : `[GG-Core] Score : CT ${ct} - ${t} T (Round ${round})`;
      await ctx.say(msg);
      return true;
    }

    // 3) Commande !help / !commands / !aide
    const snap = await ctx.state.getSnapshot(matchId);
    const phase = snap?.phase ?? 'live_main';

    if (phase.includes('warmup') || phase === 'halftime') {
      const msg = this.configService
        ? await this.configService.formatMessage(matchId, 'INFO_WARMUP_COMMANDS')
        : '[GG-Core] Commandes Warmup : !ready, !unready, !admin <message>';
      await ctx.say(msg);
    } else if (phase === 'knife_choice') {
      const msg = this.configService
        ? await this.configService.formatMessage(matchId, 'INFO_KNIFE_CHOICE_COMMANDS')
        : '[GG-Core] Choix de camp : !stay, !switch, !ct, !t, !admin <message>';
      await ctx.say(msg);
    } else {
      const msg = this.configService
        ? await this.configService.formatMessage(matchId, 'INFO_LIVE_COMMANDS')
        : '[GG-Core] Commandes Live : !pause, !tech [raison], !unpause, !backup, !restore [num], !pauses, !score, !admin <message>';
      await ctx.say(msg);
    }

    return true;
  }
}
