import { Module } from '@nestjs/common';
import { Cs2LogsModule } from './adapters/http/cs2-logs.module';
import { HealthController } from './adapters/http/health/health.controller';
import { CommandsModule } from './application/commands.module';
import { MatchStateModule } from './application/match-state.module';
import { AdminModule } from './application/admin.module';


@Module({ imports: [Cs2LogsModule, CommandsModule, MatchStateModule, AdminModule], controllers: [HealthController] })
export class AppModule {}
