import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../adapters/redis/redis.module';
import { MatchCommandsService } from './commands/match-commands.service';
import { PauseMatchService } from './match/pause/pause.service';
import { MatchStateModule } from './match-state.module';
import { PhaseModule } from './match/phase/phase.module';
import { PeriodicModule } from './shared/periodic/periodic.module';
import { WsModule } from '@adapters/ws/ws.module';
import { DatabaseModule } from '@adapters/database/database.module';

// 1. Importer TOUTES vos commandes spécifiques ici
import { ReadyCommand } from './match/commands/ready.command';
import { PauseCommand } from './match/commands/pause.command';
import { KnifeChoiceCommand } from './match/commands/knife-choice.command';
import { RestoreCommand } from './match/commands/restore.command';
import { RoundRestoreService } from './match/restore/round-restore.service';
import { AdminCallService } from './match/admin-call/admin-call.service';
import { AdminCallCommand } from './match/commands/admin-call.command';
import { InfoCommand } from './match/commands/info.command';
import { TournamentConfigService } from './config/tournament-config.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => PhaseModule), // Gardez le forwardRef, il est essentiel
    PeriodicModule,
    WsModule,
    DatabaseModule,
  ],
  providers: [
    // Le service général
    MatchCommandsService,
    PauseMatchService,
    RoundRestoreService,
    AdminCallService,
    TournamentConfigService,
    // ET toutes les commandes spécifiques
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestoreCommand,
    AdminCallCommand,
    InfoCommand,
  ],
  exports: [
    // On exporte TOUT pour que les autres modules puissent les injecter
    MatchCommandsService,
    PauseMatchService,
    RoundRestoreService,
    AdminCallService,
    TournamentConfigService,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestoreCommand,
    AdminCallCommand,
    InfoCommand,
  ],
})
export class CommandsModule {}
