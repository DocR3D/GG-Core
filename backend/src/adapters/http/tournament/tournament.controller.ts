// src/adapters/http/tournament/tournament.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { MatchFormat, StageType } from '@prisma/client';
import {
  DoubleElimFormats,
  QualificationRule,
  TournamentError,
  TournamentStagesService,
} from '@app/tournament/tournament-stages.service';
import { TournamentLaunchService } from '@app/tournament/tournament-launch.service';
import { VetoService } from '@app/tournament/veto.service';
import { TournamentAdminService } from '@app/tournament/tournament-admin.service';
import type { Session } from '@app/auth/auth.service';
import type { VetoConfig } from '@domain/tournament/veto';
import { actorOf } from '../veto/veto.controller';
import { authorOf } from './tournament-matches.controller';
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
    private readonly veto: VetoService,
    private readonly admin: TournamentAdminService,
  ) {}

  /** The data behind the /view pages, as JSON. */
  @Get('tournaments/:id/overview')
  overview(@Param('id') tournamentId: string) {
    return this.run(() => this.stages.getOverview(tournamentId));
  }

  /** Teams of a tournament with their roster (ids, SteamID, captain, role). */
  @Get('tournaments/:id/teams')
  teams(@Param('id') tournamentId: string) {
    return this.run(() => this.stages.tournamentTeams(tournamentId));
  }

  /** A series: teams (with ids), games (with the engine id), provenance and next match in the bracket, stats. */
  @Get('matches/:id')
  matchDetail(@Param('id') matchId: string) {
    return this.run(() => this.stages.getMatchDetail(matchId));
  }

  /** Every game being played (admin dashboard): series, server, phase, score per team, pause, frozen result. */
  @Get('live')
  live() {
    return this.run(() => this.launch.liveGames());
  }

  // --- Servers ------------------------------------------------------------------------------------------

  /** Servers with availability: free / busy (running match) / disabled. */
  @Get('servers')
  servers() {
    return this.run(() => this.launch.listServers());
  }

  /** Registers a game server; `name` = agent id (agents.d/<name>.yaml, e.g. "srv-a"). */
  @Post('servers')
  createServer(@Body() body: { name: string; ip: string; port?: number; tvPort?: number; game?: string }) {
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
   * Starts game n° `order` of a series on a server chosen by the admin, or without `server` on the first free one
   * (real-time engine; the result flows back automatically). Relaunch on another server after a crash: same call
   * with the other server (or none: a free server whose agent answers). A new server
   * password and the whitelist of the two rosters are set unless `access: { password: false, whitelist: false }`.
   */
  @Post('matches/:id/games/:order/launch')
  launchGame(
    @Param('id') matchId: string,
    @Param('order', ParseIntPipe) order: number,
    @Body() body: { server?: string; mapName?: string; settings?: Partial<MatchSettings>; access?: { password?: boolean; whitelist?: boolean } },
  ) {
    return this.run(() =>
      this.launch.launchGame({ matchId, order, server: body?.server, mapName: body?.mapName, settings: body?.settings, access: body?.access }),
    );
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

  // --- Admin operations of the LAN day ----------------------------------------------------------------------

  /** Forfeit: { absentTeamId } - the other team wins the series and moves on in the bracket. */
  @Post('matches/:id/forfeit')
  forfeit(@Param('id') matchId: string, @Body() body: { absentTeamId: string }, @Req() req: Request & { ggSession?: Session | null }) {
    return this.run(() => this.admin.forfeit(matchId, body?.absentTeamId, authorOf(req.ggSession)));
  }

  /**
   * Format on the fly: { matchIds: [...] } or { stageId, bracket?: UPPER | LOWER | FINAL }, + format. Matches not
   * started only; a veto already begun is erased. Answers changed / vetoReset / skipped (with the reason).
   */
  @Post('matches/format')
  setFormat(@Body() body: { matchIds?: string[]; stageId?: string; bracket?: 'UPPER' | 'LOWER' | 'FINAL'; format: MatchFormat }) {
    return this.run(() => this.admin.setFormat(body ?? ({} as any)));
  }

  /** Replaces a team in a match not started: { teamId, newTeamId }. */
  @Post('matches/:id/replace-team')
  replaceTeam(@Param('id') matchId: string, @Body() body: { teamId: string; newTeamId: string }) {
    return this.run(() => this.admin.replaceTeam(matchId, body?.teamId, body?.newTeamId));
  }

  /** Bonus match: { homeTeamId, awayTeamId, format?, placement? (7 = for 7th / 8th), countsInStats? }. */
  @Post('tournaments/:id/bonus-matches')
  createBonusMatch(
    @Param('id') tournamentId: string,
    @Body() body: { homeTeamId: string; awayTeamId: string; format?: MatchFormat; placement?: number; countsInStats?: boolean },
  ) {
    return this.run(() => this.admin.createBonusMatch(tournamentId, body ?? ({} as any)));
  }

  /** Removes a bonus match not started. */
  @Delete('bonus-matches/:id')
  deleteBonusMatch(@Param('id') matchId: string) {
    return this.run(() => this.admin.deleteBonusMatch(matchId));
  }

  // --- Veto (the page and the captains' actions: /veto/:matchId) --------------------------------------------

  /** Map pool and side mode (knife | pick) of a tournament: { mapPool: [...], sideMode? }. */
  @Put('tournaments/:id/veto')
  setTournamentVeto(@Param('id') tournamentId: string, @Body() body: Partial<VetoConfig>) {
    return this.run(() => this.veto.setTournamentConfig(tournamentId, body ?? {}));
  }

  /** Same for one stage (overrides the tournament's, e.g. another pool for the Élite bracket). */
  @Put('stages/:id/veto')
  setStageVeto(@Param('id') stageId: string, @Body() body: Partial<VetoConfig>) {
    return this.run(() => this.veto.setStageConfig(stageId, body ?? {}));
  }

  /** Players of a team for a tournament: { players: [{ username, steamId?, captain? }] }. */
  @Post('tournaments/:id/teams/:teamId/players')
  addPlayers(@Param('id') tournamentId: string, @Param('teamId') teamId: string, @Body() body: { players: { username: string; steamId?: string; captain?: boolean }[] }) {
    return this.run(() => this.veto.addPlayers(tournamentId, teamId, body?.players));
  }

  /** Captain of a team for a tournament (plays rock-paper-scissors and the veto): { playerId }. */
  @Put('tournaments/:id/teams/:teamId/captain')
  setCaptain(@Param('id') tournamentId: string, @Param('teamId') teamId: string, @Body() body: { playerId: string }) {
    return this.run(() => this.veto.setCaptain(tournamentId, teamId, body?.playerId));
  }

  /**
   * "My vetos": the unfinished matches of the logged-in captain's teams (Steam login), `myTurn` when it has to act.
   * Live updates: WebSocket room of each match (`veto:updated`).
   */
  @Get('vetos/mine')
  myVetos(@Req() req: Request & { ggSession?: Session | null }) {
    const actor = actorOf(req.ggSession);
    if (!actor) throw new HttpException({ statusCode: 401, message: 'authentication required (Sign in through Steam on /login)' }, 401);
    return this.run(() => this.veto.listForCaptain(actor));
  }

  /** Vetos of a tournament: phase, team(s) expected and since when - spots a slow captain (no timer). */
  @Get('tournaments/:id/vetos')
  tournamentVetos(@Param('id') tournamentId: string) {
    return this.run(() => this.veto.listForTournament(tournamentId));
  }

  /** Veto state of a match (RPS choices of the round being played stay hidden). */
  @Get('matches/:id/veto')
  vetoState(@Param('id') matchId: string, @Req() req: Request & { ggSession?: Session | null }) {
    return this.run(() => this.veto.getState(matchId, actorOf(req.ggSession)));
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TournamentError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
