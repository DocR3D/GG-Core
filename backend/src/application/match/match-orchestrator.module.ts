// src/application/match/match-orchestrator.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchOrchestrator } from './match-orchestrator.services';

import { RedisModule } from '@adapters/redis/redis.module';
import { WsModule } from '@adapters/ws/ws.module';
import { CommandsModule } from '@app/commands.module';
import { MatchStateModule } from '@app/match-state.module';
import { PhaseModule } from '@app/match/phase/phase.module';

@Module({
  imports: [
    RedisModule,
    forwardRef(() => WsModule),
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchStateModule),
    forwardRef(() => PhaseModule),
  ],
  providers: [MatchOrchestrator],
  exports:   [MatchOrchestrator],
})
export class MatchOrchestratorModule {}
