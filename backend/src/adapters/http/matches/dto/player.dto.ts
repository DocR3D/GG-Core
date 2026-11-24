import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/** The two teams of a match, stable for the whole match (the side CT or T changes at half time, this does not). */
export const LOGICAL_TEAMS = ['home', 'away'] as const;
export type LogicalTeam = (typeof LOGICAL_TEAMS)[number];

/**
 * Sanity guards, not rules of a game: a player id or a name longer than this is a mistake whatever the game is (a Steam
 * id is far shorter, a Steam name is at most 32 characters).
 */
export const PLAYER_ID_MAX_LENGTH = 64;
export const PLAYER_NAME_MAX_LENGTH = 100;

/** Body of POST /api/matches/:id/players. */
@ApiSchema({ description: 'A player to add to a match, or whose name and team to update' })
export class UpsertPlayerDto {
  /** Id of the player: for CS2 his Steam id, in the format the game logs use. Kept exactly as sent, its format is not checked */
  @ApiProperty({ example: '[U:1:10000004]', minLength: 1, maxLength: PLAYER_ID_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLAYER_ID_MAX_LENGTH)
  steamId!: string;

  /** Name shown for the player; when left out for a player who is already there, his name is kept. `null` is refused */
  @ApiPropertyOptional({ example: 'Garitos', minLength: 1, maxLength: PLAYER_NAME_MAX_LENGTH, nullable: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(PLAYER_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: 'name must contain at least one character that is not a space' })
  name?: string;

  /** Team of the player */
  @ApiProperty({ enum: LOGICAL_TEAMS, example: 'home' })
  @IsIn(LOGICAL_TEAMS)
  logical!: LogicalTeam;
}

/** Body of PATCH /api/matches/:id/players/:steamId/move. */
@ApiSchema({ description: 'The team a player moves to' })
export class MovePlayerDto {
  /** Team the player goes to */
  @ApiProperty({ enum: LOGICAL_TEAMS, example: 'away' })
  @IsIn(LOGICAL_TEAMS)
  logical!: LogicalTeam;
}

/** A player of a match. */
@ApiSchema({ description: 'A player of a match, with his team and when he joined' })
export class PlayerDto {
  /** Id of the player (for CS2 his Steam id), as it was sent when he was added */
  @ApiProperty({ example: '[U:1:10000004]' })
  steamId!: string;
  /** Name shown for the player, when known */
  @ApiPropertyOptional({ example: 'Garitos' })
  name?: string;
  /** Team of the player */
  @ApiProperty({ enum: LOGICAL_TEAMS, example: 'home' })
  logical!: LogicalTeam;
  /** When the player joined, in milliseconds since 1970 */
  @ApiPropertyOptional({ type: 'integer', minimum: 0, example: 1767225600000 })
  joinedTs?: number;
}

/** Players of a match by team, in lineup order. */
@ApiSchema({ description: 'The players of a match by team, each team in lineup order' })
export class RosterDto {
  /** Players of the home team */
  @ApiProperty({ type: () => [PlayerDto] })
  home!: PlayerDto[];
  /** Players of the away team */
  @ApiProperty({ type: () => [PlayerDto] })
  away!: PlayerDto[];
}
