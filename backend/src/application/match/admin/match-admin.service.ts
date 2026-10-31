// src/application/match/admin/match-admin.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { PauseMatchService } from '@app/match/pause/pause.service';
import { MatchPhase } from '@domain/phase.types';
import { CS2_RCON_COMMANDS, CS2_RULES } from '@domain/rules/rules.constants';

export class MatchAdminError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** Phases before the live where the players are still waiting: the start can be forced, the sides swapped. */
const NEXT_PHASE: Partial<Record<string, MatchPhase>> = {
  [MatchPhase.KNIFE_WARMUP]: MatchPhase.KNIFE_LIVE,
  [MatchPhase.WARMUP_MAIN]: MatchPhase.LIVE_MAIN,
  [MatchPhase.HALFTIME]: MatchPhase.LIVE_MAIN,
};
const PLAYING = new Set<string>([MatchPhase.LIVE_MAIN, MatchPhase.OVERTIME]);

/**
 * Commands of the match console (admins), on a match of the real-time engine (for a tournament game: the game id).
 * Each one goes through the engine (never raw RCON alone) so GG-Core and the server stay in step, and is recorded with
 * its author in the match's event log (events_primary, type admin_action) and pushed to the admins (admin:action).
 * "Redémarrer" and "changer de carte" are a relaunch of the game (POST …/games/:order/launch), not commands here.
 */
@Injectable()
export class MatchAdminService {
  private readonly log = new Logger(MatchAdminService.name);

  constructor(
    private readonly orch: MatchOrchestrator,
    private readonly state: MatchStateService,
    private readonly cmds: MatchCommandsService,
    private readonly pause: PauseMatchService,
    private readonly prisma: PrismaService,
    private readonly ws: WsBroadcaster,
  ) {}

  /** Technical pause by an admin: immediate, no time limit, until "Reprendre". */
  async pauseMatch(matchId: string, by: string) {
    const { serverId } = await this.running(matchId);
    if (await this.pause.isPaused(matchId)) throw new MatchAdminError('conflict', 'match already paused');
    await this.orch.requestPauseTechnical({ serverId, matchId }, 'system');
    await this.cmds.say(serverId, '[GG-Core] Pause technique demandée par un admin.');
    return this.done(matchId, serverId, by, 'pause');
  }

  /**
   * Resume: ends GG-Core's pause (any kind), or only unpauses the server when GG-Core has none (CS2 pauses by
   * itself after a backup restore).
   */
  async unpauseMatch(matchId: string, by: string) {
    const { serverId } = await this.running(matchId);
    if (await this.pause.isPaused(matchId)) await this.orch.resume({ serverId, matchId }, { source: 'admin', reason: 'admin' });
    else await this.cmds.unpause({ serverId, matchId });
    return this.done(matchId, serverId, by, 'unpause');
  }

  /**
   * Starts without waiting for the !ready of both teams (warmup, knife warmup, halftime warmup). With sides from
   * the veto the players' sides are checked first, as on !ready (both teams inverted → swapped; otherwise refused).
   */
  async forceStart(matchId: string, by: string) {
    const { serverId, phase } = await this.running(matchId);
    const next = NEXT_PHASE[phase];
    if (!next) throw new MatchAdminError('conflict', `nothing to start in phase ${phase}`);
    if (await this.orch.isCountdownActive(matchId)) throw new MatchAdminError('conflict', 'a countdown is already running');
    if (phase === MatchPhase.WARMUP_MAIN && !(await this.orch.checkTeamPlacement(matchId, serverId))) {
      throw new MatchAdminError('conflict', 'players on the wrong side (named in the chat): move them first');
    }
    await this.cmds.say(serverId, '[GG-Core] Départ forcé par un admin.');
    await this.orch.startPhaseCountdown(matchId, next, CS2_RULES.COUNTDOWN_DELAY_SEC, serverId);
    return this.done(matchId, serverId, by, 'force_start', { to: next });
  }

  /**
   * Before the live, the two teams change side (mp_swapteams) and GG-Core follows them (each team keeps its
   * identity). Refused with sides chosen in the veto: those are checked on !ready instead.
   */
  async swapTeams(matchId: string, by: string) {
    const { serverId, phase } = await this.running(matchId);
    if (phase !== MatchPhase.KNIFE_WARMUP && phase !== MatchPhase.WARMUP_MAIN) {
      throw new MatchAdminError('conflict', `sides can only be swapped before the live (phase ${phase})`);
    }
    if ((await this.state.getSettings(matchId)).fixedSides) {
      throw new MatchAdminError('conflict', 'sides chosen in the veto: the players are checked on !ready (both teams inverted are swapped)');
    }
    await this.cmds.rcon({ serverId, matchId, command: 'mp_swapteams' });
    await this.state.swapSides(matchId);
    await this.cmds.say(serverId, '[GG-Core] Échange des camps par un admin.');
    await this.orch.pushState(matchId);
    return this.done(matchId, serverId, by, 'swap_teams');
  }

  /**
   * Replays round `round` (1-based) from the backup CS2 wrote at its start: backup_round(N-1).txt, the state after
   * N-1 rounds (checked on the dev server: backup_round05.txt holds "round" "5" and 5 rounds of score). GG-Core
   * rolls its score and stats back when CS2 logs the restore; CS2 pauses the match after it (Reprendre).
   */
  async restoreRound(matchId: string, round: number, by: string) {
    const { serverId, phase } = await this.running(matchId);
    if (!PLAYING.has(phase)) throw new MatchAdminError('conflict', `no round to restore in phase ${phase}`);
    const current = (await this.state.getSnapshot(matchId))?.score?.round ?? 0;
    if (!Number.isInteger(round) || round < 1 || round > current) {
      throw new MatchAdminError('invalid', `round: 1 to ${current} (the round being played)`);
    }
    const file = `backup_round${String(round - 1).padStart(2, '0')}.txt`;
    await this.cmds.say(serverId, `[GG-Core] Un admin rejoue le round ${round}.`);
    await this.cmds.rcon({ serverId, matchId, command: CS2_RCON_COMMANDS.RESTORE_LOAD(file) });
    return this.done(matchId, serverId, by, 'restore_round', { round, file });
  }

  /** Message in the game chat, signed "[Admin]". */
  async say(matchId: string, message: string, by: string) {
    const text = String(message ?? '').replace(/["\r\n]/g, ' ').trim().slice(0, 180);
    if (!text) throw new MatchAdminError('invalid', 'message: the text to show in the game chat');
    const { serverId } = await this.running(matchId, true);
    await this.cmds.say(serverId, `[Admin] ${text}`);
    return this.done(matchId, serverId, by, 'say', { message: text });
  }

  /** The event log of a match, oldest first (the console shows it on open, then follows the WebSocket). */
  async events(matchId: string, limit = 200) {
    const rows = await this.prisma.eventPrimary.findMany({
      where: { matchId },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(1, limit), 1000),
    });
    return rows.reverse().map((r) => ({ id: String(r.id), timestamp: Number(r.timestamp), type: r.type, payload: r.payload }));
  }

  // --- Internals ------------------------------------------------------------------------------------------

  /** The match must be bound to a server and not over (`anyPhase`: over is fine, e.g. a message after the end). */
  private async running(matchId: string, anyPhase = false): Promise<{ serverId: string; phase: string }> {
    const [serverId, phase] = await Promise.all([this.state.getServerIdFromMatchId(matchId), this.state.getPhase(matchId)]);
    if (!serverId || !phase) throw new MatchAdminError('not_found', 'match not running on a server');
    if (!anyPhase && phase === MatchPhase.POSTGAME) throw new MatchAdminError('conflict', 'match is over');
    return { serverId, phase };
  }

  /** Records the action with its author (event log + admins on the WebSocket). */
  private async done(matchId: string, serverId: string, by: string, action: string, params: Record<string, unknown> = {}) {
    const payload = { action, by, ...params };
    this.log.log(`[admin] ${matchId} on ${serverId}: ${action} by ${by} ${JSON.stringify(params)}`);
    const matchMapId = await this.state.getDbMatchMapId(matchId);
    await this.prisma.eventPrimary
      .create({ data: { matchId, serverId, matchMapId: matchMapId ?? null, timestamp: BigInt(Date.now()), type: 'admin_action', payload } })
      .catch((e) => this.log.warn(`[admin] action not recorded: ${e?.message}`));
    await this.ws.push(matchId, 'admin:action', { matchId, serverId, ...payload, at: Date.now() }, 'admin');
    return { ok: true, matchId, ...payload };
  }
}
