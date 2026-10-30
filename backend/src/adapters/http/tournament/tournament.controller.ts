// src/adapters/http/tournament/tournament.controller.ts
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { MatchFormat, StageType } from '@prisma/client';
import {
  DoubleElimFormats,
  QualificationRule,
  TournamentError,
  TournamentStagesService,
} from '@app/tournament/tournament-stages.service';
import { TournamentLaunchService } from '@app/tournament/tournament-launch.service';
import { MatchSettings } from '@domain/match-settings.types';

/**
 * Tournament structure (database, UUIDs): tournaments, teams, stages, group stage.
 * No authentication yet (JWT = backlog §6). No frontend yet: driven through this API.
 */
@Controller('tournament')
export class TournamentController {
  constructor(
    private readonly stages: TournamentStagesService,
    private readonly launch: TournamentLaunchService,
  ) {}

  /** The data behind the /view pages, as JSON. */
  @Get('tournaments/:id/overview')
  overview(@Param('id') tournamentId: string) {
    return this.run(() => this.stages.getOverview(tournamentId));
  }

  // --- Servers ------------------------------------------------------------------------------------------

  /** Servers with availability: free / busy (running match) / disabled. */
  @Get('servers')
  servers() {
    return this.run(() => this.launch.listServers());
  }

  /** Registers a game server; `name` = agent id (agents.d/<name>.yaml, e.g. "srv-a"). */
  @Post('servers')
  createServer(@Body() body: { name: string; ip: string; port?: number; game?: string }) {
    return this.run(() => this.launch.createServer(body ?? ({} as any)));
  }

  /**
   * disable: dead PC / server, never chosen for a game · enable: back in service ·
   * release: frees a server stuck on a match that will never end (crash, cut replay).
   */
  @Post('servers/:id/:action')
  setServer(@Param('id') idOrName: string, @Param('action') action: string) {
    if (action === 'release') return this.run(() => this.launch.releaseServer(idOrName));
    if (action !== 'disable' && action !== 'enable') throw new NotFoundException('action: disable | enable | release');
    return this.run(() => this.launch.setServerEnabled(idOrName, action === 'enable'));
  }

  /**
   * Starts game n° `order` of a series on a server chosen by the admin (real-time engine; the result flows back
   * automatically). Relaunch on another server after a crash: same call with the other server.
   */
  @Post('matches/:id/games/:order/launch')
  launchGame(
    @Param('id') matchId: string,
    @Param('order', ParseIntPipe) order: number,
    @Body() body: { server: string; mapName: string; settings?: Partial<MatchSettings> },
  ) {
    return this.run(() => this.launch.launchGame({ matchId, order, server: body?.server, mapName: body?.mapName, settings: body?.settings }));
  }

  @Get('tournaments')
  listTournaments() {
    return this.stages.listTournaments();
  }

  @Post('tournaments')
  createTournament(@Body() body: { name: string; slug?: string; game?: string }) {
    return this.run(() => this.stages.createTournament(body ?? ({} as any)));
  }

  /** Deletes a tournament and the teams that took part in no other tournament. */
  @Delete('tournaments/:id')
  deleteTournament(@Param('id') tournamentId: string) {
    return this.run(() => this.stages.deleteTournament(tournamentId));
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

  /**
   * Double-elimination bracket of a stage (participants from the qualification, or teamIds in seed order).
   * formats: { upper, lower, grandFinal } - defaults BO1 / BO1 / BO3, grand final with a one-map advantage.
   */
  @Post('stages/:id/bracket/generate')
  generateBracket(@Param('id') stageId: string, @Body() body: { teamIds?: string[]; formats?: DoubleElimFormats }) {
    return this.run(() => this.stages.generateDoubleElimination(stageId, body ?? {}));
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
