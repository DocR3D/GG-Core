// src/application/match/match-orchestrator.service.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_PUB } from '@adapters/redis/redis.tokens';

import { PauseMatchService } from '@app/match/pause/pause-match.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { GameSide, MatchStateService, type Logical } from '@app/match/state/match-state.service';
import { WsBroadcaster } from '@adapters/ws/ws-broadcaster.service';
import { WsEventType } from '@adapters/ws/dto/events.dto';
import { Audience } from '@domain/types/internal-events';
import { SidesScoreService } from './state';
import { MatchPhase, RoundPhase } from '@domain/phase.types';
import { MatchPhaseService } from './phase/match-phase.service';
import { match } from 'assert';
import { RoundStartEvent, GenericMatchEvent, BombPlantedEvent, TeamRoundWinEvent, RoundFreezeStartEvent } from '@domain/types/match.event';
import { WarmupRule } from './rules/warmup.rule';
import { eventNames } from 'process';
import { checkServerIdentity } from 'tls';


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
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly sides: SidesScoreService,   // optionnel mais idéal
    @Inject(REDIS_PUB) private readonly pub: Redis,
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

    // programme un timer; à l’échéance on re-vérifie l’état et on resume si la banque est à 0
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
    if(await this.phase.getRoundPhase(matchId) != RoundPhase.FREEZE){
      this.cmds.say(serverId, "La demande de pause a été enregistré ! ");
      this.pause.pause(matchId,serverId,{reason:'tactical',team,armOnly:true});
      return { ok: true };
    }else{
    const { serverId, matchId } = await this.resolve(ids);

    // Autorisation (banque dispo, pas déjà en pause…)
    const chk = await this.pause.isPauseAllowed(matchId, { reason: 'tactical', team });
    if (!chk.allowed) return { ok: false, why: chk.why };
      // Côté in-game + état pause: laisse faire la commande haut-niveau existante
      // (elle publie l'action agent + pose l'état pause) :contentReference[oaicite:0]{index=0}
      await this.cmds.pause({ serverId, matchId});

      // Armer le timer auto-unpause depuis l’orchestrateur (V1 “solution 2”)
      // 👉 IMPORTANT : enlève le setTimeout interne actuel dans PauseMatchService.startTactical
      // pour éviter un double timer. :contentReference[oaicite:1]{index=1}
      this.pause.pause(matchId,serverId,{reason:'tactical',team})
      const bank = await this.pause.getTacBank(matchId, team);
      this.armAutoUnpause(matchId, serverId, bank);

      await this.notify('pause:started', { matchId, serverId, reason: 'tactical', team });
      return { ok: true };
    }
  }
  // src/application/match/match-orchestrator.service.ts (extrait)

  async applyPauseIfArmed(ev: (GenericMatchEvent & { serverId?: string; }) | (RoundFreezeStartEvent & { serverId?: string; })) {
    const res = await this.pause.consumeArmed(ev.matchId);
    if (res.consumed && res.pick) {
      // 1) Appliquer la pause côté état + messages périodiques
      await this.pause.pause(ev.matchId, ev.serverId!, { reason: 'tactical', team: res.pick.team });

      // 2) Demander la pause à l'agent (ingame)
      await this.cmds.pause(ev);

      if (res.pick.team !== 'system') {
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
    await this.cmds.unpause({ serverId, matchId }); // agent “unpause” + phase=live côté state existant :contentReference[oaicite:4]{index=4}

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
    this.phase.setRoundPhase(ev.matchId, RoundPhase.FREEZE);
    this.applyPauseIfArmed(ev);
  }
  onRoundEnd(ev: (TeamRoundWinEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
    this.phase.setRoundPhase(ev.matchId, RoundPhase.END);
    this.log.debug("Round ended !");
    }
  onBombPlanted(ev: (BombPlantedEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
    this.phase.setRoundPhase(ev.matchId, RoundPhase.BOMB_PLANTED);
    this.log.debug("Bomb planted !");
  }
  onRoundStart(ev: (RoundStartEvent & { serverId?: string; }) | (GenericMatchEvent & { serverId?: string; })) {
        this.phase.setRoundPhase(ev.matchId, RoundPhase.LIVE);
        this.log.debug("Round Live !");
  }

  startWarmup(serverId: string) {
    this.cmds.rcon({serverId,command: "mp_warmup_start"})
  }
  
}
