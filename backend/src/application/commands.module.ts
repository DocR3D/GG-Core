// src/application/commands.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateModule } from '@app/match-state.module';
import { RedisModule } from '@adapters/redis/redis.module';
import { PhaseModule } from '@app/phase/phase.module';
import { ACTIONS_PORT } from '@app/ports/actions.port';

// src/application/commands.module.ts
@Module({
  imports: [
    RedisModule,
    forwardRef(() => PhaseModule),     // OK
    forwardRef(() => MatchStateModule),
  ],
  providers: [
    MatchCommandsService,
    { provide: ACTIONS_PORT, useExisting: MatchCommandsService },
  ],
  exports: [ACTIONS_PORT, MatchCommandsService],
})
export class CommandsModule {}

