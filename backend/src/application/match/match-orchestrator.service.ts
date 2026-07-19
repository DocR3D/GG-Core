// src/application/match/match-orchestrator.service.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { MatchRepository } from '@adapters/postgres/match.repository';
import { MatchHistoryRepository } from '@adapters/postgres/match-history.repository';
import { SeriesRepository } from '@adapters/postgres/series.repository';
import { SeriesStateService } from './state/series-state.service';


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
    private readonly sides: SidesScoreService,
    @Inject(forwardRef(() => RuleContextFactory))
    private readonly ctxFactory: RuleContextFactory,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly matchRepo: MatchRepository,
    private readonly historyRepo: MatchHistoryRepository,
    private readonly seriesRepo: SeriesRepository,
    private readonly seriesState: SeriesStateService,
  ) {}

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
    await this.pub.publish('ggbot:events', JSON.stringify({ v: 1, type, timestamp: Date.now(), ...payload }));
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
  // src/application/match/match-orchestrator.service.ts (extrait)

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


  async execCfg(
    ids: { matchId?: string; serverId?: string },
    cfgName: string,
    ) {
        const { serverId, matchId } = await this.resolve(ids); // résout ce qui manque
        await this.cmds.exec({ serverId, cfgName, matchId}); // appelle le service I/O
    }

    // (optionnel) version séquencée, utile pour enchaîner plusieurs cfgs proprement
    async execCfgs(
    ids: { matchId?: string; serverId?: string },
    cfgs: string[],
    gapMs = 300
    ) {
    for (const name of cfgs) {
        await this.execCfg(ids, name);
        if (gapMs) await new Promise(r => setTimeout(r, gapMs));
    }
  }


    // pauseTechnical (Logical only en V1)
  async pauseTechnical(ids: { serverId?: string|null; matchId?: string|null }, team: Logical) {
      const { serverId, matchId } = await this.resolve(ids);
      await this.cmds.pause({ serverId, matchId});
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

    await this.pause.resume(matchId);        // débit banque + stop périodiques + reset état :contentReference[oaicite:3]{index=3}
    await this.cmds.unpause({ serverId, matchId }); // agent "unpause" + phase=live côté state existant :contentReference[oaicite:4]{index=4}

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
        audience?: Audience, // optionnel si ton WsBroadcaster le supporte
    ) {
        await this.ws.push(matchId,wsEventType, payload, audience);
    }

  /** Push le snapshot de match courant (convenience) */
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
        return this.state.applyKnifeResult(matchId,winnerFromEvent);
    }
    startPhaseCountdown(matchId: string, nextPhase: MatchPhase, seconds: number, serverId: string) {
        return this.phase.startPhaseCountdown(matchId,nextPhase,seconds,serverId);
    }
    logicalToSide(matchId: string, logicalTeam: Logical) {
       return  this.state.logicalToSide(matchId,logicalTeam)
    }
    rcon(opts: { serverId: string; matchId: string; command: string; }) {
        return this.cmds.rcon(opts);
    }
    restartGame(opts: { serverId: string; matchId: string; delay: number; }) {
        return this.cmds.restartGame(opts)
    }

    isBothReady(matchId: string) {
        return this.phase.isBothReady(matchId);
    }
    setReady(matchId: string, team: any, ready: boolean) {
        return this.phase.setReady(matchId,team, ready);
    }
    getKnifeResult(matchId: string) {
        return this.state.getKnifeResult(matchId);
    }
    roundEnd(matchId: string, winner: GameSide) {
        return this.state.roundEnd(matchId, winner);
    }
    swapSides(matchId: string) {
      this.cmds.swapSides({matchId});
        return this.state.swapSides(matchId);
    }

  async onFreezeTimeStart(ev: (GenericMatchEvent & { serverId?: string; }) | (RoundFreezeStartEvent & { serverId?: string; })) {
    this.log.debug("Freeze time started !")
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.FREEZE);
    await this.applyPauseIfArmed(ev);
  }
  async onRoundEnd(ev: (TeamRoundWinEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.END);
    this.log.debug("Round ended !");

    const matchPhase = await this.phase.getPhase(ev.matchId);
    const isKnifeRound = matchPhase === MatchPhase.KNIFE_LIVE || matchPhase === MatchPhase.KNIFE_WARMUP;

    if (isKnifeRound) {
      this.log.debug(`[${ev.matchId}] Round couteau ignoré (phase=${matchPhase})`);
      return;
    }

    // Persistance PostgreSQL : score + MatchHistory
    try {
      const snapshot = await this.state.getSnapshot(ev.matchId);
      const dbId = await this.matchRepo.findDbIdByRedisId(ev.matchId);
      if (dbId !== null) {
        await this.matchRepo.updateScore(dbId, snapshot.score.home, snapshot.score.away);
        await this.historyRepo.insert({
          id_match: dbId,
          event_type: 'round:end',
          round: snapshot.score.round,
          score_equipe1: snapshot.score.home,
          score_equipe2: snapshot.score.away,
          id_ct: snapshot.homeIsct ? snapshot.teams.home.id : snapshot.teams.away.id,
          id_t:  snapshot.homeIsct ? snapshot.teams.away.id : snapshot.teams.home.id,
          data: { ...(ev as any) },
        });
      }
    } catch (e) {
      this.log.warn(`[${ev.matchId}] Erreur persistance round:end: ${e}`);
    }
  }
  async onRoundEndScore(ev: GenericMatchEvent & { serverId?: string }): Promise<void> {
    const matchPhase = await this.phase.getPhase(ev.matchId);
    if (matchPhase === MatchPhase.KNIFE_LIVE || matchPhase === MatchPhase.KNIFE_WARMUP) {
      this.log.debug(`[${ev.matchId}] ROUND_END score ignoré — round couteau (phase=${matchPhase})`);
      return;
    }

    const payload = ev.payload as { scoreCt?: number; scoreT?: number };
    const scoreCt = payload?.scoreCt ?? 0;
    const scoreT  = payload?.scoreT  ?? 0;

    // Mise à jour Redis (score autoritaire CS2 — teamId=3 CT, teamId=2 T)
    await this.state.setScoreFromTeamEvent(ev.matchId, 3, scoreCt);
    await this.state.setScoreFromTeamEvent(ev.matchId, 2, scoreT);

    // Mise à jour DB (corrige la valeur potentiellement périmée écrite par onRoundEnd)
    const snapshot = await this.state.getSnapshot(ev.matchId);
    try {
      const dbId = await this.matchRepo.findDbIdByRedisId(ev.matchId);
      if (dbId !== null) {
        const homeScore = snapshot.homeIsct ? scoreCt : scoreT;
        const awayScore = snapshot.homeIsct ? scoreT  : scoreCt;
        await this.matchRepo.updateScore(dbId, homeScore, awayScore);
        this.log.debug(`[${ev.matchId}] ROUND_END score DB corrigé: home=${homeScore} away=${awayScore}`);
      }
    } catch (e) {
      this.log.warn(`[${ev.matchId}] Erreur persistance ROUND_END score: ${e}`);
    }

    // Push WS score:update
    await this.push(ev.matchId, 'score:update', {
      score:    snapshot.score,
      homeIsct: snapshot.homeIsct,
      teams:    snapshot.teams,
    });
  }

  async onBombPlanted(ev: (BombPlantedEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
    await this.phase.setRoundPhase(ev.matchId, RoundPhase.BOMB_PLANTED);
    this.log.debug("Bomb planted !");
  }

  async onRoundStart(ev: (RoundStartEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
        this.phase.setRoundPhase(ev.matchId, RoundPhase.LIVE);


        const ctx = this.ctxFactory.make({ matchId: ev.matchId, serverId: ev.serverId });
        const s = await ctx.state.getSnapshot(ctx.matchId); 
        const ctBank = (s.homeIsct ? s.economy.home_bank : s.economy.away_bank) ?? 0;
        const tBank  = (s.homeIsct ? s.economy.away_bank : s.economy.home_bank) ?? 0;
        const ctLS   = (s.homeIsct ? s.economy.home_loss_streak : s.economy.away_loss_streak) ?? 0;
        const tLS    = (s.homeIsct ? s.economy.away_loss_streak : s.economy.home_loss_streak) ?? 0;
        const ctTeam = s.homeIsct ? s.teams.home : s.teams.away;
        const tTeam  = s.homeIsct ? s.teams.away : s.teams.home;

        this.log.log(
          `ROUND ${s.score.round} [${s.score.phase}] | CT:${ctTeam.name} ${s.score.home} (bank=${ctBank},ls=${ctLS}) | ` +
          `T:${tTeam.name} ${s.score.away} (bank=${tBank},ls=${tLS}) | match=${s.matchId}`
        );

        this.log.debug("Round Live !");
  }

  startWarmup(serverId: string) {
    this.cmds.rcon({serverId,command: "mp_warmup_start"})
  }

  setPhase(matchId: string, phase: Phase) {
    this.sides.setPhase(matchId,phase)
  }
  async getPhase(matchId: string) {
    return this.sides.getPhase(matchId)
  }

  async onTeamSwap(ev: GenericMatchEvent & { serverId?: string }): Promise<void> {
    await this.sides.forceSideSwap(ev.matchId);
    this.log.debug(`[${ev.matchId}] TEAM_SWAP → sides swapped`);
    const snapshot = await this.state.getSnapshot(ev.matchId);
    await this.push(ev.matchId, 'sides:swapped', {
      homeIsct: snapshot.homeIsct,
      teams:    snapshot.teams,
      score:    snapshot.score,
    });
  }

  async onMatchStatusScore(ev: GenericMatchEvent & { serverId?: string }): Promise<void> {
    const payload = ev.payload as { roundsPlayed?: number };
    if (typeof payload?.roundsPlayed === 'number' && payload.roundsPlayed >= 0) {
      await this.state.setRound(ev.matchId, payload.roundsPlayed + 1);
      this.log.debug(`[${ev.matchId}] match_status_score → round=${payload.roundsPlayed + 1}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle — halftime / overtime / fin de match
  // ---------------------------------------------------------------------------

  /**
   * Déclenché quand le score atteint maxRounds/2 sans vainqueur (mi-temps).
   * Swap des sides Redis + transition de phase vers HALFTIME.
   */
  async runHalftime(matchId: string): Promise<void> {
    try {
      const { serverId } = await this.resolve({ matchId });
      // Swap sides en Redis (CT ↔ T)
      await this.state.swapSides(matchId);
      // Swap côté CS2 via RCON
      await this.cmds.swapSides({ matchId });
      // Transition phase
      await this.phase.startPhaseCountdown(matchId, MatchPhase.HALFTIME, 3, serverId);
      await this.push(matchId, 'match:halftime', {});
      this.log.log(`[${matchId}] Halftime déclenché`);
    } catch (e) {
      this.log.error(`[${matchId}] runHalftime erreur: ${e}`);
    }
  }

  /**
   * Déclenché quand la régulation se termine sur une égalité avec overtime activé.
   * Transition de phase vers OVERTIME.
   */
  async runOvertime(matchId: string): Promise<void> {
    try {
      const { serverId } = await this.resolve({ matchId });
      const config = await this.state.getMatchConfig(matchId);
      // Configurer l'OT côté CS2
      await this.cmds.rcon({
        serverId,
        matchId,
        command: `mp_overtime_enable 1; mp_overtime_maxrounds ${config.maxRounds}`,
      });
      // Transition phase
      await this.phase.startPhaseCountdown(matchId, MatchPhase.OVERTIME, 3, serverId);
      await this.push(matchId, 'match:overtime', { config });
      this.log.log(`[${matchId}] Overtime déclenché (maxRounds=${config.maxRounds})`);
    } catch (e) {
      this.log.error(`[${matchId}] runOvertime erreur: ${e}`);
    }
  }

  /**
   * Fin définitive du match (vainqueur de régulation ou défaut d'overtime).
   * - Transition vers POSTGAME
   * - Broadcast WS match:ended
   * - Marque le match 'finished' en base PostgreSQL
   * - Libère la liaison Redis serveur ↔ match
   */
  async triggerMatchEnd(matchId: string, reason: string): Promise<void> {
    try {
      const { serverId } = await this.resolve({ matchId });

      // 1. Transition phase → POSTGAME
      await this.phase.startPhaseCountdown(matchId, MatchPhase.POSTGAME, 0, serverId);

      // 2. Snapshot final + broadcast WS
      const snapshot = await this.state.getSnapshot(matchId);
      await this.push(matchId, 'match:ended', { reason, score: snapshot.score });

      // 3. Marquer le match comme terminé en base
      const dbId = await this.matchRepo.findDbIdByRedisId(matchId);
      if (dbId !== null) {
        await this.matchRepo.updateStatus(dbId, 'finished');
      }

      // 4. Progression de série (si le match appartient à une série)
      const matchCfg = await this.state.getMatchConfig(matchId);
      if (matchCfg.seriesId) {
        await this.handleSeriesProgress(matchId, serverId, matchCfg.seriesId, snapshot);
        return; // le serveur est libéré dans handleSeriesProgress si la série est terminée
      }

      // 5. Libérer le serveur — seulement pour les matchs hors-série
      await this.state.freeServer(matchId);

      this.log.log(`[${matchId}] Match terminé (reason=${reason}) — serveur libéré`);
    } catch (e) {
      this.log.error(`[${matchId}] triggerMatchEnd erreur: ${e}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Progression de série (Bo3/Bo5)
  // ---------------------------------------------------------------------------

  private async handleSeriesProgress(
    matchId: string,
    serverId: string,
    seriesId: string,
    snapshot: Awaited<ReturnType<MatchStateService['getSnapshot']>>,
  ): Promise<void> {
    try {
      // 1. Gagnant de la map (home > away → home gagne)
      const mapWinner: 'home' | 'away' =
        snapshot.score.home > snapshot.score.away ? 'home' : 'away';

      // 2. Incrémenter le score de série en Redis + DB
      const scores    = await this.seriesState.addWin(seriesId, mapWinner);
      const seriesDbId = await this.seriesState.getDbId(seriesId);
      if (seriesDbId !== null) {
        await this.seriesRepo.updateScores(seriesDbId, scores.home, scores.away);
      }

      const seriescfg = await this.seriesState.getSeriesConfig(seriesId);
      if (!seriescfg) {
        this.log.warn(`[${matchId}] handleSeriesProgress: config série ${seriesId} introuvable`);
        await this.state.freeServer(matchId);
        return;
      }

      // 3. Vérifier si la série est terminée
      if (this.seriesState.isOver(seriescfg.bo, scores)) {
        const winner = this.seriesState.winner(seriescfg.bo, scores)!;
        if (seriesDbId !== null) {
          await this.seriesRepo.updateStatus(seriesDbId, 'finished', winner);
        }
        await this.push(matchId, 'series:ended', { seriesId, winner, scores });
        await this.state.freeServer(matchId);
        this.log.log(`[${seriesId}] Série terminée — gagnant=${winner} scores=${JSON.stringify(scores)}`);
        return;
      }

      // 4. Série continue → prochaine map
      const maps     = await this.seriesState.getMaps(seriesId);
      const matchCfg = await this.state.getMatchConfig(matchId);
      const currentNumber = matchCfg.mapNumber;
      const nextNumber    = currentNumber + 1;
      const nextMap       = maps[nextNumber - 1];

      if (!nextMap) {
        this.log.warn(`[${seriesId}] Pas de map ${nextNumber} configurée — série arrêtée`);
        await this.state.freeServer(matchId);
        return;
      }

      const isDecidingMap = nextNumber === seriescfg.bo;
      const nextMatchId   = 'm-' + randomUUID().replace(/-/g, '').slice(0, 12);

      this.log.log(
        `[${seriesId}] Map ${currentNumber} terminée — lancement map ${nextNumber} (${nextMap.map}) ` +
        `isDeciding=${isDecidingMap} match=${nextMatchId}`,
      );

      // 5. Enregistrer le nouveau matchId dans Redis série
      await this.seriesState.setCurrentMatch(seriesId, nextNumber, nextMatchId);

      // 6. Changer de map sur le serveur CS2 (changelevel + warmup via init.cfg)
      await this.cmds.initMatch({ serverId, matchId: nextMatchId, map: nextMap.map });

      // 7. Init Redis pour le nouveau match
      const homeSide = nextMap.ctTeamLogical === 'home' ? 'CT' as const : 'T' as const;
      await this.state.setSides(nextMatchId, { home: homeSide, away: homeSide === 'CT' ? 'T' : 'CT' });
      await this.state.initScore(nextMatchId);
      await this.state.initTimeouts(nextMatchId, 4, 4, 0, 0);
      await this.state.setTeams(nextMatchId, {
        home_id:   seriescfg.homeId,
        away_id:   seriescfg.awayId,
      });
      await this.state.setMatchConfig(nextMatchId, {
        overtimeEnabled: seriescfg.overtimeEnabled,
        isDecidingMap,
        seriesId,
        mapNumber: nextNumber,
      });
      await this.state.setServerIdToMatchId(serverId, nextMatchId);

      // 8. Créer la ligne Match en DB
      const tournamentId = await this._resolveTournoiId(seriesDbId);
      await this.matchRepo.insert({
        match_redis_id: nextMatchId,
        id_tournoi:     tournamentId,
        series_id:      seriesDbId ?? undefined,
        map_number:     nextNumber,
        equipe1:        seriescfg.homeId,
        equipe2:        seriescfg.awayId,
      });

      // 9. Phase WARMUP_MAIN pour le nouveau match (l'agent reçoit changelevel → init map)
      this.phase.startPhaseCountdown(nextMatchId, MatchPhase.WARMUP_MAIN, 30, serverId);

      // 10. Broadcast WS
      await this.push(matchId, 'series:next_map', {
        seriesId,
        mapNumber: nextNumber,
        map:       nextMap.map,
        matchId:   nextMatchId,
        scores,
      });

    } catch (e) {
      this.log.error(`[${matchId}] handleSeriesProgress erreur: ${e}`);
      await this.state.freeServer(matchId);
    }
  }

  /** Retrouve le tournoiId depuis la DB série, ou null. */
  private async _resolveTournoiId(seriesDbId: number | null): Promise<number | null> {
    if (seriesDbId === null) return null;
    try {
      const row = await this.seriesRepo.findById(seriesDbId);
      return row?.id_tournoi ?? null;
    } catch {
      return null;
    }
  }

}
