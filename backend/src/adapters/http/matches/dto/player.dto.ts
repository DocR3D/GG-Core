import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** The two teams of a match, stable for the whole match (the side CT or T changes at half time, this does not). */
export const LOGICAL_TEAMS = ['home', 'away'] as const;
export type LogicalTeam = (typeof LOGICAL_TEAMS)[number];

/** Body of POST /api/matches/:id/players. */
export class UpsertPlayerDto {
  /** Steam id of the player, in the format the game logs use (for example `[U:1:10000004]`), kept exactly as sent and not checked */
  @IsString()
  @IsNotEmpty()
  steamId!: string;

  /** Name shown for the player; when left out for a player who is already there, his name is kept */
  @IsOptional()
  @IsString()
  name?: string;

  /** Team of the player */
  @ApiProperty({ enum: LOGICAL_TEAMS })
  @IsIn(LOGICAL_TEAMS)
  logical!: LogicalTeam;
}

/** Body of PATCH /api/matches/:id/players/:steamId/move. */
export class MovePlayerDto {
  /** Team the player goes to */
  @ApiProperty({ enum: LOGICAL_TEAMS })
  @IsIn(LOGICAL_TEAMS)
  logical!: LogicalTeam;
}

/** A player of a match. */
export class PlayerDto {
  /** Steam id of the player */
  steamId!: string;
  /** Name shown for the player, when known */
  name?: string;
  /** Team of the player */
  @ApiProperty({ enum: LOGICAL_TEAMS })
  logical!: LogicalTeam;
  /** When the player joined, in milliseconds since 1970 */
  joinedTs?: number;
}

/** Players of a match by team, in lineup order. */
export class RosterDto {
  /** Players of the home team */
  @ApiProperty({ type: () => [PlayerDto] })
  home!: PlayerDto[];
  /** Players of the away team */
  @ApiProperty({ type: () => [PlayerDto] })
  away!: PlayerDto[];
}
