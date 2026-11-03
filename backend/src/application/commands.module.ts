import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../adapters/redis/redis.module';
import { MatchCommandsService } from './commands/match-commands.service';
import { PauseMatchService } from './match/pause/pause.service';
import { MatchStateModule } from './match-state.module';
import { PhaseModule } from './match/phase/phase.module';
import { PeriodicModule } from './shared/periodic/periodic.module';
import { WsModule } from '@adapters/ws/ws.module';

// 1. Importer TOUTES vos commandes spécifiques ici
import { ReadyCommand } from './match/commands/ready.command';
import { PauseCommand } from './match/commands/pause.command';
import { KnifeChoiceCommand } from './match/commands/knife-choice.command';
import { RestoreCommand } from './match/commands/restore.command';
import { RoundRestoreService } from './match/restore/round-restore.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => PhaseModule), // Gardez le forwardRef, il est essentiel
    PeriodicModule,
    WsModule,
  ],
  providers: [
    // Le service général
    MatchCommandsService,
    PauseMatchService,
    RoundRestoreService,
    // ET toutes les commandes spécifiques
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestoreCommand,
  ],
  exports: [
    // On exporte TOUT pour que les autres modules puissent les injecter
    MatchCommandsService,
    PauseMatchService,
    RoundRestoreService,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestoreCommand,
  ],
})
export class CommandsModule {}
