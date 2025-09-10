// matches.controller.ts
import { Controller, Patch, Get, Param, Body } from '@nestjs/common';
import { MatchStateService } from '@app/state/match-state.service';

type SetTeamsDto = {
  home_id?: string;
  away_id?: string;
  ct_id?: string;
  t_id?: string;
  home_name?: string;
  away_name?: string;
  ct_name?: string;
  t_name?: string;
};

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchStateService) {}

  // GET /api/matches/:id/score-with-teams
  @Get(':id/score-with-teams')
  async getScoreWithTeams(@Param('id') matchId: string) {
    return this.matches.getScoreWithTeams(matchId);
  }

    // PATCH /matches/:id/teams
  @Patch(':id/teams')
  async setTeams(
    @Param('id') matchId: string,
    @Body() dto: SetTeamsDto,
  ) {
    await this.matches.setTeams(matchId, dto); // écrit dans match:{id}:teams (HASH)
    return { ok: true };
  }

    // GET /api/matches/:id/snapshot
  @Get(':id/snapshot')
  async getSnapshot(@Param('id') matchId: string) {
    return this.matches.getSnapshot(matchId);
  }
  
}