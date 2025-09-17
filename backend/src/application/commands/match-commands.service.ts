// src/application/commands/match-commands.service.ts
import { Injectable, Logger, Inject, BadRequestException, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { GameSide, Logical, MatchStateService } from '../match/state/match-state.service';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';

import { redisConst } from '../match/state/redis-keys';
import * as crypto from 'crypto';
import { PauseMatchService } from '@app/match/pause/pause-match.service';
import { ACTIONS_PORT } from '@app/ports/actions.port';
import { MatchPhase } from '@domain/phase.types';

// ⚠️ Idéalement, importe depuis un type canonique partagé (ex: @adapters/ws/dto/events.dto)
type Actor = { name: string; steamId?: string; teamSide: GameSide; channel?: 'say' | 'say_team' };
type Phase = 'warmup' | 'knife'| 'knife_decision' | 'live' | 'halftime' | 'overtime' | 'postgame';


type NextPhaseContext = {
  knifeEnabled?: boolean;   // défaut: true
  halftimePlayed?: boolean; // défaut: false (on n’a pas encore fait la mi-temps)
  needOvertime?: boolean;   // défaut: false (set à true si égalité en fin de temps réglementaire)
};

const DEFAULT_CTX: Required<NextPhaseContext> = {
  knifeEnabled: true,
  halftimePlayed: false,
  needOvertime: false,
};
type AgentAction =
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'pause';        payload: { matchId: string};}
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'unpause';      payload: { matchId: string; teamSide?: GameSide };                                  source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'say';          payload: { text: string };                                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'say_team';     payload: { team: GameSide; text: string };                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'knife';        payload: { matchId: string };                                                      source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'restart';      payload: { matchId: string; delay?: number };                                       source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'exec_cfg';     payload: { matchId: string;name: string;vars?: Record<string, string>;  };   source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'rcon';         payload: { text: string };                                                             source?: any }
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'changelevel';  payload: { map: string };                                                          source?: any };

const agentActionsCh = (serverId: string) => `ggbot:agent:${serverId}:actions`;
function uuid() { return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex'); }

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
const matchClockKey = redisConst.clock;
const matchReadyKey = redisConst.ready;
const matchSeqKey   = redisConst.seq;

@Injectable()
export class MatchCommandsService {
  runPostgame(matchId: string, serverId: string | undefined) {
  }
  runOvertime(matchId: string, serverId: string | undefined) {
  }
  runHalftime(matchId: string, serverId: string | undefined) {
  }
  runLive(matchId: string, serverId: string | undefined) {
  }
  private readonly logger = new Logger(MatchCommandsService.name);

  constructor(
    private readonly ms: MatchStateService,
    @Inject(forwardRef(() => MatchPhaseService))
    private readonly mps: MatchPhaseService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly pauseMatchService: PauseMatchService
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


  async pause(opts: { serverId?: string; matchId?: string; }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId,
      action: 'pause',
      payload: { matchId },
    };

    // 👉 On envoie l'action à l'agent, et C'EST TOUT.
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

    // ✅ Ici oui: on clôt la pause côté état/messages
    await this.pauseMatchService.resume(matchId);

    // ❌ NE PAS forcer la phase:
    // await this.ms.setPhase(matchId, 'live');

    return { ok: true };
  }


  async say(serverId: string, message: string) {
    let opts = {serverId,message}
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'say', payload: { text: opts.message }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return;
  }

  async sayTeam(opts: { serverId: string; team: GameSide; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'say_team', payload: { team: opts.team, text: opts.message }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return ;
  }

  async exec(opts: { serverId?: string; matchId?: string; cfgName: string, vars?: Record<string,string> }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'exec_cfg',
      payload: {
        matchId,
        name: opts.cfgName,   // ⬅️ fichier à exécuter
        ...(opts.vars ? { vars: opts.vars } : {}) // optionnel: variables du cfg
      },
      source: { via: 'admin' },
    };
    
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  async rcon(opts: { serverId?: string; matchId?: string; command: string}) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(), ts: Date.now(), type: 'action', serverId: opts.serverId,
      action: 'rcon', payload: { text: opts.command }, source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
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

/**
   * Nouvelle signature :
   *  - serverId (obligatoire)
   *  - matchId (optionnel)
   *  - mapName (optionnel → par défaut "de_inferno")
   *  - homeName (optionnel → par défaut "Home_<slug>")
   *  - awayName (optionnel → par défaut "Away_<slug>")
   */
  async ensureInitMatch(
    serverId: string,
    matchId?: string,
    mapName?: string,
    homeName?: string,
    awayName?: string,
    opts: InitOpts = {},
  ) {
    const sid = String(serverId || '').trim();
    if (!sid) throw new BadRequestException('serverId requis');

    // sides par défaut : home=CT, away=T (on ne les demande plus à la commande)
    const wantHome: GameSide = 'CT';
    const wantAway: GameSide = 'T';

    let mid = String(matchId || '').trim();
    if (!mid || mid === 'unknown') {
      const seed = `${sid}-${Date.now()}`;
      mid = `m-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)}`;
    }

    const slug = mid.slice(2, 6);

    const home_name = (homeName ?? `Home_${slug}`).trim();
    const away_name = (awayName ?? `Away_${slug}`).trim();

    const teams = {
      home: { id: `th-${slug}`, name: home_name },
      away: { id: `ta-${slug}`, name: away_name },
    };

    const map_name = (mapName ?? opts.map ?? 'de_inferno').trim();

    const now = Date.now();
    const pipe = this.redis.multi();

    // helpers "nx ou pas" selon reset
    const hset = opts.reset
      ? (k: string, f: string, v: any) => pipe.hset(k, f, v)
      : (k: string, f: string, v: any) => pipe.hsetnx(k, f, v);

    const set = opts.reset
      ? (k: string, v: any) => pipe.set(k, v)
      : (k: string, v: any) => pipe.setnx(k, v);

    // liens server <-> match
pipe.set(redisConst.serverMatch(sid), mid);   // ← pas de NX
pipe.set(redisConst.matchServer(mid), sid);   // ← pas de NX

    // sides (toujours hash)
    hset(redisConst.sides(mid), 'home', wantHome);
    hset(redisConst.sides(mid), 'away', wantAway);

    // score (hash)
    hset(redisConst.score(mid), 'ct', 0);
    hset(redisConst.score(mid), 't', 0);
    hset(redisConst.score(mid), 'round', 1);
    hset(redisConst.score(mid), 'phase', 'freeze');

    // timeouts (banques tactiques) — hash
    hset(redisConst.timeouts(mid), 'homeTac', 4);
    hset(redisConst.timeouts(mid), 'awayTac', 4);
    hset(redisConst.timeouts(mid), 'homeTech', 0);
    hset(redisConst.timeouts(mid), 'awayTech', 0);

    // teams en HASH (plus de JSON string)
    hset(redisConst.teams(mid), 'home_id', teams.home.id);
    hset(redisConst.teams(mid), 'home_name', teams.home.name);
    hset(redisConst.teams(mid), 'away_id', teams.away.id);
    hset(redisConst.teams(mid), 'away_name', teams.away.name);
    // ct_id / t_id optionnels (souvent dérivés via sides) — on les laisse vides ici

    // map en HASH
    hset(redisConst.map(mid), 'name', map_name);
    hset(redisConst.map(mid), 'set_at', String(now));

    // horloges (hash)
    hset(redisConst.clock(mid), 'phaseEndsAt', 0);
    hset(redisConst.clock(mid), 'pauseEndsAt', 0);
    hset(redisConst.clock(mid), 'roundFreezeMs', 15000);
    hset(redisConst.clock(mid), 'tacTimeoutMs', 30000);
    hset(redisConst.clock(mid), 'techTimeoutMs', 0);
    hset(redisConst.clock(mid), 'createdAt', now);

    // ready flags (hash)
    hset(redisConst.ready(mid), 'home', 0);
    hset(redisConst.ready(mid), 'away', 0);

    // séquence (string)
    set(redisConst.seq(mid), '0');

    await pipe.exec();

    // init banques tactiques dans pause service (si tu utilises ce modèle)
    await this.pauseMatchService.initTacBanks(mid);

    this.logger.log(
      `[init] server=${sid} match=${mid} sides=${wantHome}/${wantAway} map=${map_name} phase=${MatchPhase.WARMUP_MAIN} reset=${!!opts.reset}` +
      (opts.seriesBestOf ? ` bo${opts.seriesBestOf}` : ''),
    );

    // démarrage immédiat en warmup
    this.mps.startPhaseCountdown(mid, MatchPhase.WARMUP_MAIN, 0, sid);

    return { matchId: mid, map: map_name, home: teams.home, away: teams.away };
  }

  // ---------------- ALIAS demandés par le ChatCommandHandler ----------------

  // NEW: !start → on met la phase à live + on demande unpause à l’agent
  async startLive(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.unpause({ serverId, matchId, actor: opts.actor });
    return { ok: true };
  }


  // NEW: !restart → alias qui appelle restart()
  async restartGame(opts: { serverId?: string; matchId?: string; delay?: number, actor?: Actor }) {
    return this.restart(opts);
  }

  async setReady(opts: { serverId?: string; matchId?: string; actor: Actor; ready: boolean }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const logical = await this.ms.sideToLogical(matchId, opts.actor.teamSide);
    if (!logical) throw new BadRequestException('Impossible de résoudre la logique (home/away)');

    const key = matchReadyKey(matchId);
    const field = logical === 'home' ? 'home' : 'away';

    // 🔹 Récupération de l'ancien statut
    const oldVal = await this.redis.hget(key, field);
    const oldReady = oldVal === '1'; // true si 1, false sinon
    const oldStatus = oldVal == null ? 'unset' : (oldReady ? 'ready' : 'not ready');

    // 🔹 Mise à jour
    await this.redis.hset(key, field, opts.ready ? 1 : 0);
    const newStatus = opts.ready ? 'ready' : 'not ready';

    // 🔹 Message
    await this.say(
      serverId,
      `[status] ${opts.actor.name}: ${oldStatus} → ${newStatus}`
    );
    if (!opts.ready) {
      await this.mps.cancelPhaseCountdown(matchId, 'team_unready');
    }

  const values = await this.redis.hgetall(matchReadyKey(matchId));
  if(values.home === '1' && values.away === '1'){ 
    const current = await this.redis.get(redisConst.phase(matchId));
    const next = resolveNextPhase(current as Phase); // p.ex. 'knife' -> 'live'
    await this.mps.startPhaseCountdown(matchId, next, 5, serverId);
  }


    return { ok: true };
  }
  

  // NEW: !stop → on met fin au match (phase=ended) et petit message serveur
  async stopMatch(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.ms.setPhase(matchId, 'ended');
    await this.say( serverId, '[match] stopped by admin');
    return { ok: true };
  }

  async  swapSides(opts: { matchId: string }): Promise<void>{
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    this.rcon({
      serverId,
      matchId:opts.matchId,
      command:"mp_swapteams"
    })

  }

}
/**
 * Détermine la phase suivante, en pure function.
 * - Si current est null/undefined: on démarre par knife (si activé), sinon live.
 * - knife -> live (1ère mi-temps)
 * - live -> halftime (si pas encore jouée), sinon overtime (si égalité), sinon postgame
 * - halftime -> live (2nde mi-temps)
 * - overtime -> postgame (par défaut) ; si tu gères plusieurs OT successifs, appelle à nouveau avec needOvertime=true
 * - postgame -> postgame (idempotent)
 */
export function resolveNextPhase(
  current: Phase | null | undefined,
  ctx?: NextPhaseContext
): MatchPhase {
  const C = { ...DEFAULT_CTX, ...(ctx || {}) };

  if (!current) {
    return C.knifeEnabled ? MatchPhase.KNIFE_LIVE : MatchPhase.LIVE_MAIN;
  }

  switch (current) {
    case 'knife':
      // Après le knife, on passe live (1ère mi-temps)
      return MatchPhase.KNIFE_CHOICE;

    case 'knife_decision':
      return MatchPhase.LIVE_MAIN

    case 'postgame':
    default:
      return MatchPhase.KNIFE_CHOICE;
  }
}

