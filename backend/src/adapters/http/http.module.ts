// src/adapters/http/http.module.ts
import { Module } from '@nestjs/common';

// Modules "métier"
import { MatchStateModule } from '@app/match-state.module';
import { BusModule } from '@app/bus/bus.module';

// Contrôleurs HTTP
import { MatchesController } from './matches/matches.controller';
import { PlayersController } from './matches/players.controller';
import { MatchInitController } from './matches/init.controller';
import { SidesController } from './matches/sides.controller';
import { EconomyController } from './matches/economy.controller';
import { Cs2LogsController } from './cs2-logs/cs2-logs.controller';
import { Cs2LogsModule } from './cs2-logs/cs2-logs.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    MatchStateModule,
    BusModule,
    Cs2LogsModule, // nouvelle intégration propre du module CS2 logs
  ],
  controllers: [
    MatchesController,
    PlayersController,
    MatchInitController,
    SidesController,
    EconomyController,
    Cs2LogsController,
    HealthController,
  ],
})
export class HttpModule {}
