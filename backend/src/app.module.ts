// src/app.module.ts
import { Module } from '@nestjs/common';

import { RedisModule } from '@adapters/redis/redis.module';
import { WsModule } from '@adapters/ws/ws.module';
import { HttpModule } from './adapters/http/http.module';
// Si HttpModule importe déjà Cs2LogsModule, tu peux retirer l'import direct de Cs2LogsModule.
import { Cs2LogsModule } from './adapters/http/cs2-logs/cs2-logs.module';

import { BusModule } from './application/bus/bus.module';
import { CommandsModule } from './application/commands.module';
import { MatchStateModule } from './application/match-state.module';
import { PhaseModule } from '@app/phase/phase.module';
import { RulesModule } from './application/rules/rules.module';
import { SubscribersModule } from './application/subscribers/subscribers.module';
import { AdminModule } from './application/admin.module';

// HealthController est normalement déclaré dans HttpModule.
// Tu peux l’omettre ici si HttpModule le fournit déjà.
import { HealthController } from './adapters/http/health/health.controller';

@Module({
  imports: [
    // adapters
    RedisModule, WsModule, HttpModule, Cs2LogsModule,

    // application
    BusModule,
    CommandsModule,
    MatchStateModule,
    PhaseModule,
    RulesModule,         // ← fournit RuleRegistry + règles
    SubscribersModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}


