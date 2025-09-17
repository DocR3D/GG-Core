import { Controller, Param, Body, Post, Patch, Delete, Get } from '@nestjs/common';
import { MatchStateService } from '@app/match/state/match-state.service';

@Controller('matches/:id/players')
export class PlayersController {
  constructor(private readonly matchState: MatchStateService) {}

  @Post()
  async upsert(@Param('id') matchId: string, @Body() body: {steamId: string; name?: string; logical: 'home'|'away'}) {
    await this.matchState.upsertPlayer(matchId, body);
    return { ok: true };
  }

  @Patch(':steamId/move')
  async move(@Param('id') matchId: string, @Param('steamId') steamId: string, @Body() body: {logical: 'home'|'away'}) {
    const ok = await this.matchState.movePlayerLogical(matchId, steamId, body.logical);
    return { ok };
  }

  @Delete(':steamId')
  async remove(@Param('id') matchId: string, @Param('steamId') steamId: string) {
    await this.matchState.removePlayer(matchId, steamId);
    return { ok: true };
  }

  @Get()
  async list(@Param('id') matchId: string) {
    return this.matchState.getPlayers(matchId);
  }
}