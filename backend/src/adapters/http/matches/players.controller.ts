import { Controller, Param, Body, Post, Patch, Delete, Get } from '@nestjs/common';
import { MatchStateService } from '@app/match/state/match-state.service';
import { OkResponseDto } from './dto/ok-response.dto';
import { MovePlayerDto, RosterDto, UpsertPlayerDto } from './dto/player.dto';

@Controller('matches/:id/players')
export class PlayersController {
  constructor(private readonly matchState: MatchStateService) {}

  /** Adds a player to a match, or updates the one with the same Steam id */
  @Post()
  async upsert(@Param('id') matchId: string, @Body() body: UpsertPlayerDto): Promise<OkResponseDto> {
    await this.matchState.upsertPlayer(matchId, body);
    return { ok: true };
  }

  /** Moves a player to the given team */
  @Patch(':steamId/move')
  async move(@Param('id') matchId: string, @Param('steamId') steamId: string, @Body() body: MovePlayerDto): Promise<OkResponseDto> {
    const ok = await this.matchState.movePlayerLogical(matchId, steamId, body.logical);
    return { ok };
  }

  /** Removes a player from a match */
  @Delete(':steamId')
  async remove(@Param('id') matchId: string, @Param('steamId') steamId: string): Promise<OkResponseDto> {
    await this.matchState.removePlayer(matchId, steamId);
    return { ok: true };
  }

  /** Lists the players of a match by team */
  @Get()
  async list(@Param('id') matchId: string): Promise<RosterDto> {
    return this.matchState.getPlayers(matchId);
  }
}
