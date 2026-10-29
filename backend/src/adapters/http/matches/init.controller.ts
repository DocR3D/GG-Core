// src/adapters/http/matches/init.controller.ts
import { Controller, Param, Post, Body, Logger } from '@nestjs/common';
import { MatchStateService, type GameSide } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchSettings } from '@domain/match-settings.types';

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

@Controller('matches')
export class MatchInitController {
  private readonly logger = new Logger('MatchInitController');

  constructor(
    private readonly matchState: MatchStateService,
    private readonly orch: MatchOrchestrator,
  ) {}

  @Post(':id/init')
  async init(@Param('id') matchId: string, @Body() dto: InitDto = {}) {
    const home = dto.home ?? 'CT';
    const away = dto.away ?? 'T';

    await this.matchState.setSides(matchId, { home, away });
    await this.matchState.initScore(matchId);
    await this.matchState.initTimeouts(
      matchId,
      dto.homeTac ?? 4,
      dto.awayTac ?? 4,
      dto.homeTech ?? 0,
      dto.awayTech ?? 0,
    );
    if (dto.teams) {
      await this.matchState.setTeams(matchId, dto.teams);
    }
    if (dto.settings) {
      await this.matchState.setSettings(matchId, dto.settings);
    }
    if (dto.serverId) {
      await this.matchState.setServerIdToMatchId(dto.serverId, matchId);
      this.logger.debug(`BOUND server "${dto.serverId}" -> match "${matchId}"`);
    }
    if (dto.matchMapId) {
      await this.matchState.setDbMatchMapId(matchId, dto.matchMapId);
      this.logger.debug(`LINKED match "${matchId}" -> MatchMap "${dto.matchMapId}"`);
    }
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

  // Backward compatibility endpoint for CI smoke tests (POST /api/matches/init)
  @Post('init')
  async initWithoutParam(@Body() dto: InitDto & { matchId?: string } = {}) {
    const matchId = dto.matchId ?? 'match-default';
    return this.init(matchId, dto);
  }
}
