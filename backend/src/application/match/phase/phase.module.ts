import { Module, forwardRef } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { MatchStateModule } from '@app/match-state.module';
import { RulesModule } from '@app/match/rules/rules.module';
import { CommandsModule } from '@app/commands.module';
import { MessageServiceModule } from '../messages/messages.module';
import { PostgresRepositoriesModule } from '@adapters/postgres/postgres-repositories.module';

@Module({
  imports: [
    MatchStateModule,
    RulesModule,
    forwardRef(() => CommandsModule),
    MessageServiceModule,
    PostgresRepositoriesModule,
  ],
  providers: [MatchPhaseService],
  exports: [MatchPhaseService],
})
export class PhaseModule {}
