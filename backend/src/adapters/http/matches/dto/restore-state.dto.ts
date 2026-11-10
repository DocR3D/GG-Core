import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { CARRIABLE_ITEMS, MAX_LOSS_STREAK, MAX_MONEY, MAX_PLAYERS_PER_TEAM, TEAM_SIDES, type TeamSide } from '@domain/restore/restore-state';

/** What one team has done so far. */
export class RestoreTeamStateDto {
  /** Rounds the team has won so far, before the round that is replayed */
  @IsInt()
  @Min(0)
  @Max(200)
  score!: number;

  /** Rounds lost in a row: the number CS2 keeps for the loss bonus */
  @IsInt()
  @Min(0)
  @Max(MAX_LOSS_STREAK)
  lossStreak!: number;
}

/** Rounds won by each team in one half of the match. */
export class RestoreHalfScoreDto {
  /** Rounds won by the home team */
  @IsInt()
  @Min(0)
  @Max(12)
  home!: number;

  /** Rounds won by the away team */
  @IsInt()
  @Min(0)
  @Max(12)
  away!: number;
}

/** One player as he is at the start of the round that is replayed. */
export class RestorePlayerStateDto {
  /** SteamID64 (`76561198000000001`) or `[U:1:n]` */
  @IsString()
  steamId!: string;

  /** Name shown, when known */
  @IsOptional()
  @IsString()
  name?: string;

  /** Team of the player */
  @ApiProperty({ enum: ['home', 'away'] })
  @IsIn(['home', 'away'])
  team!: 'home' | 'away';

  /** Money at the start of the round, in dollars */
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  money!: number;

  /** Armour points */
  @IsInt()
  @Min(0)
  @Max(100)
  armor!: number;

  /** Helmet */
  @IsBoolean()
  helmet!: boolean;

  /** Defusal kit (counter-terrorists only) */
  @IsBoolean()
  defuseKit!: boolean;

  /** What the player carries, as CS2 class names: the weapons, the equipment and the knives of Valve's item data */
  @ApiProperty({ type: 'array', items: { type: 'string', enum: [...CARRIABLE_ITEMS] } })
  @IsArray()
  @IsString({ each: true })
  items!: string[];
}

/**
 * Body of POST /api/matches/:id/manual-restore/backup: the state a round is to be put back to. The backend checks every value
 * against the CS2 rules (the sum of the scores, the slots of a player, the bomb...) and answers all the problems at once.
 */
export class RestoreStateDto {
  /** The round to replay (1 = the first round). The two scores add up to this number minus 1 */
  @IsInt()
  @Min(1)
  @Max(200)
  round!: number;

  /** The side the home team plays during that round */
  @ApiProperty({ enum: TEAM_SIDES })
  @IsIn(TEAM_SIDES)
  homeSide!: TeamSide;

  /** The home team */
  @ValidateNested()
  @Type(() => RestoreTeamStateDto)
  home!: RestoreTeamStateDto;

  /** The away team */
  @ValidateNested()
  @Type(() => RestoreTeamStateDto)
  away!: RestoreTeamStateDto;

  /** The players of both teams */
  @ApiProperty({ type: () => [RestorePlayerStateDto], maxItems: MAX_PLAYERS_PER_TEAM * 2 })
  @IsArray()
  @ArrayMaxSize(MAX_PLAYERS_PER_TEAM * 2)
  @ValidateNested({ each: true })
  @Type(() => RestorePlayerStateDto)
  players!: RestorePlayerStateDto[];

  /** The map, e.g. `de_mirage` */
  @IsOptional()
  @IsString()
  map?: string;

  /** Rounds 1 to 12 won by each team: needed once 12 rounds are played */
  @IsOptional()
  @ValidateNested()
  @Type(() => RestoreHalfScoreDto)
  firstHalf?: RestoreHalfScoreDto;

  /** Rounds 13 to 24 won by each team: needed once 24 rounds are played */
  @IsOptional()
  @ValidateNested()
  @Type(() => RestoreHalfScoreDto)
  secondHalf?: RestoreHalfScoreDto;
}

/** The answer: the file, where it goes, how to load it, and what is doubtful. */
export class RestoreBackupDto {
  /** Name to give the file in the game folder of the server */
  fileName!: string;
  /** The file itself: a CS2 round backup (text) */
  content!: string;
  /** The command that loads the file once it is in place */
  rconCommand!: string;
  /** The round the game goes back to */
  round!: number;
  /** What is doubtful but did not stop the file */
  warnings!: string[];
}
