// src/adapters/http/tournament/tournament-matches.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ManualResultError, TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';

export type ManualGameResultDto = {
  scoreHome: number;
  scoreAway: number;
  /** Optional (games without maps, or map unknown). */
  mapName?: string;
  /** Who enters the result (admin name); no authentication yet (JWT = backlog §6). */
  reportedBy?: string;
};

/**
 * Tournament series (database Match, UUID) — distinct from /api/matches/:id, which drives the real-time engine.
 */
@Controller('tournament/matches')
export class TournamentMatchesController {
  constructor(private readonly persistence: TournamentPersistenceService) {}

  /** Admin entry of the result of game n° `order` of a series (MANUAL, CONFIRMED); updates the series / bracket. */
  @Post(':id/games/:order/result')
  async recordGameResult(
    @Param('id') matchId: string,
    @Param('order', ParseIntPipe) mapOrder: number,
    @Body() dto: ManualGameResultDto,
  ) {
    try {
      return await this.persistence.recordManualGameResult({
        matchId,
        mapOrder,
        scoreHome: Number(dto?.scoreHome),
        scoreAway: Number(dto?.scoreAway),
        mapName: dto?.mapName?.trim() || undefined,
        reportedBy: dto?.reportedBy?.trim() || 'admin',
      });
    } catch (e) {
      if (!(e instanceof ManualResultError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'finished') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
