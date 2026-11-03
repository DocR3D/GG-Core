// src/adapters/http/matches/match-restore.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RoundRestoreService } from '@app/match/restore/round-restore.service';
import { ProposeRestoreDto, CancelRestoreDto } from '@app/match/restore/round-restore.types';
import type { Session } from '@app/auth/auth.service';

type SessionRequest = Request & { ggSession?: Session | null };

@Controller('matches/:matchId/restore')
export class MatchRestoreController {
  constructor(private readonly restoreService: RoundRestoreService) {}

  @Get('candidates')
  async getCandidates(@Param('matchId') matchId: string) {
    const candidates = await this.restoreService.getRestoreCandidates(matchId);
    return { candidates };
  }

  @Get('proposal')
  async getProposal(@Param('matchId') matchId: string) {
    const proposal = await this.restoreService.getProposal(matchId);
    return { proposal };
  }

  @Post('propose')
  async propose(
    @Param('matchId') matchId: string,
    @Body() dto: ProposeRestoreDto & { team?: 'home' | 'away' },
    @Req() req: SessionRequest,
  ) {
    if (!dto.targetRound) {
      throw new BadRequestException('Le numéro de targetRound est requis');
    }

    const session = req.ggSession;
    const team: 'home' | 'away' = dto.team ?? 'home';
    const name = session?.name ?? 'Admin / Joueur';
    const steamId = session?.via === 'steam' ? session.sub : undefined;

    const proposal = await this.restoreService.proposeRestore(matchId, dto.targetRound, {
      team,
      name,
      steamId,
    });

    return { success: true, proposal };
  }

  @Post('confirm')
  async confirm(
    @Param('matchId') matchId: string,
    @Body() body: { team?: 'home' | 'away' },
    @Req() req: SessionRequest,
  ) {
    const session = req.ggSession;
    const isAdmin = session?.role === 'admin';
    const team = body.team ?? (isAdmin ? undefined : 'away');
    const name = session?.name ?? (isAdmin ? 'Admin' : 'Joueur');
    const steamId = session?.via === 'steam' ? session.sub : undefined;

    const proposal = await this.restoreService.confirmRestore(matchId, {
      team,
      name,
      steamId,
      isAdmin,
    });

    return { success: true, proposal };
  }

  @Post('cancel')
  async cancel(
    @Param('matchId') matchId: string,
    @Body() dto: CancelRestoreDto & { team?: 'home' | 'away' },
    @Req() req: SessionRequest,
  ) {
    const session = req.ggSession;
    const isAdmin = session?.role === 'admin';
    const team = dto.team;
    const name = session?.name ?? 'Joueur';
    const steamId = session?.via === 'steam' ? session.sub : undefined;

    const cancelled = await this.restoreService.cancelRestore(matchId, {
      team,
      name,
      steamId,
      isAdmin,
      reason: dto.reason,
    });

    return { success: cancelled };
  }
}
