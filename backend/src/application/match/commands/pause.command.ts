import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { PauseMatchService, PauseReason } from '@app/match/pause/pause.service';
import { isNonPlayingSide, GameSide } from '@domain/side.types';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';
import { RoundRestoreService } from '../restore/round-restore.service';
import { TournamentConfigService } from '@app/config/tournament-config.service';
import { DEFAULT_BOT_TAG, DEFAULT_MESSAGES } from '@domain/config/config.constants';
import { MessageKey } from '@domain/config/config.types';
import { interpolateTemplate } from '@domain/config/template.utils';

@Injectable()
export class PauseCommand extends BaseCommand {
  private readonly logger = new Logger(PauseCommand.name);

  constructor(
    @Inject(forwardRef(() => PauseMatchService))
    private readonly pauseService: PauseMatchService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly rconService: MatchCommandsService,
    @Optional()
    @Inject(forwardRef(() => RoundRestoreService))
    private readonly restoreService?: RoundRestoreService,
    @Optional() private readonly configService?: TournamentConfigService,
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
      await ctx.say(await this.message(event.matchId, 'PAUSE_ONLY_PLAYERS'));
      return false;
    }

    const isMatchPaused = await this.pauseService.isPaused(event.matchId);
    if (isPauseRequest && isMatchPaused) {
      await ctx.say(await this.message(event.matchId, 'PAUSE_ALREADY'));
      return false;
    }
    if (isUnpauseRequest && !isMatchPaused) {
      await ctx.say(await this.message(event.matchId, 'UNPAUSE_NOT_PAUSED'));
      return false;
    }

    return true;
  }

  /**
   * "!ready" while the game is paused means "ready to resume": the same as "!unpause" (after a technical pause, both
   * teams have to agree). Outside a pause it does nothing: the warmup owns "!ready".
   */
  async handleReadyToResume(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    if (!(await this.pauseService.isPaused(event.matchId))) return false;
    return this.handle({ ...event, payload: { ...event.payload, command: 'unpause' } }, ctx);
  }

  /**
   * A chat message from the catalogue (DEFAULT_MESSAGES, overridable per tournament). Without the config service
   * (unit tests, no tournament) the default text and tag are used.
   */
  private async message(matchId: string, key: MessageKey, params: Record<string, unknown> = {}): Promise<string> {
    if (this.configService) return this.configService.formatMessage(matchId, key, params);
    return interpolateTemplate(DEFAULT_MESSAGES[key], { tag: DEFAULT_BOT_TAG, ...params });
  }

  /** The team's name for the chat ("Démo Rouge"), not its logical slot ("AWAY"). */
  private async teamLabel(ctx: RuleContext, matchId: string, team: 'home' | 'away'): Promise<string> {
    const snapshot = await ctx.state.getSnapshot(matchId);
    const name = team === 'home' ? snapshot?.teams?.home_name : snapshot?.teams?.away_name;
    return name?.trim() || (team === 'home' ? 'Domicile' : 'Extérieur');
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isPauseRequest =
      event.payload.command === CS2_CHAT_COMMANDS.PAUSE ||
      event.payload.command === 'tac' ||
      event.payload.command === CS2_CHAT_COMMANDS.TECH;

    this.logCommand(event.payload.command, event);

    if (isPauseRequest) {
      if (this.restoreService?.hasPendingUnpause(event.matchId)) {
        this.restoreService.clearUnpauseTimer(event.matchId);
        await ctx.say(await this.message(event.matchId, 'PAUSE_RESUME_INTERRUPTED'));
      }
      // Garde-fous: seuls les joueurs affectés à une équipe peuvent pauser
      if (isNonPlayingSide(event.payload.sender.team)) return false;

      // Résolution de l'équipe logique (home/away) depuis CT/T
      const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team as GameSide);
      if (!team) return false;

      const reason: PauseReason =
        event.payload.command === CS2_CHAT_COMMANDS.TECH ? 'technical' : 'tactical';
      const customReason =
        reason === 'technical' && event.payload.parameters?.length
          ? event.payload.parameters.map(String).join(' ').trim()
          : undefined;
      const reasonLabel = customReason ? ` : "${customReason}"` : '';
      const teamName = await this.teamLabel(ctx, event.matchId, team);

      // Politique d'autorisation (banque tactique, etc.)
      const isAllowed = await this.pauseService.isPauseAllowed(event.matchId, {
        reason,
        team,
      });
      if (!isAllowed.allowed) {
        const denied: MessageKey =
          isAllowed.why === 'already_paused'
            ? 'PAUSE_ALREADY'
            : isAllowed.why === 'no_bank'
              ? 'PAUSE_DENIED_NO_BANK'
              : 'PAUSE_DENIED';
        await ctx.say(await this.message(event.matchId, denied));
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
          customReason,
          by: {
            steamId: event.payload.sender.steamId,
            name: event.payload.sender.name,
            source: 'chat',
          },
        });
        await ctx.say(
          await this.message(event.matchId, reason === 'tactical' ? 'PAUSE_TAC_ARMED' : 'PAUSE_TECH_ARMED', {
            team: teamName,
            reason: reasonLabel,
          }),
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
          customReason,
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
          await this.message(event.matchId, reason === 'tactical' ? 'PAUSE_TAC_LIVE' : 'PAUSE_TECH_LIVE', {
            team: teamName,
            reason: reasonLabel,
          }),
        );
        return true;
      }

      // Hors round (warmup, knife, fin de match) → on refuse avec le bon motif
      const matchPhase = (await ctx.state.getSnapshot(event.matchId))?.phase;
      await ctx.say(await this.message(event.matchId, matchPhase === 'postgame' ? 'PAUSE_DENIED_ENDED' : 'PAUSE_DENIED_NO_ROUND'));
      return false;
    }

    // Reprise (UNPAUSE)
    if (!(await this.pauseService.isPaused(event.matchId))) {
      await ctx.say(await this.message(event.matchId, 'UNPAUSE_NOT_PAUSED'));
      return false;
    }
    const pauseState = await this.pauseService.getPauseState(event.matchId);
    if (pauseState.reason === 'technical') {
      const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team as GameSide);
      if (team === 'home' || team === 'away') {
        const { bothReady } = await this.pauseService.voteUnpause(event.matchId, team);
        if (!bothReady) {
          await ctx.say(
            await this.message(event.matchId, 'UNPAUSE_WAITING', { team: await this.teamLabel(ctx, event.matchId, team) }),
          );
          return true;
        }
        await ctx.say(await this.message(event.matchId, 'UNPAUSE_AGREED'));
      }
    }
    await this.pauseService.resume(event.matchId);
    await this.rconService.unpause({
      matchId: event.matchId,
      serverId: event.serverId,
    });
    await ctx.say(await this.message(event.matchId, 'MATCH_RESUMED'));
    return true;
  }
}
