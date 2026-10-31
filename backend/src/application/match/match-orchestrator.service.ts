// src/application/match/match-orchestrator.service.ts
import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_PUB } from '@adapters/redis/redis.tokens';

import { PauseMatchService } from '@app/match/pause/pause.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { GameSide, MatchStateService, type Logical } from '@app/match/state/match-state.service';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { WsEventType } from '@adapters/ws/dto/events.dto';
import { Audience } from '@domain/events/internal-events';
import { SidesScoreService } from './state';
import { MatchPhase, Phase, RoundPhase } from '@domain/phase.types';
import { MatchPhaseService } from './phase/match-phase.service';
import { RoundStartEvent, GenericMatchEvent, BombPlantedEvent, TeamRoundWinEvent, RoundFreezeStartEvent } from '@domain/events/match.event';
import { RuleContextFactory } from '@app/rules/rule-context.factory';
import { MatchSettings, MatchReview, DEFAULT_MATCH_SETTINGS } from '@domain/match-settings.types';
import { CS2_CFG } from '@domain/rules/rules.constants';
import { REDIS_CHANNELS } from './state/redis.keys';
import { RuleContext } from '@domain/rules';
import { TournamentPersistenceService, isUuid } from '@adapters/database/tournament-persistence.service';
import { MatchAccess, MatchAccessService } from './access/match-access.service';
import { TeamPlacementService } from './access/team-placement.service';

type ResumeMeta = { source?: 'expired' | 'admin' | 'chat'; reason?: 'tactical'|'technical'|'admin' };

@Injectable()
export class MatchOrchestrator {
  private readonly log = new Logger(MatchOrchestrator.name);
  // 1 timer par match (auto-unpause des temps-morts tactiques)
  private autoTimers = new Map<string, NodeJS.Timeout>();
  private isPausedrequested = new Map<string, boolean>();

  constructor(
    private readonly ws: WsBroadcaster,
    private readonly pause: PauseMatchService,
    @Inject(forwardRef(() => MatchPhaseService))
    private readonly phase: MatchPhaseService,
    @Inject(forwardRef(() => MatchCommandsService)) 
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly sides: SidesScoreService,   // optionnel mais idéal
    @Inject(forwardRef(() => RuleContextFactory))
    private readonly ctxFactory: RuleContextFactory,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    @Optional() private readonly tournamentPersistence?: TournamentPersistenceService,
    @Optional() private readonly access?: MatchAccessService,
    @Optional() private readonly placement?: TeamPlacementService,
  ) {}

  /**
   * Both teams ready, before the countdown to the live: with sides chosen in the veto, are the players on their
   * side? false = the live waits (players told in the chat). Always true for other matches.
   */
  async checkTeamPlacement(matchId: string, serverId: string): Promise<boolean> {
    if (!this.placement || !serverId) return true;
    return this.placement.checkBeforeLive(matchId, serverId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async resolve(ids: { serverId?: string | null; matchId?: string | null }) {
    let { serverId, matchId } = ids;
    if (!serverId && matchId) serverId = await this.state.getServerIdFromMatchId(matchId);
    if (serverId && !matchId) matchId = await this.state.getMatchIdFromServerId(serverId);
    if (!serverId || !matchId) throw new Error('serverId et/ou matchId manquant');
    return { serverId, matchId };
  }

  // programme un timer; à l'échéance on re-vérifie l'état et on resume si la banque est à 0
  private armAutoUnpause(matchId: string, serverId: string, seconds: number) {
    this.disarmAutoUnpause(matchId); // idempotent
    const delayMs = Math.max(0, Math.floor(seconds)) * 1000;

    const t = setTimeout(async () => {
      try {
        const st = await this.pause.getPauseState(matchId); // { state, reason, team, startedAt, tacBankHome, tacBankAway }

        // Toujours vérifier qu'on est encore en pause tactique
        if (st.state !== 'paused' || st.reason !== 'tactical' || !st.team) return;

        const elapsed = st.startedAt ? Math.round((Date.now() - st.startedAt) / 1000) : 0;
        const bank = st.team === 'home' ? (st.tacBankHome ?? 0) : (st.tacBankAway ?? 0);
        const remaining = Math.max(0, bank - elapsed);

        if (remaining > 0) {
          // Drift ou banque ajustée : on réarme pour le restant
          this.armAutoUnpause(matchId, serverId, remaining);
          return;
        }

        // Banque à 0 → orchestrer la reprise (annule périodiques via PauseMatchService.resume)
        await this.resume({ matchId, serverId }, { source: 'expired', reason: 'tactical' });
      } catch (e) {
        // log si tu veux; on ne relance pas pour éviter boucle en échec
      }
    }, delayMs);

    this.autoTimers.set(matchId, t);
  }

  private disarmAutoUnpause(matchId: string) {
    const t = this.autoTimers.get(matchId);
    if (t) clearTimeout(t);
    this.autoTimers.delete(matchId);
  }

  private async notify(type: string, payload: any) {
    await this.pub.publish(REDIS_CHANNELS.EVENTS, JSON.stringify({ v: 1, type, timestamp: Date.now(), ...payload }));
  }

  // ---------------------------------------------------------------------------
  // Use-cases
  // ---------------------------------------------------------------------------

  /** Pause tactique : décrémente côté règles + pause in-game + timer auto-unpause */
  async requestPauseTactical(
    ids: { serverId?: string | null; matchId?: string | null },
    team: Logical
  ): Promise<{ ok: true } | { ok: false; why: string }> {
    const { serverId, matchId } = await this.resolve(ids);

    // Autorisation (banque dispo, pas déjà en pause…)
    const chk = await this.pause.isPauseAllowed(matchId, { reason: 'tactical', team });
    if (!chk.allowed) return { ok: false, why: chk.why };

    const roundPhase = await this.phase.getRoundPhase(matchId);
    if (roundPhase !== RoundPhase.FREEZE) {
      // Pas en freeze : on arme la pause pour la prochaine freeze time
      await this.cmds.say(serverId, 'La demande de pause a ete enregistree !');
      await this.pause.pause(matchId, serverId, { reason: 'tactical', team, armOnly: true });
      return { ok: true };
    }

    // En freeze : pause immédiate
    await this.cmds.pause({ serverId, matchId });
    await this.pause.pause(matchId, serverId, { reason: 'tactical', team });
    const bank = await this.pause.getTacBank(matchId, team);
    this.armAutoUnpause(matchId, serverId, bank);

    await this.notify('pause:started', { matchId, serverId, reason: 'tactical', team });
    return { ok: true };
  }

  async applyPauseIfArmed(
    ev: (GenericMatchEvent & { serverId?: string }) | (RoundFreezeStartEvent & { serverId?: string })
  ) {
    const res = await this.pause.consumeArmed(ev.matchId);
    if (res.consumed && res.pick) {
      const reason = res.pick.req.reason;
      const duration = res.pick.req.durationSec ?? (reason === 'tactical' ? 30 : 60);

      // 1) Appliquer la pause côté état + messages périodiques
      await this.pause.pause(ev.matchId, ev.serverId!, {
        reason,
        team: res.pick.team,
        durationSec: duration,
        armOnly: false,
        by: res.pick.req.by,
      });

      // 2) Demander la pause à l'agent (ingame)
      await this.cmds.pause(ev);

      // 3) Auto-unpause si pause tactique
      if (reason === 'tactical' && res.pick.team !== 'system') {
        const bank = await this.pause.getTacBank(ev.matchId, res.pick.team);
        this.armAutoUnpause(ev.matchId, ev.serverId!, bank);
      }
    }
  }

  /** Pause technique (admin ou commande) : illimitée par défaut, pas de timer auto */
  async requestPauseTechnical(
    ids: { serverId?: string | null; matchId?: string | null },
    team: Logical = 'home'
  ): Promise<{ ok: true }> {
    const { serverId, matchId } = await this.resolve(ids);

    await this.pause.pause(matchId, serverId, {
      reason: 'technical',
      team,
      armOnly: false,
    });
    await this.cmds.pause({ serverId, matchId });
    await this.notify('pause:started', { matchId, serverId, reason: 'technical', team });
    return { ok: true as const };
  }

  /** Resume (manuel ou auto-expire) : reset règles + unpause in-game + notify */
  async resume(
    ids: { serverId?: string | null; matchId?: string | null },
    meta?: ResumeMeta
  ): Promise<{ ok: true }> {
    const { serverId, matchId } = await this.resolve(ids);

    this.disarmAutoUnpause(matchId); // stoppe un éventuel timer

    await this.pause.resume(matchId);        // débit banque + stop périodiques + reset état
    await this.cmds.unpause({ serverId, matchId }); // agent "unpause" + phase=live côté state existant

    await this.notify('pause:resumed', {
      matchId,
      serverId,
      source: meta?.source ?? 'admin',
      reason: meta?.reason ?? 'tactical',
    });

    return { ok: true };
  }

  async push(
    matchId: string,
    wsEventType: WsEventType,
    payload: any,
    audience?: Audience,
  ) {
    await this.ws.push(matchId, wsEventType, payload, audience);
  }

  // ---------------------------------------------------------------------------
  // Server Game Over vs GG-Core: the server is the truth for what was PLAYED (score), GG-Core for what the
  // RULES decide (MR, overtimes, no draw). When they disagree nothing is decided silently: the result is
  // frozen (events ignored, see MatchEventsHandler) until an admin accepts the server result or dismisses.
  // ---------------------------------------------------------------------------

  /** The Game Over line arrives in the same second as the last round's events: let GG-Core process them first. */
  static GAME_OVER_SETTLE_MS = 5000;

  onServerGameOver(matchId: string, serverId: string | undefined, serverScore: { ct: number; t: number }) {
    setTimeout(() => {
      this.checkServerGameOver(matchId, serverId, serverScore).catch((e) =>
        this.log.warn(`[gameOver] check failed for ${matchId}: ${e?.message}`),
      );
    }, MatchOrchestrator.GAME_OVER_SETTLE_MS);
  }

  async checkServerGameOver(matchId: string, serverId: string | undefined, serverScore: { ct: number; t: number }) {
    if (await this.state.getReview(matchId)) return;
    const phase = await this.state.getPhase(matchId);
    const snapshot = await this.state.getSnapshot(matchId);
    const ggScore = { ct: snapshot.score.ct, t: snapshot.score.t };

    if (phase === MatchPhase.POSTGAME && ggScore.ct === serverScore.ct && ggScore.t === serverScore.t) {
      this.log.log(`[gameOver] ${matchId}: server Game Over ${serverScore.ct}:${serverScore.t} confirms GG-Core`);
      return;
    }

    const review: MatchReview = {
      reason: phase === MatchPhase.POSTGAME ? 'final_score_mismatch' : 'server_ended_match',
      serverScore,
      ggScore,
      ggPhase: String(phase),
      openedAt: Date.now(),
    };
    await this.state.setReview(matchId, review);
    this.log.warn(
      `[gameOver] ${matchId}: REVIEW REQUIRED (${review.reason}) server ${serverScore.ct}:${serverScore.t} / GG-Core ${ggScore.ct}:${ggScore.t} phase=${phase}`,
    );
    await this.push(matchId, 'match:review_required', { matchId, ...review }, 'admin');
    const sid = serverId ?? (await this.state.getServerIdFromMatchId(matchId));
    if (sid) {
      await this.cmds.say(sid, '[GG-Core] Fin de match du serveur non conforme au règlement : résultat gelé, un admin va arbitrer.');
    }
  }

  getReview(matchId: string) {
    return this.state.getReview(matchId);
  }

  /**
   * accept_server: GG-Core takes the server score and ends the match with it (a draw stays a draw).
   * dismiss: the freeze is lifted, GG-Core keeps its own state (e.g. the admin restored a backup to play on).
   */
  async resolveReview(matchId: string, decision: 'accept_server' | 'dismiss') {
    const review = await this.state.getReview(matchId);
    if (!review) return { ok: false as const, why: 'no_review' };
    await this.state.setReview(matchId, null);

    if (decision === 'accept_server') {
      const { ct, t } = review.serverScore;
      await this.state.reconcileScore(matchId, ct, t);
      if ((await this.state.getPhase(matchId)) !== MatchPhase.POSTGAME) {
        const winner: GameSide | null = ct > t ? 'CT' : t > ct ? 'T' : null;
        const serverId = await this.state.getServerIdFromMatchId(matchId);
        await this.endMatch(matchId, winner, this.ctxFactory.make({ matchId, serverId: serverId ?? undefined }));
      } else {
        await this.pushState(matchId);
      }
    }
    this.log.log(`[gameOver] ${matchId}: review resolved (${decision})`);
    await this.push(matchId, 'match:review_resolved', { matchId, decision, review }, 'admin');
    return { ok: true as const, decision };
  }

  async pushState(matchId: string) {
    const snapshot = await this.state.getSnapshot(matchId);
    await this.ws.push(matchId, 'match:state', snapshot);
  }

  async sideToLogical(
    matchId: string,
    sideInput: GameSide
  ): Promise<Logical | null> {
    return this.state.sideToLogical(matchId, sideInput);
  }

  applyKnifeResult(matchId: string, winnerFromEvent: 'CT' | 'T') {
    return this.state.applyKnifeResult(matchId, winnerFromEvent);
  }

  isCountdownActive(matchId: string) {
    return this.phase.isCountdownActive(matchId);
  }

  startPhaseCountdown(matchId: string, nextPhase: MatchPhase, seconds: number, serverId: string) {
    return this.phase.startPhaseCountdown(matchId, nextPhase, seconds, serverId);
  }

  logicalToSide(matchId: string, logicalTeam: Logical) {
    return this.state.logicalToSide(matchId, logicalTeam);
  }

  rcon(opts: { serverId: string; matchId: string; command: string }) {
    return this.cmds.rcon(opts);
  }

  /** Applies one of GG-Core's .cfg (agent/cfg/ggbot) line by line through the agent (they do not exist on the server). */
  async execCfg(opts: { serverId: string; matchId: string }, cfg: string) {
    return this.cmds.exec({ serverId: opts.serverId, matchId: opts.matchId, cfgName: cfg });
  }

  restartGame(opts: { serverId: string; matchId: string; delay: number }) {
    return this.cmds.restartGame(opts);
  }

  isBothReady(matchId: string) {
    return this.phase.isBothReady(matchId);
  }

  setReady(matchId: string, team: any, ready: boolean) {
    return this.phase.setReady(matchId, team, ready);
  }

  resetReady(matchId: string) {
    return this.phase.resetReady(matchId);
  }

  getKnifeResult(matchId: string) {
    return this.state.getKnifeResult(matchId);
  }

  roundEnd(matchId: string, winner: GameSide) {
    return this.state.roundEnd(matchId, winner);
  }

  async swapSides(matchId: string) {
    const ok = await this.state.swapSides(matchId);
    if (ok) {
      const sides = await this.state.getSides(matchId);
      await this.push(matchId, 'sides:swapped', { sides } as any);
    }
    return ok;
  }

  async onFreezeTimeStart(ev: (GenericMatchEvent & { serverId?: string }) | (RoundFreezeStartEvent & { serverId?: string })) {
    this.log.debug('Freeze time started !');
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.FREEZE);
    await this.applyPauseIfArmed(ev);
  }

  async onRoundEnd(ev: (TeamRoundWinEvent & { serverId?: string }) | (GenericMatchEvent & { serverId?: string })) {
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.END);
    this.log.debug('Round ended !');
  }

  async onBombPlanted(ev: (BombPlantedEvent & { serverId?: string }) | (GenericMatchEvent & { serverId?: string })) {
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.BOMB_PLANTED);
    this.log.debug('Bomb planted !');
  }

  async onRoundStart(ev: (RoundStartEvent & { serverId?: string }) | (GenericMatchEvent & { serverId?: string })) {
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.LIVE);

    const ctx = this.ctxFactory.make({ matchId: ev.matchId, serverId: ev.serverId });
    const s = await ctx.state.getSnapshot(ctx.matchId);
    const HCT = s.sides?.home === 'CT';
    const ctBank = (HCT ? s.economy.home_bank : s.economy.away_bank) ?? 0;
    const tBank = (HCT ? s.economy.away_bank : s.economy.home_bank) ?? 0;
    const ctLS = (HCT ? s.economy.home_loss_streak : s.economy.away_loss_streak) ?? 0;
    const tLS = (HCT ? s.economy.away_loss_streak : s.economy.home_loss_streak) ?? 0;

    this.log.log(
      `ROUND ${s.score.round} [${s.score.phase}] | CT:${s.teams.ct_name} ${s.score.ct} (bank=${ctBank},ls=${ctLS}) | ` +
      `T:${s.teams.t_name} ${s.score.t} (bank=${tBank},ls=${tLS}) | match=${s.matchId}`
    );

    this.log.debug('Round Live !');
  }

  startWarmup(serverId: string) {
    this.cmds.rcon({ serverId, command: 'mp_warmup_start' });
  }

  setPhase(matchId: string, phase: Phase) {
    return this.sides.setPhase(matchId, phase);
  }

  async getPhase(matchId: string) {
    return this.sides.getPhase(matchId);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle: Match Start & End Automation
  // ---------------------------------------------------------------------------

  async startMatch(opts: {
    serverId: string;
    matchId: string;
    mapName?: string;
    settings?: Partial<MatchSettings>;
    /** Server password and players allowed; none = server without password nor whitelist (Sandbox, tests) */
    access?: MatchAccess;
  }) {
    const { serverId, matchId } = opts;
    const mapName = opts.mapName ?? 'de_mirage';
    const settings = { ...DEFAULT_MATCH_SETTINGS, ...(opts.settings ?? {}) };

    await this.state.setSettings(matchId, settings);
    await this.state.setServerIdToMatchId(serverId, matchId);
    await this.pause.initTacBanks(matchId, settings.tacticalPauseBankSec);

    // 1) GOTV must be enabled BEFORE the map loads, otherwise tv_record answers "GOTV not active"
    //    and no demo is recorded (observed on a real server).
    await this.cmds.rcon({ serverId, matchId, command: 'tv_enable 1' }).catch(() => {});

    // 2) Change map if needed
    try {
      await this.cmds.changeLevel({ serverId, map: mapName });
    } catch (err: any) {
      this.log.debug(`changelevel: ${err?.message}`);
    }

    // 3) Warmup config (applied by the agent) & start GOTV demo recording
    await this.execCfg({ serverId, matchId }, CS2_CFG.WARMUP).catch(() => {});
    // Access (sv_password, public GOTV) AFTER the map change: CS2 runs server.cfg at each map load, and a
    // server.cfg with `sv_password ""` wiped a password set before changelevel (seen on the dev server). Commands
    // sent after changelevel reach the server once the map is loaded, like the warmup cfg above.
    const access = await this.access?.apply(matchId, serverId, opts.access);
    await this.cmds.rcon({ serverId, matchId, command: `tv_record "${matchId}_${mapName}"` }).catch(() => {});

    // 3) Initial phase
    const initialPhase = settings.knifeEnabled ? MatchPhase.KNIFE_WARMUP : MatchPhase.WARMUP_MAIN;
    await this.setPhase(matchId, initialPhase);

    // 4) In-game announcement & WS broadcast
    await this.cmds.say(serverId, `[GG-Core] Match configuré sur ${mapName} ! Tapez !ready quand vous êtes prêts.`);
    await this.push(matchId, 'match:state', await this.state.getSnapshot(matchId));

    return { ok: true, matchId, serverId, map: mapName, phase: initialPhase, access };
  }

  async endMatch(matchId: string, winnerSide: GameSide | null, ctx: RuleContext) {
    const serverId = ctx.serverId ?? (await this.state.getServerIdFromMatchId(matchId));
    const snapshot = await this.state.getSnapshot(matchId);
    const settings = await this.state.getSettings(matchId);

    // 1. Transition phase to POSTGAME
    await this.setPhase(matchId, MatchPhase.POSTGAME);

    // 2. Announce winner
    let winnerLogical: Logical | null = null;
    let winnerName = 'Match nul';
    let winnerId: string | undefined = undefined;

    if (winnerSide) {
      winnerLogical = await this.state.sideToLogical(matchId, winnerSide);
      const configuredName = winnerLogical === 'home' ? snapshot.teams.home_name : snapshot.teams.away_name;
      const defaultSideName = winnerSide === 'CT' ? 'Counter-Terrorists' : 'Terrorists';
      winnerName = configuredName?.trim() || defaultSideName;
      winnerId = (winnerLogical === 'home' ? snapshot.teams.home_id : snapshot.teams.away_id) ?? undefined;
      await ctx.say(`[GG-Core] MATCH TERMINÉ ! Victoire de ${winnerName} (${snapshot.score.ct}-${snapshot.score.t}) !`);
    } else {
      await ctx.say(`[GG-Core] MATCH TERMINÉ ! Égalité (${snapshot.score.ct}-${snapshot.score.t}) !`);
    }

    // 3. Stop GOTV recording via RCON
    if (serverId) {
      try {
        await this.cmds.rcon({ serverId, matchId, command: 'tv_stoprecord' });
        this.log.log(`[endMatch] tv_stoprecord executed on server ${serverId}`);
      } catch (err: any) {
        this.log.warn(`[endMatch] tv_stoprecord failed: ${err?.message}`);
      }
    }

    // 4. Broadcast match:ended via WebSocket
    await this.push(matchId, 'match:ended', {
      matchId,
      winner: winnerName,
      winnerSide,
      winnerLogical,
      score: snapshot.score,
      teams: snapshot.teams,
      sides: snapshot.sides,
    });

    // 5. Tournament model (only for maps linked to the relational model): the game result (automatic, confirmed),
    //    then the series - BO1 / BO3 / BO5 advance the bracket through the same path as an admin entry.
    if (this.tournamentPersistence) {
      try {
        const homeSide = snapshot.sides?.home === 'T' ? 't' : 'ct';
        const awaySide = homeSide === 'ct' ? 't' : 'ct';
        const linkedMap = await this.state.getDbMatchMapId(matchId);
        const game = await this.tournamentPersistence.recordGameResult({
          matchMapId: linkedMap ?? (isUuid(matchId) ? matchId : null),
          scoreHome: snapshot.score[homeSide] ?? 0,
          scoreAway: snapshot.score[awaySide] ?? 0,
          winnerTeamId: winnerId ?? null,
          source: 'AUTOMATIC',
          status: 'CONFIRMED',
          reportedBy: 'cs2',
        });
        if (game) {
          await this.tournamentPersistence.updateSeries(game.matchId);
        } else if (winnerId && isUuid(winnerId)) {
          // No game row: the real-time id may directly be the UUID of a Match
          const dbMatchId = await this.tournamentPersistence.resolveBracketMatchId(matchId, null);
          if (dbMatchId) await this.tournamentPersistence.advanceBracketMatch(dbMatchId, winnerId);
        } else {
          this.log.debug(`[endMatch] match ${matchId} not linked to the tournament model: nothing recorded`);
        }
      } catch (err: any) {
        this.log.warn(`[endMatch] tournament result not recorded: ${err?.message}`);
      }
    }

    // 6. Server cleanup action (soft_reset vs restart), DELAYED: right after Game Over CS2 shows the end
    //    screen / scoreboard during its intermission. Resetting at once cut it and left players frozen
    //    (warmup started during the intermission) - observed on a real server.
    if (serverId) {
      const delaySec = settings.postgameResetDelaySec ?? DEFAULT_MATCH_SETTINGS.postgameResetDelaySec;
      this.log.log(`[endMatch] server ${serverId} reset (${settings.postgameAction}) in ${delaySec}s`);
      setTimeout(() => {
        this.resetServerAfterMatch(serverId, matchId, settings.postgameAction).catch((e) =>
          this.log.warn(`[endMatch] server reset failed: ${e?.message}`),
        );
      }, delaySec * 1000);

      // 7. Free the server: at the LAN people stay connected long after their match. 'restart' quits anyway.
      const kickSec = settings.postgameKickDelaySec ?? DEFAULT_MATCH_SETTINGS.postgameKickDelaySec;
      if (kickSec > 0 && settings.postgameAction !== 'restart') {
        this.log.log(`[endMatch] players of server ${serverId} kicked in ${kickSec}s`);
        setTimeout(() => {
          this.kickPlayersAfterMatch(serverId, matchId).catch((e) =>
            this.log.warn(`[endMatch] kick failed: ${e?.message}`),
          );
        }, kickSec * 1000);
      }
    }
  }

  /** True when a new match was started on this server since `matchId` ended: postgame actions must not touch it. */
  private async serverMovedOn(serverId: string, matchId: string): Promise<boolean> {
    const current = await this.state.getMatchIdFromServerId(serverId);
    if (current && current !== matchId) {
      this.log.log(`[endMatch] server ${serverId} now runs ${current}: postgame action skipped`);
      return true;
    }
    return false;
  }

  private async kickPlayersAfterMatch(serverId: string, matchId: string) {
    if (await this.serverMovedOn(serverId, matchId)) return;
    await this.cmds.kickAll({ serverId, message: "Match terminé, merci d'avoir joué ! Le serveur est libéré." });
  }

  private async resetServerAfterMatch(serverId: string, matchId: string, action: MatchSettings['postgameAction']) {
    // A new match may have been started on this server during the delay: never reset it.
    if (await this.serverMovedOn(serverId, matchId)) return;
    if (action === 'restart') {
      this.log.log(`[endMatch] Executing RCON quit to purge RAM and restart server ${serverId}`);
      await this.cmds.rcon({ serverId, matchId, command: 'quit' });
      return;
    }
    await this.cmds.rcon({ serverId, matchId, command: 'mp_warmup_start 1' });
    await this.execCfg({ serverId, matchId }, CS2_CFG.WARMUP);
  }
}
