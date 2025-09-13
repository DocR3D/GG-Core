// src/application/phase/phase.module.ts
import { Module } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { RedisModule } from '@adapters/redis/redis.module';
import { CommandsModule } from '@app/commands.module';

@Module({
  imports: [
    RedisModule,
    CommandsModule,         // OK (ActionsPort)
    // ❌ PAS de RulesModule, PAS de RuleRegistryModule
  ],
  providers: [MatchPhaseService],
  exports: [MatchPhaseService],
})
export class PhaseModule {}
