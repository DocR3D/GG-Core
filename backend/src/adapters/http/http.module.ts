// src/adapters/http/http.module.ts
import { Module, forwardRef } from '@nestjs/common';

// Modules "métier"
import { MatchStateModule } from '@app/match-state.module';
import { BusModule } from '@app/bus/bus.module';
import { MatchOrchestratorModule } from '@app/match/match-orchestrator.module';
import { SandboxModule } from '@app/match/sandbox/sandbox.module';

// Contrôleurs HTTP
import { MatchesController } from './matches/matches.controller';
import { PlayersController } from './matches/players.controller';
import { MatchInitController } from './matches/init.controller';
import { SidesController } from './matches/sides.controller';
import { EconomyController } from './matches/economy.controller';
import { Cs2LogsController } from './cs2-logs/cs2-logs.controller';
import { Cs2LogsModule } from './cs2-logs/cs2-logs.module';
import { HealthController } from './health/health.controller';
import { SandboxController } from './sandbox/sandbox.controller';
import { TournamentMatchesController } from './tournament/tournament-matches.controller';

@Module({
  imports: [
    MatchStateModule,
    forwardRef(() => MatchOrchestratorModule),
    BusModule,
    Cs2LogsModule, // nouvelle intégration propre du module CS2 logs
    SandboxModule,
  ],
  controllers: [
    MatchesController,
    PlayersController,
    MatchInitController,
    SidesController,
    EconomyController,
    Cs2LogsController,
    HealthController,
    SandboxController,
    TournamentMatchesController,
  ],
})
export class HttpModule {}
