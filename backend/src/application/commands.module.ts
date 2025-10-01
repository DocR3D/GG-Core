import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../adapters/redis/redis.module';
import { MatchCommandsService } from './commands/match-commands.service';
import { PauseMatchService } from './match/pause/pause.service';
import { MatchStateModule } from './match-state.module';
import { PhaseModule } from './match/phase/phase.module';
import { PeriodicModule } from './shared/periodic/periodic.module';

// 1. Importer TOUTES vos commandes spécifiques ici
import { ReadyCommand } from './match/commands/ready.command';
import { PauseCommand } from './match/commands/pause.command';
import { KnifeChoiceCommand } from './match/commands/knife-choice.command';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => PhaseModule), // Gardez le forwardRef, il est essentiel
    PeriodicModule,
  ],
  providers: [
    // Le service général
    MatchCommandsService,
    PauseMatchService,
    // ET toutes les commandes spécifiques
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
  ],
  exports: [
    // On exporte TOUT pour que les autres modules puissent les injecter
    MatchCommandsService,
    PauseMatchService,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
  ],
})
export class CommandsModule {}