// src/application/match-state.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';

// Services d'état (Redis, snapshots, équipes, etc.)
import { MatchStateService } from './state/match-state.service';
import { SeqService } from './state/seq.service';
import { MatchIdResolver } from './state/match-id.resolver';
import { SidesScoreService } from './state/sides-score.service';
import { TimeoutsService } from './state/timeouts.service';
import { TeamsRosterService } from './state/teams-roster.service';
import { EconomyService } from './state/economy.service';
import { SnapshotQuery } from './state/snapshot.query';

// La phase est un module séparé ; si un service d'état en a besoin, on l'importe via le module
import { PhaseModule } from '@app/phase/phase.module';

@Module({
  imports: [
    RedisModule,
    // Import en forwardRef si un service d'état utilise MatchPhaseService
    forwardRef(() => PhaseModule),
  ],
  providers: [
    MatchStateService,
    SidesScoreService,
    EconomyService,
    TimeoutsService,
    SnapshotQuery,
    TeamsRosterService,
    SeqService,
    MatchIdResolver,
  ],
  exports: [
    MatchStateService,
    SidesScoreService,
    EconomyService,
    TimeoutsService,
    SnapshotQuery,
    TeamsRosterService,
    SeqService,
    MatchIdResolver,
  ],
})
export class MatchStateModule {}
