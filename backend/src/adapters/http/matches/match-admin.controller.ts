// src/adapters/http/matches/match-admin.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '@app/auth/auth.service';
import { MatchAdminError, MatchAdminService } from '@app/match/admin/match-admin.service';
import { authorOf } from '../tournament/tournament-matches.controller';

type AdminRequest = Request & { ggSession?: Session | null };

/**
 * Match console (admins): commands on a match of the real-time engine (for a tournament game, its game id) and its
 * event log. Every POST here is admin-only like any change (auth middleware); the author comes from the session.
 */
@Controller('matches/:id')
export class MatchAdminController {
  constructor(private readonly admin: MatchAdminService) {}

  /** Technical pause, until Reprendre. */
  @Post('pause')
  @HttpCode(200)
  pause(@Param('id') matchId: string, @Req() req: AdminRequest) {
    return this.run(() => this.admin.pauseMatch(matchId, authorOf(req.ggSession)));
  }

  /** Resume (any pause, or the server's own pause after a backup restore). */
  @Post('unpause')
  @HttpCode(200)
  unpause(@Param('id') matchId: string, @Req() req: AdminRequest) {
    return this.run(() => this.admin.unpauseMatch(matchId, authorOf(req.ggSession)));
  }

  /** Start without waiting for !ready (warmup, knife warmup, halftime warmup). */
  @Post('force-start')
  @HttpCode(200)
  forceStart(@Param('id') matchId: string, @Req() req: AdminRequest) {
    return this.run(() => this.admin.forceStart(matchId, authorOf(req.ggSession)));
  }

  /** Before the live: the two teams change side, GG-Core follows them. */
  @Post('swap-teams')
  @HttpCode(200)
  swapTeams(@Param('id') matchId: string, @Req() req: AdminRequest) {
    return this.run(() => this.admin.swapTeams(matchId, authorOf(req.ggSession)));
  }

  /** Replay a round from the backup CS2 wrote at its start: { round } (1 = first round). */
  @Post('restore')
  @HttpCode(200)
  restore(@Param('id') matchId: string, @Body() body: { round: number }, @Req() req: AdminRequest) {
    return this.run(() => this.admin.restoreRound(matchId, Number(body?.round), authorOf(req.ggSession)));
  }

  /** Message in the game chat: { message }. */
  @Post('say')
  @HttpCode(200)
  say(@Param('id') matchId: string, @Body() body: { message: string }, @Req() req: AdminRequest) {
    return this.run(() => this.admin.say(matchId, body?.message, authorOf(req.ggSession)));
  }

  /** Event log of the match (admins: it holds the chat, the raw logs and the admin actions), oldest first. */
  @Get('events')
  events(@Param('id') matchId: string, @Query('limit') limit: string | undefined, @Req() req: AdminRequest) {
    if (req.ggSession?.role !== 'admin') throw new ForbiddenException('admins only');
    return this.admin.events(matchId, Number(limit) || 200);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof MatchAdminError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
