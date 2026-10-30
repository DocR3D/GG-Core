// src/app.module.ts
import { Module } from '@nestjs/common';

import { RedisModule } from '@adapters/redis/redis.module';
import { DatabaseModule } from '@adapters/database/database.module';
import { WsModule } from '@adapters/ws/ws.module';
import { HttpModule } from './adapters/http/http.module';
import { Cs2LogsModule } from './adapters/http/cs2-logs/cs2-logs.module';

import { BusModule } from './application/bus/bus.module';
import { CommandsModule } from './application/commands.module';
import { MatchStateModule } from './application/match-state.module';
import { PhaseModule } from '@app/match/phase/phase.module';
import { RulesModule } from './application/match/rules/rules.module';
import { SubscribersModule } from './application/subscribers/subscribers.module';
import { AdminModule } from './application/admin.module';

import { HealthController } from './adapters/http/health/health.controller';
import { AuthModule } from './adapters/http/auth/auth.module';

@Module({
  imports: [
    // adapters
    AuthModule,
    RedisModule,
    DatabaseModule,
    WsModule,
    HttpModule,
    Cs2LogsModule,

    // application
    BusModule,
    CommandsModule,
    MatchStateModule,
    PhaseModule,
    RulesModule,
    SubscribersModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
