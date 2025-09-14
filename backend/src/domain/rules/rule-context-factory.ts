// src/application/rules/rule-context.factory.ts
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { RuleContext } from '@domain/rules';
import { MatchStateService } from '@app/state/match-state.service';
import { MatchPhaseService } from '@app/phase/match-phase.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { WsBroadcaster } from '@adapters/ws/ws-broadcaster.service';     // expose .push(matchId,type,payload,audience?)
import { REDIS_PUB } from '@adapters/redis/redis.tokens';
import Redis from 'ioredis';
import { ModuleRef } from '@nestjs/core';
// src/domain/rules/rule-context-factory.ts

@Injectable()
export class RuleContextFactory {
  private ws?: WsBroadcaster;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly mss: MatchStateService,
    @Inject(forwardRef(() => MatchPhaseService))
    private readonly phase: MatchPhaseService,   // ← protège le cycle
    private readonly cmds: MatchCommandsService,
    @Inject(REDIS_PUB) private readonly pub: Redis,
  ) {}

  // lazy-get pour éviter d'importer WsModule dans RulesModule
  private getWs(): WsBroadcaster {
    if (!this.ws) {
      this.ws = this.moduleRef.get(WsBroadcaster, { strict: false });
    }
    return this.ws;
  }


  make(params: { matchId: string; serverId: string }): RuleContext {
    const { matchId, serverId } = params;
    return {
      matchId,
      serverId,
      matchStateService: this.mss,
      phase: this.phase,
      commands: this.cmds,
      ws: this.getWs(), // doit exposer .push()
      say: (msg) => this.cmds.say({serverId, message: msg }),
        pubEvent: async (type: string, payload: any) => {
                await this.pub.publish(
                'ggbot:events',
                JSON.stringify({
                    v: 1,
                    type,
                    matchId,
                    serverId,
                    timestamp: Date.now(),
                    source: 'system',
                    kind: 'primary',
                    payload,
                }),
                );
            },
    };
  }
}
