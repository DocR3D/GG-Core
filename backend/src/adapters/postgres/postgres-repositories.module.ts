// src/adapters/postgres/postgres-repositories.module.ts
import { Module } from '@nestjs/common';
import { PostgresModule } from './postgres.module';
import { MatchRepository } from './match.repository';
import { MatchHistoryRepository } from './match-history.repository';
import { ServerRepository } from './server.repository';
import { TournamentRepository } from './tournament.repository';
import { SeriesRepository } from './series.repository';

@Module({
  imports: [PostgresModule],
  providers: [MatchRepository, MatchHistoryRepository, ServerRepository, TournamentRepository, SeriesRepository],
  exports: [MatchRepository, MatchHistoryRepository, ServerRepository, TournamentRepository, SeriesRepository],
})
export class PostgresRepositoriesModule {}
