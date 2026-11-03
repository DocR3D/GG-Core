// src/application/match/commands/restore.command.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { RoundRestoreService } from '../restore/round-restore.service';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';
import { GameSide } from '@domain/side.types';

@Injectable()
export class RestoreCommand extends BaseCommand {
  private readonly logger = new Logger(RestoreCommand.name);

  constructor(private readonly restoreService: RoundRestoreService) {
    super();
  }

  canHandle(event: CommandEvent, _ctx: RuleContext): Promise<boolean> {
    const cmd = event.payload?.command;
    const handles =
      cmd === CS2_CHAT_COMMANDS.RESTORE ||
      cmd === CS2_CHAT_COMMANDS.BACKUP ||
      cmd === CS2_CHAT_COMMANDS.BACKUPS ||
      cmd === CS2_CHAT_COMMANDS.CANCEL ||
      cmd === CS2_CHAT_COMMANDS.REFUSE ||
      cmd === CS2_CHAT_COMMANDS.NO;
    return Promise.resolve(handles);
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const cmd = event.payload?.command;
    const sender = event.payload?.sender;
    const matchId = event.matchId;
    const serverId = event.serverId ?? '';
    const params = event.payload?.parameters ?? [];

    const side = sender?.team as GameSide;
    const who = sender?.name ?? 'Joueur';
    const steamId = sender?.steamId ?? undefined;

    // Déterminer home / away
    const team: 'home' | 'away' = (await ctx.orch.sideToLogical(matchId, side)) ?? 'home';

    // 1) Commande d'affichage des checkpoints : !backup ou !backups
    if (cmd === CS2_CHAT_COMMANDS.BACKUP || cmd === CS2_CHAT_COMMANDS.BACKUPS) {
      await this.showCandidates(ctx);
      return true;
    }

    // 2) Commande d'annulation / refus : !cancel, !refuse, !no
    if (cmd === CS2_CHAT_COMMANDS.CANCEL || cmd === CS2_CHAT_COMMANDS.REFUSE || cmd === CS2_CHAT_COMMANDS.NO) {
      await this.restoreService.cancelRestore(matchId, {
        team,
        steamId,
        name: who,
      });
      return true;
    }

    // 3) Commande !restore
    if (cmd === CS2_CHAT_COMMANDS.RESTORE) {
      const firstParam = params[0] ? String(params[0]).trim() : '';

      // Si pas d'argument : afficher les checkpoints
      if (!firstParam) {
        await this.showCandidates(ctx);
        return true;
      }

      // Si l'argument est "cancel" ou "no"
      if (firstParam.toLowerCase() === 'cancel' || firstParam.toLowerCase() === 'no') {
        await this.restoreService.cancelRestore(matchId, {
          team,
          steamId,
          name: who,
        });
        return true;
      }

      // Si c'est un numéro de round
      const targetRound = parseInt(firstParam, 10);
      if (isNaN(targetRound)) {
        await ctx.say(`[GG-Core] Numéro de round invalide : "${firstParam}". Tapez !backup pour voir les rounds.`);
        return false;
      }

      const activeProposal = await this.restoreService.getProposal(matchId);

      // Si une proposition est déjà en cours pour ce même round
      if (activeProposal && activeProposal.targetRound === targetRound) {
        if (activeProposal.proposingTeam !== team) {
          // L'autre équipe confirme la proposition !
          await this.restoreService.confirmRestore(matchId, {
            team,
            steamId,
            name: who,
          });
          return true;
        } else {
          await ctx.say(
            `[GG-Core] Votre proposition pour le round ${targetRound} est déjà active. En attente de l'autre équipe.`,
          );
          return false;
        }
      }

      // Sinon, initier une nouvelle proposition
      try {
        await this.restoreService.proposeRestore(matchId, targetRound, {
          team,
          steamId,
          name: who,
        });
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.say(`[GG-Core] Impossible de restaurer : ${msg}`);
        return false;
      }
    }

    return false;
  }

  private async showCandidates(ctx: RuleContext): Promise<void> {
    const candidates = await this.restoreService.getRestoreCandidates(ctx.matchId);
    if (candidates.length === 0) {
      await ctx.say('[GG-Core] Aucun round jouable à restaurer pour le moment.');
      return;
    }

    await ctx.say('[GG-Core] Checkpoints de rounds disponibles :');
    for (const c of candidates) {
      const statusLabel = c.isCurrent ? ' [En cours]' : '';
      const directLabel = c.canDirectRestore ? '' : ' [Admin requis]';
      await ctx.say(
        `  ► Round ${c.round} : CT ${c.scoreCt} - ${c.scoreT} T${statusLabel}${directLabel}`,
      );
    }
    await ctx.say(
      'Tapez !restore <numéro> pour proposer un vote (ex: !restore ' + candidates[0].round + ')',
    );
  }
}
