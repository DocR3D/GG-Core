// src/adapters/http/tournaments/tournaments.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { PostgresRepositoriesModule } from '@adapters/postgres/postgres-repositories.module';
import { TournamentSyncClient } from '@app/tournaments/tournament-sync.client';
import { TournamentCacheService } from '@app/tournaments/tournament-cache.service';
import { TournamentSyncService } from '@app/tournaments/tournament-sync.service';
import { TournamentsController } from './tournaments.controller';

@Module({
  imports: [RedisModule, PostgresRepositoriesModule],
  controllers: [TournamentsController],
  providers: [
    TournamentSyncClient,
    TournamentCacheService,
    TournamentSyncService,
  ],
  exports: [TournamentCacheService, TournamentSyncService],
})
export class TournamentsModule {}
