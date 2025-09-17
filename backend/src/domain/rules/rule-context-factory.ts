// src/application/rules/rule-context.factory.ts
import { Inject, Injectable } from '@nestjs/common';
import type { RuleContext } from '@domain/rules';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.services';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { REDIS_PUB } from '@adapters/redis/redis.tokens';
import type Redis from 'ioredis';

@Injectable()
export class RuleContextFactory {
  constructor(
    private readonly mss: MatchStateService,
    private readonly orch: MatchOrchestrator,
    private readonly cmds: MatchCommandsService, // pour say()
    @Inject(REDIS_PUB) private readonly pub: Redis,
  ) {}

  make(params: { matchId: string; serverId?: string }): RuleContext {
    const { matchId, serverId } = params;

    const stateRO = {
      getSnapshot: this.mss.getSnapshot.bind(this.mss),
      getScore: this.mss.getScore.bind(this.mss),
      getServerIdFromMatchId: this.mss.getServerIdFromMatchId.bind(this.mss),
      getMatchIdFromServerId: this.mss.getMatchIdFromServerId.bind(this.mss),
      getPlayers: this.mss.getPlayers.bind(this.mss),        // 👈 expose lecture
    } as const;

    return {
      matchId,
      serverId,
      orch: this.orch,
      state: stateRO,

      say: async (msg: string) => {
        const srv = serverId ?? (await this.mss.getServerIdFromMatchId(matchId));
        if (!srv) throw new Error(`No server bound to match ${matchId}`);
        await this.cmds.say(srv, msg); // signature actuelle sans matchId
      },

      pubEvent: async (type: string, payload: any) => {
        await this.pub.publish(
          'ggbot:events',
          JSON.stringify({
            v: 1,
            type,
            matchId,
            serverId: serverId ?? null,
            timestamp: Date.now(),
            payload,
          }),
        );
      },
    };
  }
}
