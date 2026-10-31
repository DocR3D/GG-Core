// src/adapters/http/matches/matches.controller.ts
import { Controller, Param, Post, Get, Patch, Body, Logger, NotFoundException } from '@nestjs/common';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchSettings } from '@domain/match-settings.types';
import type { GameSide } from '@domain/side.types';

export type InitDto = {
  home?: GameSide;
  away?: GameSide;
  homeTac?: number;
  awayTac?: number;
  homeTech?: number;
  awayTech?: number;
  teams?: { home_id?: string; away_id?: string; home_name?: string; away_name?: string };
  serverId?: string;
  /** UUID du MatchMap PostgreSQL joué : rattache l'event sourcing et les stats au modèle relationnel */
  matchMapId?: string;
  mapName?: string;
  settings?: Partial<MatchSettings>;
};

export type SetTeamsDto = {
  home_id?: string;
  away_id?: string;
  ct_id?: string;
  t_id?: string;
  home_name?: string;
  away_name?: string;
  ct_name?: string;
  t_name?: string;
};

@Controller('matches')
export class MatchesController {
  private readonly logger = new Logger(MatchesController.name);

  constructor(
    private readonly matchState: MatchStateService,
    private readonly orch: MatchOrchestrator,
  ) {}

  @Post(':id/init')
  async init(@Param('id') matchId: string, @Body() dto: InitDto = {}) {
    await this.matchState.initMatchState(matchId, dto as any);
    return { ok: true, matchId };
  }

  @Post(':id/start')
  async start(@Param('id') matchId: string, @Body() dto: InitDto = {}) {
    // 1. Initialize state first
    await this.init(matchId, dto);

    // 2. Automated server commands if serverId provided
    if (dto.serverId) {
      const res = await this.orch.startMatch({
        serverId: dto.serverId,
        matchId,
        mapName: dto.mapName,
        settings: dto.settings,
      });
      return res;
    }

    return { ok: true, matchId };
  }

  /** Result frozen because the server's Game Over disagrees with GG-Core (null when none). */
  @Get(':id/review')
  async review(@Param('id') matchId: string) {
    return { matchId, review: await this.orch.getReview(matchId) };
  }

  /** Admin decision on a frozen result: take the server's score / end, or lift the freeze. */
  @Post(':id/review/:decision')
  async resolveReview(@Param('id') matchId: string, @Param('decision') decision: string) {
    if (decision !== 'accept-server' && decision !== 'dismiss') {
      throw new NotFoundException('decision: accept-server | dismiss');
    }
    const res = await this.orch.resolveReview(matchId, decision === 'accept-server' ? 'accept_server' : 'dismiss');
    if (!res.ok) throw new NotFoundException(`no review pending for match ${matchId}`);
    return res;
  }

  // Backward compatibility endpoint for CI smoke tests (POST /api/matches/init)
  @Post('init')
  async initWithoutParam(@Body() dto: InitDto & { matchId?: string } = {}) {
    const matchId = dto.matchId ?? 'match-default';
    return this.init(matchId, dto);
  }

  // GET /api/matches/:id/score-with-teams
  @Get(':id/score-with-teams')
  async getScoreWithTeams(@Param('id') matchId: string) {
    return this.matchState.getScoreWithTeams(matchId);
  }

  // PATCH /api/matches/:id/teams
  @Patch(':id/teams')
  async setTeams(@Param('id') matchId: string, @Body() dto: SetTeamsDto) {
    await this.matchState.setTeams(matchId, dto);
    return { ok: true };
  }

  // GET /api/matches/:id/snapshot
  @Get(':id/snapshot')
  async getSnapshot(@Param('id') matchId: string) {
    return this.matchState.getSnapshot(matchId);
  }
}
