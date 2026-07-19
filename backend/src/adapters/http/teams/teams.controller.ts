// src/adapters/http/teams/teams.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';

class TeamDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Team Alpha' }) name: string;
}

const MOCK_TEAMS: TeamDto[] = [
  { id: 1, name: 'Team Alpha' },
  { id: 2, name: 'Team Bravo' },
  { id: 3, name: 'Team Charlie' },
  { id: 4, name: 'Team Delta' },
];

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  @Get()
  @ApiOperation({ summary: 'Liste des équipes (mock — pas de BDD)' })
  findAll(): TeamDto[] {
    return MOCK_TEAMS;
  }
}
