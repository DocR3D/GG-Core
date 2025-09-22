// src/application/commands.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchCommandsService } from './commands/match-commands.service';
import { PauseMatchService } from './match/pause/pause.service';
import { MatchStateModule } from './match-state.module';
import { PhaseModule } from './match/phase/phase.module';
import { PeriodicModule } from './shared/periodic/periodic.module';  // 👈

@Module({
  imports: [RedisModule, MatchStateModule, PhaseModule, PeriodicModule], // 👈 ajouté
  providers: [MatchCommandsService, PauseMatchService],
  exports: [MatchCommandsService, PauseMatchService],
})
export class CommandsModule {}
