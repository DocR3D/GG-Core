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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '@app/auth/auth.service';
import { ManualResultError, TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';

export type ManualGameResultDto = {
  scoreHome: number;
  scoreAway: number;
  /** Optional (games without maps, or map unknown). */
  mapName?: string;
};

/** Who did it, from the session - never from the request body (an admin could write any name there). */
export const authorOf = (session: Session | null | undefined) => (session?.name ?? 'admin').slice(0, 64);

/**
 * Tournament series (database Match, UUID) - distinct from /api/matches/:id, which drives the real-time engine.
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
    @Req() req: Request & { ggSession?: Session | null },
  ) {
    try {
      return await this.persistence.recordManualGameResult({
        matchId,
        mapOrder,
        scoreHome: Number(dto?.scoreHome),
        scoreAway: Number(dto?.scoreAway),
        mapName: dto?.mapName?.trim() || undefined,
        reportedBy: authorOf(req.ggSession),
      });
    } catch (e) {
      if (!(e instanceof ManualResultError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'finished') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
