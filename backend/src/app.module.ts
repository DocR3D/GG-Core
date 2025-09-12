import { Module } from '@nestjs/common';
import { Cs2LogsModule } from './adapters/http/cs2-logs/cs2-logs.module';
import { HealthController } from './adapters/http/health/health.controller';
import { CommandsModule } from './application/commands.module';
import { MatchStateModule } from './application/match-state.module';
import { AdminModule } from './application/admin.module';
import { HttpModule } from './adapters/http/http.module';
import { RedisModule } from '@adapters/redis/redis.module';
import { WsModule } from '@adapters/ws/ws.module';



@Module({ imports: [RedisModule, Cs2LogsModule, CommandsModule, MatchStateModule, AdminModule, HttpModule ,WsModule], controllers: [HealthController] })
export class AppModule {}
