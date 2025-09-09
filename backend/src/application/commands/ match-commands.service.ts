// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger,Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { MatchStateService } from '../state/match-state.service';
import { REDIS_PUB } from '@adapters/redis/redis.tokens';
import { AgentAction } from '@domain/types/agent';


@Injectable()
export class MatchCommandsService {
  constructor(
    private readonly ms: MatchStateService,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly logger: Logger,
  ) {}

  private async sendAgent(serverId: string, action: AgentAction) {
    await this.pub.publish('ggbot:agent:actions', JSON.stringify(action));
    this.logger.log(`[to-agent] ${action.action} -> ${serverId}`);
  }

  async tacticalTimeout(serverId: string, matchId: string, actor: Actor) {
    // 1) Map CT/T -> home/away (source de vérité côté state)
    const logical = await this.ms.sideToLogical(matchId, actor.teamSide);
    if (!logical) {
      return { ok:false, code:'SIDE_MISMATCH', message:`Side ${actor.teamSide} inconnu pour ${matchId}` };
    }

    // 2) Règles métier (quota atomique)
    const left = await this.ms.decrTac(matchId, logical); // décrémente home_tac/away_tac
    if (left < 0) return { ok:false, code:'TIMEOUTS_NOT_INITIALIZED', message:'Timeouts non initialisés' };
    if (left === 0) return { ok:false, code:'TIMEOUTS_EXHAUSTED', message:'Plus de pauses tactiques' };

    // 3) Publie l’intention à l’agent Go (RCON côté Go). L’état (phase) sera mis à jour par les logs.
    await this.pub.publish('ggbot:agent:actions', JSON.stringify({
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'tac_timeout',
      payload: { matchId, teamSide: actor.teamSide, teamLogical: logical, seconds: 30 },
      source: { via:'chat', player: actor },
    }));

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

}
type Actor = { name:string; steamId?:string; teamSide:'CT'|'T'; channel?:'say'|'say_team' };
