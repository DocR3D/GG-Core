// src/application/subscribers/subscribers.module.ts
import { Module } from '@nestjs/common';

import { MatchStateModule } from '@app/match-state.module';
import { PhaseModule } from '@app/phase/phase.module';
import { RulesModule } from '@app/rules/rules.module';
import { BusModule } from '@app/bus/bus.module';
import { CommandsModule } from '@app/commands.module';   // ⬅️ NEW

import { WsModule } from '@adapters/ws/ws.module';

import { MatchEventsHandler } from './match-events.handler';
import { EventsRouterSubscriber } from './events-router.subscriber';
import { ChatCommandHandler } from './chat-commands.handler'; // vérifie le nom exact de la classe

@Module({
  imports: [
    MatchStateModule,
    PhaseModule,
    RulesModule,
    CommandsModule,     // ⬅️ NEW: expose MatchCommandsService ici
    BusModule,
    WsModule,
  ],
  providers: [
    MatchEventsHandler,
    EventsRouterSubscriber,
    ChatCommandHandler, // ou ChatCommandHandler selon ton fichier
  ],
  exports: [
    MatchEventsHandler,
    EventsRouterSubscriber,
    ChatCommandHandler,
  ],
})
export class SubscribersModule {}
