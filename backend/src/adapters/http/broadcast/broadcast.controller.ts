// src/adapters/http/broadcast/broadcast.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '@app/auth/auth.service';
import { BuytimeBroadcastService } from '@app/broadcast/buytime-broadcast.service';
import { CreateBroadcastDto, RearmBroadcastDto } from '@app/broadcast/buytime-broadcast.types';
import { authorOf } from '../tournament/tournament-matches.controller';

type AdminRequest = Request & { ggSession?: Session | null };

@Controller('admin/broadcasts')
export class BroadcastController {
  constructor(private readonly broadcastService: BuytimeBroadcastService) {}

  /**
   * Arm a broadcast message to be displayed at buytime across target servers.
   * Can be configured to repeat for N rounds (e.g. roundsCount = 3).
   */
  @Post()
  @HttpCode(201)
  async createBroadcast(@Body() dto: CreateBroadcastDto, @Req() req: AdminRequest) {
    const author = authorOf(req.ggSession);
    return this.broadcastService.createBroadcast(dto, author);
  }

  /**
   * List all broadcasts (active, completed, cancelled) with per-server delivery progress.
   */
  @Get()
  async listBroadcasts() {
    return this.broadcastService.listBroadcasts();
  }

  /**
   * Get single broadcast status.
   */
  @Get(':id')
  async getBroadcast(@Param('id') id: string) {
    const broadcast = await this.broadcastService.getBroadcast(id);
    if (!broadcast) {
      throw new NotFoundException(`Annonce ${id} introuvable`);
    }
    return broadcast;
  }

  /**
   * Re-arm an existing broadcast for additional rounds (e.g. { additionalRounds: 2 }).
   */
  @Post(':id/rearm')
  @HttpCode(200)
  async rearmBroadcast(@Param('id') id: string, @Body() dto: RearmBroadcastDto) {
    return this.broadcastService.rearmBroadcast(id, dto);
  }

  /**
   * Cancel an active broadcast (stops future round delivery).
   */
  @Delete(':id')
  @HttpCode(200)
  async cancelBroadcast(@Param('id') id: string) {
    return this.broadcastService.cancelBroadcast(id);
  }
}
