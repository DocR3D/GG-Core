// src/application/commands.module.ts
import { Module, forwardRef, Logger } from '@nestjs/common';
import { MatchCommandsService } from '@app/commands/ match-commands.service'; // ← corrige l'import (sans espace)
import { MatchStateModule } from './match.state.module';
import { RedisModule } from '../adapters/redis/redis.module'; // ← pour REDIS_PUB

@Module({
  imports: [
    RedisModule,                 // ← nécessaire pour REDIS_PUB
    forwardRef(() => MatchStateModule), // seulement si MatchCommandsService injecte MatchStateService
  ],
  providers: [
    MatchCommandsService,
    Logger, // ← ajoute le Logger comme provider
  ],
  exports: [MatchCommandsService],
})
export class CommandsModule {}
