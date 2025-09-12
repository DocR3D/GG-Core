// src/application/phase/phase.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { MatchStateModule } from '@app/match-state.module';
import { RedisModule } from '@adapters/redis/redis.module';
import { WsModule } from '@adapters/ws/ws.module';
import { CommandsModule } from '@app/commands.module';

@Module({
  imports: [
    forwardRef(() => MatchStateModule),
    RedisModule,
    forwardRef(() => WsModule),
    forwardRef(() => CommandsModule), // ← IMPORTANT
  ],
  providers: [MatchPhaseService],
  exports:   [MatchPhaseService],
})
export class PhaseModule {}
