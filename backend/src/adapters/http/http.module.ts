// src/adapters/http/http.module.ts
import { Module } from '@nestjs/common';

// Modules "métier"
import { MatchStateModule } from '@app/match-state.module';
import { BusModule } from '@app/bus/bus.module';
import { PostgresRepositoriesModule } from '@adapters/postgres/postgres-repositories.module';
import { CommandsModule } from '@app/commands.module';

// Contrôleurs HTTP
import { MatchesController } from './matches/matches.controller';
import { PlayersController } from './matches/players.controller';
import { MatchInitController } from './matches/init.controller';
import { SidesController } from './matches/sides.controller';
import { EconomyController } from './matches/economy.controller';
import { Cs2LogsController } from './cs2-logs/cs2-logs.controller';
import { Cs2LogsModule } from './cs2-logs/cs2-logs.module';
import { HealthController } from './health/health.controller';
import { MapsModule } from './maps/maps.module';
import { TeamsController } from './teams/teams.controller';
import { ServersModule } from './servers/servers.module';
import { ServersController } from './servers/servers.controller';
import { TournamentsModule } from './tournaments/tournaments.module';
import { TournamentSeriesCreateController } from './tournaments/series-create.controller';
import { MatchDeleteController } from './matches/delete.controller';
import { MatchAdminActionsController } from './matches/admin-actions.controller';

@Module({
  imports: [
    MatchStateModule,
    BusModule,
    CommandsModule,
    Cs2LogsModule,
    MapsModule,
    PostgresRepositoriesModule,
    ServersModule,
    TournamentsModule,
  ],
  controllers: [
    MatchesController,
    PlayersController,
    MatchInitController,
    SidesController,
    EconomyController,
    Cs2LogsController,
    HealthController,
    TeamsController,
    ServersController,
    TournamentSeriesCreateController,
    MatchDeleteController,
    MatchAdminActionsController,
  ],
})
export class HttpModule {}
