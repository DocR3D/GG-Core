import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/** Body of POST /api/tournament/teams. */
export class CreateTeamsDto {
  /** Team names, one team is created per name */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  names!: string[];
}
