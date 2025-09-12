// src/application/match.state.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { CommandsModule } from './commands.module';
import { MatchStateService } from './state/match-state.service';
import { EventsRouterSubscriber } from './subscribers/events-router.subscriber';
import { MatchEventsHandler } from './subscribers/match-events.handler';
import { ChatCommandHandler } from './subscribers/chat-commands.handler';
import { SeqService } from './state/seq.service';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchIdResolver } from './state/match-id.resolver';

// Facade + services découpés
import { SidesScoreService } from './state/sides-score.service';
import { TimeoutsService } from './state/timeouts.service';
import { TeamsRosterService } from './state/teams-roster.service';
import { EconomyService } from './state/economy.service';
import { SnapshotQuery } from './state/snapshot.query';

// ⬅️ NEW: service des phases (autorisation des commandes par phase)
import { MatchPhaseService } from '@app/phase/match-phase.service';

@Module({
  imports: [
    forwardRef(() => CommandsModule), // pour MatchCommandsService
    RedisModule,
  ],
  providers: [
    MatchStateService,
    EventsRouterSubscriber,
    TimeoutsService,
    MatchEventsHandler,
    SidesScoreService,
    EconomyService,
    SnapshotQuery,
    TeamsRosterService,
    ChatCommandHandler,
    SeqService,
    MatchIdResolver,
    MatchPhaseService,            // ⬅️ NEW (règle l’erreur d’injection)
  ],
  exports: [
    MatchStateService,
    SidesScoreService,
    SnapshotQuery,
    TeamsRosterService,
    ChatCommandHandler,
    EconomyService,
    TimeoutsService,
    SeqService,
    MatchIdResolver,
    MatchPhaseService,            // ⬅️ NEW (si consommé hors module)
  ],
})
export class MatchStateModule {}
