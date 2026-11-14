import { Controller, Param, Body, Post, Patch, Delete, Get } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';
import { AdminOnly } from '../docs/admin-only.decorator';
import { OkResponseDto } from './dto/ok-response.dto';
import { MovePlayerDto, RosterDto, UpsertPlayerDto } from './dto/player.dto';

const BODY_REFUSED = 'The body breaks a rule: refused in the strict validation mode (rec and prod), only logged in the tolerant one (dev)';
const PLAYER_ID_PARAM = { name: 'steamId', description: 'Id of the player, as sent when he was added (not converted)', example: '[U:1:10000004]' };

// The sentence above each route (its summary) comes from the comment; the rules go in the description, which the
// plugin cannot take from a comment.
@ApiParam({ name: 'id', description: 'Id of the match', example: '5f2b8c1e-3d4a-4e7b-9c10-2a6f8d3b7e45' })
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
  @AdminOnly()
  @ApiCreatedResponse({ description: 'The player is in the match, on the team asked', type: OkResponseDto })
  @ApiBadRequestResponse({ description: BODY_REFUSED })
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
  @AdminOnly()
  @ApiParam(PLAYER_ID_PARAM)
  @ApiOkResponse({ description: '`ok: true` when the player is on the team asked, `ok: false` when he is not in the match', type: OkResponseDto })
  @ApiBadRequestResponse({ description: BODY_REFUSED })
  @Patch(':steamId/move')
  async move(@Param('id') matchId: string, @Param('steamId') steamId: string, @Body() body: MovePlayerDto): Promise<OkResponseDto> {
    const ok = await this.matchState.movePlayerLogical(matchId, steamId, body.logical);
    return { ok };
  }

  /** Removes a player from a match */
  @ApiOperation({ description: 'Admin only. Always answers `ok: true`, including when the player was not in the match.' })
  @AdminOnly()
  @ApiParam(PLAYER_ID_PARAM)
  @ApiOkResponse({ description: 'The player is no longer in the match', type: OkResponseDto })
  @Delete(':steamId')
  async remove(@Param('id') matchId: string, @Param('steamId') steamId: string): Promise<OkResponseDto> {
    await this.matchState.removePlayer(matchId, steamId);
    return { ok: true };
  }

  /** Lists the players of a match by team */
  @ApiOperation({ description: 'Public. Each team is in lineup order. A match without players, or unknown, gives two empty lists.' })
  @ApiOkResponse({ description: 'The players of each team', type: RosterDto })
  @Get()
  async list(@Param('id') matchId: string): Promise<RosterDto> {
    return this.matchState.getPlayers(matchId);
  }
}
