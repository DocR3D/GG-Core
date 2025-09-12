// src/application/subscribers/match-commands.service.ts
import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { MatchStateService } from '../state/match-state.service';
import * as crypto from 'crypto';

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

const agentActionsCh = (serverId: string) => `ggbot:agent:${serverId}:actions`;  // canal par serveur
const serverMatchKey  = (serverId: string) => `match:byServer:${serverId}`;      // bind serveur → match

function uuid() { return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex'); }

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

  private async resolveServerAndMatch(params: {
    serverId?: string | null;
    matchId?: string | null;
  }): Promise<{ serverId: string; matchId: string }> {
    let { serverId, matchId } = params;

    if (!serverId && matchId) {
      // Cherche un serveur lié à ce match (optionnel si tu stockes aussi match→server)
      // Ici on ne scanne pas. On force donc l’appelant à fournir serverId pour ce cas.
      throw new BadRequestException('serverId manquant (impossible de dériver depuis matchId)');
    }

    if (serverId && !matchId) {
      matchId = await this.redis.get(serverMatchKey(serverId));
      if (!matchId) throw new BadRequestException(`matchId introuvable pour serverId=${serverId}`);
    }

    if (!serverId || !matchId) throw new BadRequestException('serverId et/ou matchId manquant');

    return { serverId, matchId };
  }

  // --------- Actions principales

  /** Pause tactique déclenchée par un joueur (ex: !tac) */
  async tacticalTimeout(opts: { serverId?: string; matchId?: string; actor: Actor; seconds?: number }) {
    const { actor } = opts;
    const seconds = Math.max(5, Math.min(60, opts.seconds ?? 30)); // borne simple
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);

    // CT/T → home/away (source de vérité côté state)
    const logical = await this.ms.sideToLogical(matchId, actor.teamSide);
    if (!logical) {
      this.logger.warn(`[TACTICAL_TIMEOUT] SIDE_MISMATCH server=${serverId} match=${matchId} side=${actor.teamSide}`);
      return { ok: false, code: 'SIDE_MISMATCH' as const };
    }

    // quota atomique
    const left = await this.ms.decrTac(matchId, logical);
    if (left < 0) return { ok: false, code: 'TIMEOUTS_NOT_INITIALIZED' as const };
    if (left === 0) return { ok: false, code: 'TIMEOUTS_EXHAUSTED' as const };

    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'tac_timeout',
      payload: { matchId, teamSide: actor.teamSide, teamLogical: logical, seconds },
      source: { via: 'chat', player: actor },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true, remaining: left };
  }

  /** Pause technique (opérateur/admin) */
  async technicalTimeout(opts: { serverId?: string; matchId?: string; seconds?: number; reason?: string }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const seconds = Math.max(10, Math.min(180, opts.seconds ?? 60));

    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'tech_timeout',
      payload: { matchId, seconds },
      source: { via: 'admin', reason: opts.reason ?? null },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  /** Reprise (admin ou joueur) */
  async unpause(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'unpause',
      payload: { matchId, teamSide: opts.actor?.teamSide },
      source: opts.actor ? { via: 'chat', player: opts.actor } : { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  /** Message global */
  async say(opts: { serverId: string; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'say',
      payload: { message: opts.message },
      source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  /** Message équipe */
  async sayTeam(opts: { serverId: string; team: TeamSide; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'say_team',
      payload: { team: opts.team, message: opts.message },
      source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  /** Knife round */
  async knife(opts: { serverId?: string; matchId?: string }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'knife',
      payload: { matchId },
      source: { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  /** Restart (mp_restartgame) */
  async restart(opts: { serverId?: string; matchId?: string; delay?: number }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'restart',
      payload: { matchId, delay: opts.delay ?? 3 },
      source: { via: 'admin' },
    };
    await this.publishToAgent(serverId, msg);
    return { ok: true };
  }

  /** Changement de carte */
  async changeLevel(opts: { serverId: string; map: string }) {
    if (!opts.serverId || !opts.map) throw new BadRequestException('serverId et map requis');
    const msg: AgentAction = {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'changelevel',
      payload: { map: opts.map },
      source: { via: 'admin' },
    };
    await this.publishToAgent(opts.serverId, msg);
    return { ok: true };
  }

  // --------- Bind & init utilitaires

  /** Lie un serveur à un match (utilisé par ton endpoint admin / bind) */
  async bindServerToMatch(serverId: string, matchId: string) {
    if (!serverId || !matchId) throw new BadRequestException('serverId et matchId requis');
    await this.redis.set(serverMatchKey(serverId), matchId);
    this.logger.log(`[bind] server=${serverId} -> match=${matchId}`);
    return { ok: true };
  }

  /** Génère/assure l’init d’un match minimal (sides, score, timeouts, teams…) */
  async ensureInitMatch(serverId: string, matchId?: string, sides?: { home: TeamSide; away: TeamSide }) {
    const wantHome = sides?.home ?? 'CT';
    const wantAway = sides?.away ?? 'T';

    let mid = matchId;
    if (!mid) {
      const seed = `${serverId}-${Date.now()}`;
      mid = `m-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)}`;
    }

    const multi = this.redis.multi();
    multi.set(serverMatchKey(serverId), mid);
    multi.hset(`match:${mid}:sides`, { home: wantHome, away: wantAway });
    multi.hset(`match:${mid}:score`, { ct: 0, t: 0 });
    multi.hset(`match:${mid}:timeouts`, { homeTac: 4, awayTac: 4, homeTech: 0, awayTech: 0 });
    const teams = {
      home: { id: `th-${mid.slice(2, 6)}`, name: `Home_${mid.slice(2, 6)}` },
      away: { id: `ta-${mid.slice(2, 6)}`, name: `Away_${mid.slice(2, 6)}` },
    };
    multi.set(`match:${mid}:teams`, JSON.stringify(teams));
    await multi.exec();

    this.logger.log(`[init] server=${serverId} match=${mid} sides=${wantHome}/${wantAway}`);
    return { ok: true, matchId: mid, sides: { home: wantHome, away: wantAway }, teams };
  }
}
