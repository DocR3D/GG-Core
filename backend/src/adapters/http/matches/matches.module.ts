import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchStateModule } from '@app/match.state.module';

@Module({
  imports: [MatchStateModule],
  controllers: [MatchesController],
})
export class MatchesModule {}