import { Module } from '@nestjs/common';
import { Cs2LogsController } from './cs2-logs.controller';
import { Cs2LogsService } from './cs2-logs.service'; 
import { MatchStateService } from '@app/state/match-state.service'; 

@Module({
  controllers: [Cs2LogsController],
  providers: [Cs2LogsService,MatchStateService],
  exports: [Cs2LogsService,MatchStateService],
})
export class Cs2LogsModule {}
