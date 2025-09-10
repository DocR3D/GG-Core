// src/adapters/http/http.module.ts
import { Module } from '@nestjs/common';

// Modules "métier" qui exposent leurs services (ex. MatchStateService)
import { MatchStateModule } from '@app/match.state.module';

// Contrôleurs HTTP
import { MatchesController } from './matches/matches.controller';
import { PlayersController } from './matches/players.controller';
import { MatchInitController } from './matches/init.controller';
import { SidesController } from './matches/sides.controller';
import { EconomyController } from './matches/economy.controller';
// import { Cs2LogsController } from './cs2-logs.controller';
// import { HealthController } from './health/health.controller';

@Module({
  imports: [
    MatchStateModule, // <-- un MODULE seulement ici
  ],
  controllers: [
    MatchesController,
    PlayersController,
    MatchInitController,
    SidesController,
    EconomyController,
    // Cs2LogsController,
    // HealthController,
  ],
})
export class HttpModule {}
