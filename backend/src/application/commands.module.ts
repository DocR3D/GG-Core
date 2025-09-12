// src/application/commands.module.ts
import { Module, forwardRef, Logger } from '@nestjs/common';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateModule } from './match-state.module';
import { RedisModule } from '../adapters/redis/redis.module';
import { PhaseModule } from './phase/phase.module';

@Module({
  imports: [
    RedisModule,
    forwardRef(() => MatchStateModule),
    forwardRef(() => PhaseModule),   // ← IMPORTANT (voir 3)
  ],
  providers: [MatchCommandsService, Logger],
  exports:   [MatchCommandsService], // ← IMPORTANT
})
export class CommandsModule {}
