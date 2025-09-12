// src/application/commands/match-commands.service.ts
import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { MatchStateService } from '../state/match-state.service';
import { redisConst } from '../state/redis-keys';
import * as crypto from 'crypto';

// ⚠️ Idéalement, importe depuis un type canonique partagé (ex: @adapters/ws/dto/events.dto)
type TeamSide = 'CT' | 'T';
type Actor = { name: string; steamId?: string; teamSide: TeamSide; channel?: 'say' | 'say_team' };

type AgentAction =
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'tac_timeout';  payload: { matchId: string; teamSide: TeamSide; teamLogical: 'home'|'away'; seconds: number }; source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'tech_timeout'; payload: { matchId: string; seconds: number };                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'unpause';     payload: { matchId: string; teamSide?: TeamSide };                                  source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'say';         payload: { message: string };                                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'say_team';    payload: { team: TeamSide; message: string };                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'knife';       payload: { matchId: string };                                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'restart';     payload: { matchId: string; delay?: number };                                       source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'changelevel'; payload: { map: string };                                                          source?: any };

const agentActionsCh = (serverId: string) => `ggbot:agent:${serverId}:actions`;
function uuid() { return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex'); }

type MatchPhase =
  | 'idle' | 'warmup' | 'knife' | 'live' | 'halftime' | 'overtime'
  | 'paused' | 'timeout_t' | 'timeout_ct' | 'tech_pause' | 'ended';

interface InitOpts {
  phase?: MatchPhase;
  map?: string;
  seriesBestOf?: 1 | 3 | 5;
  reset?: boolean;
}

// Raccourcis vers les builders de clés
const matchSidesKey = redisConst.sides;
const matchScoreKey = redisConst.score;
const matchTosKey   = redisConst.timeouts;
const matchTeamsKey = redisConst.teams;
const matchStateKey = redisConst.state;
const matchClockKey = redisConst.clock;
const matchReadyKey = redisConst.ready;
const matchSeqKey   = redisConst.seq;

@Injectable()
export class MatchCommandsService {
  private readonly logger = new Logger(MatchCommandsService.name);

  constructor(
    private readonly ms: MatchStateService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
  ) {}

  // --------- Helpers

  private async publishToAgent(serverId: string, msg: AgentAction) {
    await this.pub.publish(agentActionsCh(serverId), JSON.stringify(msg));
    this.logger.log(`[to-agent/${serverId}] ${msg.action}`);
  }

  private async resolveServerAndMatch(params: { serverId?: string | null; matchId?: string | null; })
  : Promise<{ serverId: string; matchId: string }> {
    let { serverId, matchId } = params;

    if (!serverId && matchId) {
      serverId = await this.redis.get(redisConst.matchServer(matchId));
      if (!serverId) throw new BadRequestException('serverId manquant et introuvable via matchId');
    }
    if (serverId && !matchId) {
      matchId = await this.redis.get(redisConst.serverMatch(serverId));
      if (!matchId) throw new BadRequestException(`matchId introuvable pour serverId=${serverId}`);
    }
    if (!serverId || !matchId) throw new BadRequestException('serverId et/ou matchId manquant');
    return { serverId, matchId };
  }

  // --------- Actions principales

  async tacticalTimeout(opts: { serverId?: string; matchId?: string; actor: Actor; seconds?: number }) {
    const { actor } = opts;
    const seconds = Math.max(5, Math.min(60, opts.seconds ?? 30));
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);

    const logical = await this.ms.sideToLogical(matchId, actor.teamSide);
    if (!logical) {
      this.logger.warn(`[TACTICAL_TIMEOUT] SIDE_MISMATCH server=${serverId} match=${matchId} side=${actor.teamSide}`);
      return { ok: false, code: 'SIDE_MISMATCH' as const };
    }

    const left = await this.ms.decrTac(matchId, logical);
    if (left < 0) return { ok: false, code: 'TIMEOUTS_NOT_INITIALIZED' as const };
    if (left === 0) return { ok: false, code: 'TIMEOUTS_EXHAUSTED' as const };

    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'tac_timeout',
      payload: { matchId, teamSide: actor.teamSide, teamLogical: logical, seconds },
      source: { via: 'chat', player: actor },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true, remaining: left };
  }

  async technicalTimeout(opts: { serverId?: string; matchId?: string; seconds?: number; reason?: string,actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const seconds = Math.max(10, Math.min(180, opts.seconds ?? 60));
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'tech_timeout',
      payload: { matchId, seconds },
      source: { via: 'admin', reason: opts.reason ?? null },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  async unpause(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'unpause',
      payload: { matchId, teamSide: opts.actor?.teamSide },
      source: opts.actor ? { via: 'chat', player: opts.actor } : { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    await this.ms.setPhase(matchId, 'live'); // NEW: on reflète côté state
    return { ok: true };
  }

  async say(opts: { serverId: string; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'say', payload: { message: opts.message }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  async sayTeam(opts: { serverId: string; team: TeamSide; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'say_team', payload: { team: opts.team, message: opts.message }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  async knife(opts: { serverId?: string; matchId?: string }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'knife', payload: { matchId }, source: { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    await this.ms.setPhase(matchId, 'knife'); // NEW: refléter côté state
    return { ok: true };
  }

  async restart(opts: { serverId?: string; matchId?: string; delay?: number }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'restart', payload: { matchId, delay: opts.delay ?? 3 }, source: { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  async changeLevel(opts: { serverId: string; map: string }) {
    if (!opts.serverId || !opts.map) throw new BadRequestException('serverId et map requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'changelevel', payload: { map: opts.map }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  async bindServerToMatch(serverId: string, matchId: string) {
    const sid = String(serverId || '').trim();
    const mid = String(matchId || '').trim();
    if (!sid || !mid || mid === 'unknown') {
      throw new BadRequestException('serverId et matchId requis (matchId ≠ "unknown")');
    }
    await this.redis.set(redisConst.serverMatch(sid), mid);
    await this.redis.set(redisConst.matchServer(mid), sid);
    this.logger.log(`[bind] server=${sid} -> match=${mid}`);
    return { ok: true, serverId: sid, matchId: mid };
  }

  async ensureInitMatch(serverId: string, matchId?: string, sides?: { home: TeamSide; away: TeamSide }, opts: InitOpts = {}) {
    const sid = String(serverId || '').trim();
    if (!sid) throw new BadRequestException('serverId requis');

    const wantHome: TeamSide = sides?.home ?? 'CT';
    const wantAway: TeamSide = sides?.away ?? 'T';
    if (wantHome === wantAway) throw new BadRequestException(`sides invalides: home=${wantHome} away=${wantAway}`);

    let mid = String(matchId || '').trim();
    if (!mid || mid === 'unknown') {
      const seed = `${sid}-${Date.now()}`;
      mid = `m-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)}`;
    }

    const slug = mid.slice(2, 6);
    const teams = { home: { id: `th-${slug}`, name: `Home_${slug}` }, away: { id: `ta-${slug}`, name: `Away_${slug}` } };

    const phase: MatchPhase = opts.phase ?? 'warmup';
    const subphase = phase === 'knife' ? 'preknife' : phase === 'live' ? 'live_freeze' : '';

    const now = Date.now();
    const pipe = this.redis.multi();

    const hset = opts.reset ? (k: string, f: string, v: any) => pipe.hset(k, f, v) : (k: string, f: string, v: any) => pipe.hsetnx(k, f, v);
    const set  = opts.reset ? (k: string, v: any) => pipe.set(k, v)   : (k: string, v: any) => pipe.setnx(k, v);

    pipe.set(redisConst.serverMatch(sid), mid);
    pipe.set(redisConst.matchServer(mid), sid);

    hset(matchSidesKey(mid), 'home', wantHome);
    hset(matchSidesKey(mid), 'away', wantAway);
    hset(matchScoreKey(mid), 'ct', 0);
    hset(matchScoreKey(mid), 't', 0);

    hset(matchTosKey(mid), 'homeTac', 4);
    hset(matchTosKey(mid), 'awayTac', 4);
    hset(matchTosKey(mid), 'homeTech', 0);
    hset(matchTosKey(mid), 'awayTech', 0);

    set(matchTeamsKey(mid), JSON.stringify(teams));

    hset(matchStateKey(mid), 'phase', phase);
    hset(matchStateKey(mid), 'subphase', subphase);
    hset(matchStateKey(mid), 'round', 0);
    hset(matchStateKey(mid), 'ot', 0);
    if (opts.map)          hset(matchStateKey(mid), 'map', opts.map);
    if (opts.seriesBestOf) hset(matchStateKey(mid), 'seriesBestOf', opts.seriesBestOf);
    hset(matchStateKey(mid), 'seriesHome', 0);
    hset(matchStateKey(mid), 'seriesAway', 0);
    hset(matchStateKey(mid), 'whoPaused', 'none');
    hset(matchStateKey(mid), 'pauseReason', '');
    hset(matchStateKey(mid), 'requesterName', '');
    hset(matchStateKey(mid), 'requesterSteamId', '');
    hset(matchStateKey(mid), 'lastUpdateTs', now);

    hset(matchClockKey(mid), 'phaseEndsAt', 0);
    hset(matchClockKey(mid), 'pauseEndsAt', 0);
    hset(matchClockKey(mid), 'roundFreezeMs', 15000);
    hset(matchClockKey(mid), 'tacTimeoutMs', 30000);
    hset(matchClockKey(mid), 'techTimeoutMs', 0);
    hset(matchClockKey(mid), 'createdAt', now);

    hset(matchReadyKey(mid), 'home', 0);
    hset(matchReadyKey(mid), 'away', 0);

    set(matchSeqKey(mid), '0');

    await pipe.exec();

    this.logger.log(
      `[init] server=${sid} match=${mid} sides=${wantHome}/${wantAway} phase=${phase} reset=${!!opts.reset}` +
      (opts.map ? ` map=${opts.map}` : '') +
      (opts.seriesBestOf ? ` bo${opts.seriesBestOf}` : '')
    );

    return { ok: true, serverId: sid, matchId: mid, sides: { home: wantHome, away: wantAway }, teams,
      state: { phase, subphase, round: 0, ot: 0, map: opts.map ?? null, seriesBestOf: opts.seriesBestOf ?? null } };
  }

  // ---------------- ALIAS demandés par le ChatCommandHandler ----------------

  // NEW: !start → on met la phase à live + on demande unpause à l’agent
  async startLive(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.ms.setPhase(matchId, 'live');
    await this.unpause({ serverId, matchId, actor: opts.actor });
    return { ok: true };
  }

  // NEW: !knife → alias qui appelle knife()
  async startKnife(opts: { serverId?: string; matchId?: string, actor?: Actor }) {
    return this.knife(opts);
  }

  // NEW: !restart → alias qui appelle restart()
  async restartGame(opts: { serverId?: string; matchId?: string; delay?: number, actor?: Actor }) {
    return this.restart(opts);
  }

  // NEW: !ready / !unready → on marque le ready par logique (home/away) selon la side du joueur
  async setReady(opts: { serverId?: string; matchId?: string; actor: Actor; ready: boolean }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const logical = await this.ms.sideToLogical(matchId, opts.actor.teamSide);
    if (!logical) throw new BadRequestException('Impossible de résoudre la logique (home/away)');
    await this.redis.hset(matchReadyKey(matchId), logical === 'home' ? 'home' : 'away', opts.ready ? 1 : 0);
    await this.say({ serverId, message: `[ready] ${opts.actor.name} -> ${opts.ready ? 'ready' : 'not ready'}` });
    return { ok: true };
  }

  // NEW: !stop → on met fin au match (phase=ended) et petit message serveur
  async stopMatch(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.ms.setPhase(matchId, 'ended');
    await this.say({ serverId, message: '[match] stopped by admin' });
    return { ok: true };
  }
}
