// src/application/match/match-orchestrator.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MatchOrchestrator } from './match-orchestrator.service';
import { MatchAccessService } from './access/match-access.service';
import { TeamPlacementService } from './access/team-placement.service';
import { MatchStateModule } from '@app/match-state.module';
import { PhaseModule } from '@app/match/phase/phase.module';
import { RulesModule } from '@app/match/rules/rules.module';
import { CommandsModule } from '@app/commands.module';
import { WsModule } from '@adapters/ws/ws.module';   // 👈 ajoute ça

@Module({
  imports: [
    forwardRef(() => MatchStateModule),
    forwardRef(() => PhaseModule),
    forwardRef(() => RulesModule),
    forwardRef(() => CommandsModule),
    forwardRef(() => RulesModule),
    WsModule,   // 👈 ajoute ça pour exposer WsBroadcaster
  ],
  providers: [MatchOrchestrator, MatchAccessService, TeamPlacementService],
  exports: [MatchOrchestrator, MatchAccessService, TeamPlacementService],
})
export class MatchOrchestratorModule {}
