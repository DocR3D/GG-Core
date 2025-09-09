// matches.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { MatchStateService } from '@app/state/match-state.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchStateService) {}

  @Get(':id/score')
  async getScore(@Param('id') matchId: string) {
    return await this.matches.getScoreWithTeams(matchId);
  }
}