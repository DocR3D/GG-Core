// src/adapters/http/sponsors/sponsor.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { SponsorService } from '@app/sponsors/sponsor.service';
import { SponsorChatAnnouncerService } from '@app/sponsors/sponsor-chat-announcer.service';
import { CreateSponsorDto, UpdateSponsorDto, SponsorTier, UpdateSponsorChatConfigDto } from '@app/sponsors/sponsor.types';

const UPLOAD_DIR = path.join(process.cwd(), 'public/uploads/sponsors');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];

const sponsorLogoStorage = diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const sponsorId = req.params?.id || 'sponsor';
    const filename = `${sponsorId}-${Date.now()}${ext}`;
    cb(null, filename);
  },
});

@Controller()
export class SponsorController {
  constructor(
    private readonly sponsorService: SponsorService,
    private readonly announcer: SponsorChatAnnouncerService,
  ) {}

  // ---------------------------------------------------------------------------
  // PUBLIC ENDPOINTS (Overlay stream & site web)
  // ---------------------------------------------------------------------------

  @Get('sponsors')
  async getPublicSponsors(@Query('tournamentId') tournamentId?: string) {
    return this.sponsorService.findAll({
      activeOnly: true,
      tournamentId: tournamentId || undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // ADMIN CRUD
  // ---------------------------------------------------------------------------

  @Get('admin/sponsors')
  async listSponsors(
    @Query('tournamentId') tournamentId?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('tier') tier?: SponsorTier,
  ) {
    return this.sponsorService.findAll({
      tournamentId: tournamentId !== undefined ? tournamentId : undefined,
      activeOnly: activeOnly === 'true',
      tier,
    });
  }

  @Post('admin/sponsors')
  async createSponsor(@Body() dto: CreateSponsorDto) {
    return this.sponsorService.create(dto);
  }

  @Get('admin/sponsors/:id')
  async getSponsor(@Param('id') id: string) {
    return this.sponsorService.findById(id);
  }

  @Patch('admin/sponsors/:id')
  async updateSponsor(@Param('id') id: string, @Body() dto: UpdateSponsorDto) {
    return this.sponsorService.update(id, dto);
  }

  @Delete('admin/sponsors/:id')
  async deleteSponsor(@Param('id') id: string) {
    await this.sponsorService.delete(id);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // LOGO UPLOAD
  // ---------------------------------------------------------------------------

  @Post('admin/sponsors/:id/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: sponsorLogoStorage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Format d\'image non supporté (formats acceptés: PNG, JPG, SVG, WEBP)'), false);
        }
      },
    }),
  )
  async uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier image reçu');
    }

    const logoUrl = `/uploads/sponsors/${file.filename}`;
    const sponsor = await this.sponsorService.setLogoUrl(id, logoUrl);

    return {
      success: true,
      sponsor,
      logoUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // MESSAGES INGAME MANAGEMENT
  // ---------------------------------------------------------------------------

  @Post('admin/sponsors/:id/messages')
  async addMessage(@Param('id') id: string, @Body('message') message: string) {
    return this.sponsorService.addMessage(id, message);
  }

  @Delete('admin/sponsors/:id/messages/:index')
  async removeMessage(@Param('id') id: string, @Param('index') index: string) {
    return this.sponsorService.removeMessage(id, parseInt(index, 10));
  }

  // ---------------------------------------------------------------------------
  // ROTATION & ANNOUNCEMENTS
  // ---------------------------------------------------------------------------

  @Post('admin/sponsors/rotate')
  async triggerRotate(
    @Body('slot') slot?: string,
    @Body('tournamentId') tournamentId?: string,
    @Body('durationMs') durationMs?: number,
  ) {
    const result = await this.sponsorService.rotateOverlay({ slot, tournamentId, durationMs });
    return { success: !!result, payload: result };
  }

  @Post('admin/sponsors/announce')
  async triggerAnnounce(
    @Body('serverId') serverId?: string,
    @Body('sponsorId') sponsorId?: string,
    @Body('prefix') prefix?: string,
  ) {
    if (serverId && serverId !== 'all') {
      const success = await this.announcer.announceOnServer(serverId, { sponsorId, prefix });
      return { success, serverId };
    }
    return this.announcer.broadcastToAllNonPlayingServers(prefix);
  }

  @Get('admin/sponsors/config')
  getConfig() {
    return this.announcer.getConfig();
  }

  @Patch('admin/sponsors/config')
  async updateConfig(@Body() dto: UpdateSponsorChatConfigDto) {
    return this.announcer.updateConfig(dto);
  }
}
