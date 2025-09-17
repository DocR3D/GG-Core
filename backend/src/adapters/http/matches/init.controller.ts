// src/adapters/http/matches/init.controller.ts
import { Controller, Param, Post, Body, Logger } from '@nestjs/common';
import { MatchStateService, type GameSide } from '@app/match/state/match-state.service';

type InitDto = {
  home?: GameSide;          // 'CT' | 'T' (défaut: 'CT')
  away?: GameSide;          // 'CT' | 'T' (défaut: 'T')
  homeTac?: number;     // défaut: 4
  awayTac?: number;     // défaut: 4
  homeTech?: number;    // défaut: 0
  awayTech?: number;    // défaut: 0
  teams?: { home_id?: string; away_id?: string; home_name?: string; away_name?: string };
  serverId?: string;
};

@Controller('matches/:id/init')
export class MatchInitController {
  constructor(private readonly matchState: MatchStateService) {}
    private readonly logger = new Logger('MatchInitController');

  @Post()
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
    if (dto.serverId) {
      await this.matchState.setServerIdToMatchId(dto.serverId, matchId);
      this.logger.debug(`BOUND server "${dto.serverId}" -> match "${matchId}"`);
    }
    return { ok: true };
  }
}
