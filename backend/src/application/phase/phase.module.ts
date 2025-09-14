// src/application/phase/phase.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { RedisModule } from '@adapters/redis/redis.module';
import { CommandsModule } from '@app/commands.module';
import { RulesModule } from '@app/rules/rules.module';

@Module({
  imports: [
    RedisModule,
    CommandsModule,
    forwardRef(() => RulesModule),
  ],
  providers: [MatchPhaseService],
  exports: [MatchPhaseService],
})
export class PhaseModule {}
