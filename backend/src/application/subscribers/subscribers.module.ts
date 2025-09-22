// src/application/subscribers/subscribers.module.ts
import { forwardRef, Module } from '@nestjs/common';

import { MatchStateModule } from '@app/match-state.module';
import { PhaseModule } from '@app/match/phase/phase.module';
import { RulesModule } from '@app/match/rules/rules.module';
import { BusModule } from '@app/bus/bus.module';
import { CommandsModule } from '@app/commands.module';   // ⬅️ NEW

import { WsModule } from '@adapters/ws/ws.module';

import { MatchEventsHandler } from './match-events.handler';
import { EventsRouterSubscriber } from './events-router.consumer';
import { ChatCommandHandler } from './chat-commands.handler'; // vérifie le nom exact de la classe
import { MatchOrchestratorModule } from '@app/match/match-orchestrator.module';
import { PhaseEventsHandler } from './phase-events.handler';
import { RoundEventsHandler } from './round-events.handler';
import { KillAndBombEventsHandler } from './kill-bomb-events.handler';

@Module({
  imports: [
    MatchStateModule,
    forwardRef(() => MatchOrchestratorModule),
    PhaseModule,
    RulesModule,
    CommandsModule,
    BusModule,
    WsModule,
  ],
  providers: [
    MatchEventsHandler,
    PhaseEventsHandler,
    RoundEventsHandler,
    KillAndBombEventsHandler,
    EventsRouterSubscriber,
    ChatCommandHandler,
  ],
  exports: [
    MatchEventsHandler,
    EventsRouterSubscriber,
    ChatCommandHandler,
  ],
})
export class SubscribersModule {}
