import { Module } from '@nestjs/common';
import { Cs2LogsModule } from './adapters/http/cs2-logs/cs2-logs.module';
import { HealthController } from './adapters/http/health/health.controller';
import { CommandsModule } from './application/commands.module';
import { MatchStateModule } from './application/match.state.module';
import { AdminModule } from './application/admin.module';
import { MatchesModule } from './adapters/http/matches/matches.module';
import { RedisModule } from '@adapters/redis/redis.module';


@Module({ imports: [RedisModule, Cs2LogsModule, CommandsModule, MatchStateModule, AdminModule, MatchesModule], controllers: [HealthController] })
export class AppModule {}
