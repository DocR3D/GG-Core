// src/application/match.state.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { CommandsModule } from './commands.module';
import { MatchStateService } from './state/match-state.service';
import { EventsRouterSubscriber } from './subscribers/events-router.subscriber';
import { MatchEventsHandler } from './subscribers/match-events.handler';
import { ChatCommandHandler } from './subscribers/chat-commands.handler';

@Module({
  imports: [
    forwardRef(() => CommandsModule), // pour récupérer MatchCommandsService
  ],
  providers: [
    MatchStateService,
    EventsRouterSubscriber,
    MatchEventsHandler,
    ChatCommandHandler,
  ], // ← supprimé le doublon d’EventsRouterSubscriber
  exports: [
    MatchStateService,
    ChatCommandHandler, // exporte si utilisé ailleurs (optionnel)
  ],
})
export class MatchStateModule {}
