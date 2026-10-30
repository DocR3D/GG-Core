// src/adapters/http/tournament/tournament.controller.ts
import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { MatchFormat, StageType } from '@prisma/client';
import {
  QualificationRule,
  TournamentError,
  TournamentStagesService,
} from '@app/tournament/tournament-stages.service';

/**
 * Tournament structure (database, UUIDs): tournaments, teams, stages, group stage.
 * No authentication yet (JWT = backlog §6). No frontend yet: driven through this API.
 */
@Controller('tournament')
export class TournamentController {
  constructor(private readonly stages: TournamentStagesService) {}

  @Post('tournaments')
  createTournament(@Body() body: { name: string; slug?: string; game?: string }) {
    return this.run(() => this.stages.createTournament(body ?? ({} as any)));
  }

  /** Creates teams by name (until the import from the registration site exists). */
  @Post('teams')
  createTeams(@Body() body: { names: string[] }) {
    return this.run(() => this.stages.createTeams(body?.names));
  }

  @Post('tournaments/:id/stages')
  createStage(
    @Param('id') tournamentId: string,
    @Body() body: { name: string; type: StageType; order: number; settings?: object },
  ) {
    return this.run(() => this.stages.createStage(tournamentId, body ?? ({} as any)));
  }

  /** Spreads the seeded teams into groups (snake) and creates the round-robin matches. */
  @Post('stages/:id/groups/generate')
  generateGroups(
    @Param('id') stageId: string,
    @Body() body: { teamIds?: string[]; groupCount: number; format?: MatchFormat },
  ) {
    return this.run(() => this.stages.generateGroups(stageId, body ?? ({} as any)));
  }

  @Get('stages/:id/standings')
  standings(@Param('id') stageId: string) {
    return this.run(() => this.stages.getStandings(stageId));
  }

  /** Sends group ranks to the next stages (e.g. 1-2 → Elite, 3-4 → Amateur), seeds crossed. */
  @Post('stages/:id/qualify')
  qualify(
    @Param('id') stageId: string,
    @Body() body: { rules: QualificationRule[]; manualOrder?: Record<string, string[]> },
  ) {
    return this.run(() => this.stages.qualify(stageId, body ?? ({} as any)));
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TournamentError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
