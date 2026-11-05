// src/adapters/http/community-messages/community-messages.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { CommunityMessagesService } from '@app/community-messages/community-messages.service';
import {
  CreateCommunityMessageDto,
  UpdateCommunityMessageDto,
} from '@app/community-messages/community-messages.types';

@Controller()
export class CommunityMessagesController {
  constructor(private readonly service: CommunityMessagesService) {}

  // ---------------------------------------------------------------------------
  // PUBLIC
  // ---------------------------------------------------------------------------

  @Get('community-messages')
  async getPublicMessages(@Query('tournamentId') tournamentId?: string) {
    return this.service.findAll({
      activeOnly: true,
      tournamentId: tournamentId || undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // ADMIN CRUD
  // ---------------------------------------------------------------------------

  @Get('admin/community-messages')
  async listMessages(
    @Query('tournamentId') tournamentId?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('category') category?: string,
  ) {
    return this.service.findAll({
      tournamentId: tournamentId !== undefined ? tournamentId : undefined,
      activeOnly: activeOnly === 'true',
      category,
    });
  }

  @Post('admin/community-messages')
  async createMessage(@Body() dto: CreateCommunityMessageDto) {
    return this.service.create(dto);
  }

  @Get('admin/community-messages/:id')
  async getMessage(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('admin/community-messages/:id')
  async updateMessage(@Param('id') id: string, @Body() dto: UpdateCommunityMessageDto) {
    return this.service.update(id, dto);
  }

  @Delete('admin/community-messages/:id')
  async deleteMessage(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true };
  }

  @Post('admin/community-messages/seed')
  async seedDefaults() {
    const inserted = await this.service.seedDefaults();
    return { success: true, inserted };
  }
}
