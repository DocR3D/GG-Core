// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestErrorsInterceptor } from './adapters/http/request-errors.interceptor';

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
  ],
  controllers: [HealthController],
  // every refused request is logged (method, address, reason)
  providers: [{ provide: APP_INTERCEPTOR, useClass: RequestErrorsInterceptor }],
})
export class AppModule {}
