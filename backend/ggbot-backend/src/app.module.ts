import { Module } from '@nestjs/common';
import { Cs2LogsModule } from './cs2-logs/cs2-logs.module';
import { HealthController } from './health/health.controller';
import { CommandsModule } from './commands/commands.module';
import { MatchStateModule } from './match-state/match-state.module';
import { AdminModule } from './admin/admin.module';


@Module({ imports: [Cs2LogsModule, CommandsModule, MatchStateModule, AdminModule], controllers: [HealthController] })
export class AppModule {}
