import { Module } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';

import { MatchStateService } from '@app/match/state/match-state.service';
import { SidesScoreService } from '@app/match/state/sides-score.service';
import { TimeoutsService } from '@app/match/state/timeouts.service';
import { TeamsRosterService } from '@app/match/state/rosters.service';
import { EconomyService } from '@app/match/state/economy.service';
import { SnapshotQuery } from '@app/match/state/snapshot.query';
import { SeqService } from '@app/match/state/sequence.service';   // 👈

@Module({
  imports: [RedisModule],
  providers: [
    MatchStateService,
    SidesScoreService,
    TimeoutsService,
    TeamsRosterService,
    EconomyService,
    SnapshotQuery,
    SeqService,   // 👈
  ],
  exports: [
    MatchStateService,
    SidesScoreService,
    TimeoutsService,
    TeamsRosterService,
    EconomyService,
    SnapshotQuery,
    SeqService,   // 👈
  ],
})
export class MatchStateModule {}
