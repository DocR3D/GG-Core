// src/adapters/http/matches/admin-call.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminCallService } from '@app/match/admin-call/admin-call.service';
import type { Session } from '@app/auth/auth.service';

type SessionRequest = Request & { ggSession?: Session | null };

@Controller('matches/:matchId/admin-calls')
export class AdminCallController {
  constructor(private readonly adminCallService: AdminCallService) {}

  @Get()
  async getCalls(@Param('matchId') matchId: string) {
    const calls = await this.adminCallService.getCalls(matchId);
    return { calls };
  }

  @Post(':callId/ack')
  async ackCall(
    @Param('matchId') matchId: string,
    @Param('callId') callId: string,
    @Req() req: SessionRequest,
  ) {
    const adminName = req.ggSession?.name ?? 'Admin';
    const call = await this.adminCallService.ackCall(matchId, callId, adminName);
    if (!call) {
      throw new NotFoundException(`Appel introuvable pour callId=${callId}`);
    }
    return { success: true, call };
  }

  @Post(':callId/resolve')
  async resolveCall(
    @Param('matchId') matchId: string,
    @Param('callId') callId: string,
    @Req() req: SessionRequest,
  ) {
    const adminName = req.ggSession?.name ?? 'Admin';
    const call = await this.adminCallService.resolveCall(matchId, callId, adminName);
    if (!call) {
      throw new NotFoundException(`Appel introuvable pour callId=${callId}`);
    }
    return { success: true, call };
  }
}
