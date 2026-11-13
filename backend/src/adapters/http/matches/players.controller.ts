import { Controller, Param, Body, Post, Patch, Delete, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';
import { OkResponseDto } from './dto/ok-response.dto';
import { MovePlayerDto, RosterDto, UpsertPlayerDto } from './dto/player.dto';

// The sentence above each route (its summary) comes from the comment; the rules go in the description, which the
// plugin cannot take from a comment.
@Controller('matches/:id/players')
export class PlayersController {
  constructor(private readonly matchState: MatchStateService) {}

  /** Adds a player to a match, or updates the one with the same Steam id */
  @ApiOperation({
    description:
      'Admin only. The Steam id is the key and is kept exactly as sent (no conversion between its spellings, no format check). ' +
      'When the player is already there, the name (if sent) and the team are replaced, and the time he joined is kept. ' +
      'A new player goes to the end of the lineup of his team. There is no limit of players per team, and the route does not check that the match exists.',
  })
  @Post()
  async upsert(@Param('id') matchId: string, @Body() body: UpsertPlayerDto): Promise<OkResponseDto> {
    await this.matchState.upsertPlayer(matchId, body);
    return { ok: true };
  }

  /** Moves a player to the given team */
  @ApiOperation({
    description:
      'Admin only. The player goes to the end of the lineup of the other team. ' +
      'Answers `ok: false` (still a 200, not a 404) when the player is not in the match, and `ok: true` without any change when he is already in that team.',
  })
  @Patch(':steamId/move')
  async move(@Param('id') matchId: string, @Param('steamId') steamId: string, @Body() body: MovePlayerDto): Promise<OkResponseDto> {
    const ok = await this.matchState.movePlayerLogical(matchId, steamId, body.logical);
    return { ok };
  }

  /** Removes a player from a match */
  @ApiOperation({ description: 'Admin only. Always answers `ok: true`, including when the player was not in the match.' })
  @Delete(':steamId')
  async remove(@Param('id') matchId: string, @Param('steamId') steamId: string): Promise<OkResponseDto> {
    await this.matchState.removePlayer(matchId, steamId);
    return { ok: true };
  }

  /** Lists the players of a match by team */
  @ApiOperation({ description: 'Public. Each team is in lineup order. A match without players, or unknown, gives two empty lists.' })
  @Get()
  async list(@Param('id') matchId: string): Promise<RosterDto> {
    return this.matchState.getPlayers(matchId);
  }
}
