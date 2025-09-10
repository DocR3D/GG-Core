// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger,Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { MatchStateService } from '../state/match-state.service';
import { REDIS_PUB, REDIS_CMD } from '@adapters/redis/redis.tokens';
import { AgentAction } from '@domain/types/agent';
import { CommandEvent } from '@domain/types/command.event';
import * as crypto from 'crypto';


@Injectable()
export class MatchCommandsService {

  constructor(
    private readonly ms: MatchStateService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly logger: Logger,
  ) {}

  private async sendAgent(serverId: string, action: AgentAction) {
    await this.pub.publish('ggbot:agent:actions', JSON.stringify(action));
    this.logger.log(`[to-agent] ${action.action} -> ${serverId}`);
  }

async tacticalTimeout(serverId: string, matchId: string, actor: Actor) {
  this.logger.debug(`[TACTICAL_TIMEOUT] start server=${serverId} match=${matchId} actor=${actor.name} (${actor.steamId || 'no-steam'}) side=${actor.teamSide}`);

  // 1) Map CT/T -> home/away (source de vérité côté state)
  const logical = await this.ms.sideToLogical(matchId, actor.teamSide);
  if (!logical) {
    this.logger.warn(`[TACTICAL_TIMEOUT] SIDE_MISMATCH server=${serverId} match=${matchId} side=${actor.teamSide}`);
    return { ok:false, code:'SIDE_MISMATCH', message:`Side ${actor.teamSide} inconnu pour ${matchId}` };
  }
  this.logger.debug(`[TACTICAL_TIMEOUT] side mapping ok: physical=${actor.teamSide} -> logical=${logical}`);

  // 2) Règles métier (quota atomique)
  const left = await this.ms.decrTac(matchId, logical); // décrémente home_tac/away_tac
  this.logger.debug(`[TACTICAL_TIMEOUT] decremented tac quota for ${logical}, remaining=${left}`);

  if (left < 0) {
    this.logger.error(`[TACTICAL_TIMEOUT] TIMEOUTS_NOT_INITIALIZED match=${matchId}`);
    return { ok:false, code:'TIMEOUTS_NOT_INITIALIZED', message:'Timeouts non initialisés' };
  }
  if (left === 0) {
    this.logger.warn(`[TACTICAL_TIMEOUT] TIMEOUTS_EXHAUSTED match=${matchId} team=${logical}`);
    return { ok:false, code:'TIMEOUTS_EXHAUSTED', message:'Plus de pauses tactiques' };
  }

  // 3) Publie l’intention à l’agent Go (RCON côté Go). L’état (phase) sera mis à jour par les logs.
  const actionMsg = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type: 'action',
    serverId,
    action: 'tac_timeout',
    payload: { matchId, teamSide: actor.teamSide, teamLogical: logical, seconds: 30 },
    source: { via:'chat', player: actor },
  };

  this.logger.debug(`[TACTICAL_TIMEOUT] publish action to agent: ${JSON.stringify(actionMsg)}`);
  await this.pub.publish('ggbot:agent:actions', JSON.stringify(actionMsg));

  this.logger.debug(`[TACTICAL_TIMEOUT] success server=${serverId} match=${matchId} teamLogical=${logical} actor=${actor.name}`);
  return { ok: true };
}


  async unpause(serverId: string, matchId: string, actor: Actor) {
    const msg: AgentAction = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'unpause',
      payload: { matchId, teamSide: actor.teamSide },
      source: { via: 'chat', player: actor },
    };
    await this.sendAgent(serverId, msg);
    return { ok: true };
  }

  // … knife/start/restart/tac_timeout/tech_timeout sur le même modèle
async ensureInitFromCommand(
  ev: any,
  opts?: { map?: string; home?: 'CT'|'T'; away?: 'CT'|'T' }
) {
  const serverId = ev.serverId ?? 'srv-unknown';
  let matchId = ev.matchId || await this.redis.get(`server:${serverId}:matchId`);

  const wantHome = opts?.home ?? 'CT';
  const wantAway = opts?.away ?? 'T';

  this.logger.debug(`[INITCMD] start server=${serverId} match=${matchId ?? '∅'} params map=${opts?.map ?? '∅'} home=${wantHome} away=${wantAway}`);

  // 0) Créer un matchId si absent (et bind server -> match)
  if (!matchId) {
    const seed = `${serverId}-${Date.now()}`;
    matchId = `m-${hashShort(seed, 10)}`;
    const teamHomeId = `th-${hashShort(seed+'home')}`;
    const teamAwayId = `ta-${hashShort(seed+'away')}`;

    const teams = {
      home: { id: teamHomeId, name: `Home_${hashShort(seed,4)}` },
      away: { id: teamAwayId, name: `Away_${hashShort(seed,4)}` },
    };

    this.logger.debug(`[INITCMD] new match generated match=${matchId} (bind + sides/score/timeouts/teams)`);

    const multi = this.redis.multi();
    // Bind
    multi.set(`server:${serverId}:matchId`, matchId);
    // Sides (HASH)
    multi.hset(`match:${matchId}:sides`, { home: wantHome, away: wantAway });
    // Score (HASH)
    multi.hset(`match:${matchId}:score`, { ct: 0, t: 0 });
    // Timeouts (HASH) — assure-toi que decrTac utilise ces noms
    multi.hset(`match:${matchId}:timeouts`, { homeTac: 4, awayTac: 4, homeTech: 0, awayTech: 0 });
    // Teams (STRING JSON)
    multi.set(`match:${matchId}:teams`, JSON.stringify(teams));
    await multi.exec();

    this.logger.log(`[INITCMD] Init OK (new) server=${serverId} match=${matchId} sides=${wantHome}/${wantAway}`);
    return { matchId, teams, home: wantHome, away: wantAway };
  }

  // 1) Si le match existe déjà, garantir le bind server->match
  await this.redis.set(`server:${serverId}:matchId`, matchId);
  this.logger.debug(`[INITCMD] bind ensured server=${serverId} match=${matchId}`);

  // 2) Sides (HASH) — créer/écraser si demandé
  const sidesKey = `match:${matchId}:sides`;
  const sidesType = await this.redis.type(sidesKey);
  if (sidesType === 'string') {
    // Ancien schéma -> on supprime pour repartir en HASH
    await this.redis.del(sidesKey);
    this.logger.warn(`[INITCMD] sides was STRING, deleted to rewrite as HASH`);
  }

  const needOverrideSides = !!opts?.home || !!opts?.away;
  const sidesExists = await this.redis.exists(sidesKey);

  if (!sidesExists || needOverrideSides) {
    await this.redis.hset(sidesKey, { home: wantHome, away: wantAway });
    this.logger.debug(`[INITCMD] sides set match=${matchId} sides=${wantHome}/${wantAway} (overridden=${needOverrideSides})`);
  } else {
    const s = await this.redis.hgetall(sidesKey);
    this.logger.debug(`[INITCMD] sides already present match=${matchId} sides=${s.home}/${s.away}`);
  }

  // 3) Score (HASH) — init si absent
  const scoreKey = `match:${matchId}:score`;
  if (!(await this.redis.exists(scoreKey))) {
    await this.redis.hset(scoreKey, { ct: 0, t: 0 });
    this.logger.debug(`[INITCMD] score initialized match=${matchId}`);
  } else {
    this.logger.debug(`[INITCMD] score already present match=${matchId}`);
  }

  // 4) Timeouts (HASH) — init si absent (ou reset si tu veux)
  const timeoutsKey = `match:${matchId}:timeouts`;
  const timeoutsType = await this.redis.type(timeoutsKey);
  if (timeoutsType === 'string') {
    await this.redis.del(timeoutsKey);
    this.logger.warn(`[INITCMD] timeouts was STRING, deleted to rewrite as HASH`);
  }
  if (!(await this.redis.exists(timeoutsKey))) {
    await this.redis.hset(timeoutsKey, { homeTac: 4, awayTac: 4, homeTech: 0, awayTech: 0 });
    this.logger.debug(`[INITCMD] timeouts initialized match=${matchId}`);
  } else {
    this.logger.debug(`[INITCMD] timeouts already present match=${matchId}`);
  }

  // 5) Teams — créer si absent (optionnel)
  const teamsKey = `match:${matchId}:teams`;
  if (!(await this.redis.exists(teamsKey))) {
    const seed = `${serverId}-${matchId}`;
    const teams = {
      home: { id: `th-${hashShort(seed+'home')}`, name: `Home_${hashShort(seed,4)}` },
      away: { id: `ta-${hashShort(seed+'away')}`, name: `Away_${hashShort(seed,4)}` },
    };
    await this.redis.set(teamsKey, JSON.stringify(teams));
    this.logger.debug(`[INITCMD] teams initialized match=${matchId}`);
  }

  // 6) Log final + retour
  const finalSides = await this.redis.hgetall(sidesKey);
  this.logger.log(`[INITCMD] Init OK (existing) server=${serverId} match=${matchId} sides=${finalSides.home}/${finalSides.away}`);
  return { matchId, home: finalSides.home as 'CT'|'T', away: finalSides.away as 'CT'|'T' };
}

}


function hashShort(input: string, len = 8) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, len);
}

type Actor = { name:string; steamId?:string; teamSide:'CT'|'T'; channel?:'say'|'say_team' };
