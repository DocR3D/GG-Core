// src/application/match/match-orchestrator.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchOrchestrator } from './match-orchestrator.service';
import { MatchStateModule } from '@app/match-state.module';
import { PhaseModule } from '@app/match/phase/phase.module';
import { RulesModule } from '@app/match/rules/rules.module';
import { CommandsModule } from '@app/commands.module';
import { WsModule } from '@adapters/ws/ws.module';
import { PostgresRepositoriesModule } from '@adapters/postgres/postgres-repositories.module';

@Module({
  imports: [
    forwardRef(() => MatchStateModule),
    forwardRef(() => PhaseModule),
    forwardRef(() => RulesModule),
    forwardRef(() => CommandsModule),
    forwardRef(() => RulesModule),
    WsModule,
    PostgresRepositoriesModule,
  ],
  providers: [MatchOrchestrator],
  exports: [MatchOrchestrator],
})
export class MatchOrchestratorModule {}
