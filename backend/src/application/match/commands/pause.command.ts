import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { PauseMatchService, PauseReason } from '@app/match/pause/pause.service';
import { Logical } from '@app/match/state';
import { isNonPlayingSide, GameSide } from '@domain/side.types';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';

@Injectable()
export class PauseCommand extends BaseCommand {
  private readonly logger = new Logger(PauseCommand.name);

  constructor(
    @Inject(forwardRef(() => PauseMatchService))
    private readonly pauseService: PauseMatchService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly rconService: MatchCommandsService,
  ) {
    super();
  }

  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isPauseRequest =
      event.payload.command === CS2_CHAT_COMMANDS.PAUSE ||
      event.payload.command === 'tac' ||
      event.payload.command === CS2_CHAT_COMMANDS.TECH;
    const isUnpauseRequest = event.payload.command === 'unpause';

    if (!isPauseRequest && !isUnpauseRequest) {
      return false;
    }

    const senderTeam = event.payload.sender.team;
    if (senderTeam !== 'CT' && senderTeam !== 'T') {
      await ctx.say('Seuls les joueurs peuvent mettre le match en pause/reprise.');
      return false;
    }

    const isMatchPaused = await this.pauseService.isPaused(event.matchId);
    if (isPauseRequest && isMatchPaused) {
      await ctx.say('Le match est déjà en pause.');
      return false;
    }
    if (isUnpauseRequest && !isMatchPaused) {
      await ctx.say("Le match n'est pas en pause.");
      return false;
    }

    return true;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isPauseRequest =
      event.payload.command === CS2_CHAT_COMMANDS.PAUSE ||
      event.payload.command === 'tac' ||
      event.payload.command === CS2_CHAT_COMMANDS.TECH;

    this.logCommand(event.payload.command, event);

    if (isPauseRequest) {
      // Garde-fous: seuls les joueurs affectés à une équipe peuvent pauser
      if (isNonPlayingSide(event.payload.sender.team)) return false;

      // Résolution de l'équipe logique (home/away) depuis CT/T
      const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team as GameSide);
      if (!team) return false;

      const reason: PauseReason =
        event.payload.command === CS2_CHAT_COMMANDS.TECH ? 'technical' : 'tactical';

      // Politique d'autorisation (banque tactique, etc.)
      const isAllowed = await this.pauseService.isPauseAllowed(event.matchId, {
        reason,
        team,
      });
      if (!isAllowed.allowed) {
        await ctx.say("Vous n'avez plus de pauses tactiques.");
        return false;
      }

      // Phase courante
      const phase = await this.pauseService.getPhase(event.matchId); // 'live' | 'bomb_planted' | 'freeze' | 'end' | null
      const durationSec = reason === 'tactical' ? 30 : 60;

      // Round en cours (y compris bombe posée et fin de round) → on ARME (pas de RCON, pas de timers) :
      // la pause démarre au prochain freeze, comme mp_pause_match natif.
      if (phase === 'live' || phase === 'bomb_planted' || phase === 'end') {
        await this.pauseService.pause(event.matchId, event.serverId, {
          reason,
          team,
          durationSec,
          armOnly: true,
          by: {
            steamId: event.payload.sender.steamId,
            name: event.payload.sender.name,
            source: 'chat',
          },
        });
        await ctx.say(
          `[GG] Pause ${reason} de ${team.toUpperCase()} armée - elle débutera au prochain freeze.`,
        );
        return true;
      }

      // En FREEZE → on ACTIVE immédiatement (état + messages périodiques + RCON)
      if (phase === 'freeze') {
        await this.pauseService.pause(event.matchId, event.serverId, {
          reason,
          team,
          durationSec,
          armOnly: false,
          by: {
            steamId: event.payload.sender.steamId,
            name: event.payload.sender.name,
            source: 'chat',
          },
        });
        await this.rconService.pause({
          matchId: event.matchId,
          serverId: event.serverId,
        });
        await ctx.say(
          `[GG] Pause ${reason} de ${team.toUpperCase()} - ${durationSec}s.`,
        );
        return true;
      }

      // Hors round (warmup, knife, fin de match) → on refuse avec le bon motif
      const matchPhase = (await ctx.state.getSnapshot(event.matchId))?.phase;
      await ctx.say(
        matchPhase === 'postgame'
          ? 'Impossible de mettre en pause : le match est terminé.'
          : "Impossible de mettre en pause : aucun round n'est en cours.",
      );
      return false;
    }

    // Reprise (UNPAUSE)
    await this.pauseService.resume(event.matchId);
    await this.rconService.unpause({
      matchId: event.matchId,
      serverId: event.serverId,
    });
    await ctx.say('[GG] Le match a repris.');
    return true;
  }
}
