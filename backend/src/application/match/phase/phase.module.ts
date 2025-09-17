// src/application/match/phase/phase.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { RedisModule } from '@adapters/redis/redis.module';
import { CommandsModule } from '@app/commands.module';
import { RulesModule } from '@app/match/rules/rules.module';

import { PauseMatchService } from '@app/match/pause/pause-match.service';
// ⬇️ ajoute ces imports
import { PeriodicScheduler } from '@app/shared/periodic/periodic-scheduler.service';
import { PeriodicMessenger } from '@app/shared/periodic/periodic-messenger.service';
import { MessageServiceModule } from '../messages/message.service.module';

@Module({
  imports: [
    RedisModule,
    CommandsModule,
    MessageServiceModule,
    forwardRef(() => RulesModule),
  ],
  providers: [
    MatchPhaseService,
    PauseMatchService,
    // ⬇️ nouveau
    PeriodicScheduler,
    PeriodicMessenger,
  ],
  exports: [
    MatchPhaseService,
    PauseMatchService,
    // ⬇️ optionnel (si utilisé ailleurs)
    PeriodicScheduler,
    PeriodicMessenger,
  ],
})
export class PhaseModule {}
