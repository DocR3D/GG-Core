// src/adapters/http/tournament/tournament-config.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { TournamentConfigService } from '@app/config/tournament-config.service';
import { PrismaService } from '@adapters/database/prisma.service';
import type { TournamentCustomConfig } from '@domain/config/config.types';

@Controller('tournament')
export class TournamentConfigController {
  constructor(
    private readonly configService: TournamentConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns default baseline configuration (all available commands, message templates and rules).
   */
  @Get('config/defaults')
  getDefaults() {
    return this.configService.getDefaults();
  }

  /**
   * Returns effective configuration and custom overrides for a tournament.
   */
  @Get('tournaments/:id/config')
  async getTournamentConfig(@Param('id') tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, settings: true },
    });
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const custom = ((tournament.settings as Record<string, unknown>)?.config ?? {}) as TournamentCustomConfig;
    const effective = await this.configService.getTournamentConfig(tournamentId);
    const defaults = this.configService.getDefaults();

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      effective,
      custom,
      defaults,
    };
  }

  /**
   * Updates tournament custom configuration in PostgreSQL JSONB.
   */
  @Put('tournaments/:id/config')
  async updateTournamentConfig(
    @Param('id') tournamentId: string,
    @Body() body: TournamentCustomConfig,
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a valid configuration object');
    }

    try {
      const effective = await this.configService.updateTournamentConfig(tournamentId, body);
      return {
        tournamentId,
        effective,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }

  /**
   * Resets tournament custom configuration to defaults.
   */
  @Post('tournaments/:id/config/reset')
  async resetTournamentConfig(@Param('id') tournamentId: string) {
    try {
      const effective = await this.configService.resetTournamentConfig(tournamentId);
      return {
        tournamentId,
        message: 'Configuration reset to defaults successfully',
        effective,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }
}
