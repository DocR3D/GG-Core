import { Module } from '@nestjs/common';
import { Cs2LogsController } from './cs2-logs.controller';
import { Cs2LogsService } from './cs2-logs.service';
import { BusModule } from '@app/bus/bus.module';
import { MatchStateModule } from '@app/match-state.module';

@Module({
  imports: [
    BusModule,
    MatchStateModule, // pour MatchStateService
  ],
  controllers: [Cs2LogsController],
  providers: [Cs2LogsService],
  exports: [Cs2LogsService],
})
export class Cs2LogsModule {}
