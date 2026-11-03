// src/adapters/http/sponsors/sponsor.controller.spec.ts
import { BadRequestException } from '@nestjs/common';
import { SponsorController } from './sponsor.controller';
import { SponsorTier } from '@app/sponsors/sponsor.types';
import type { SponsorService } from '@app/sponsors/sponsor.service';
import type { SponsorChatAnnouncerService } from '@app/sponsors/sponsor-chat-announcer.service';
import type { Sponsor } from '@prisma/client';

describe('SponsorController', () => {
  let controller: SponsorController;
  let mockSponsorService: {
    findAll: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    setLogoUrl: jest.Mock;
    addMessage: jest.Mock;
    removeMessage: jest.Mock;
    rotateOverlay: jest.Mock;
  };
  let mockAnnouncer: {
    announceOnServer: jest.Mock;
    broadcastToAllNonPlayingServers: jest.Mock;
  };

  const sampleSponsor: Sponsor = {
    id: 'sp-1',
    name: 'Logitech G',
    description: 'Gaming gear',
    logoUrl: '/uploads/sponsors/logi.png',
    websiteUrl: 'https://logitechg.com',
    tier: SponsorTier.GOLD,
    weight: 2,
    active: true,
    messages: ['Équipement gaming officiel !'],
    tournamentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockSponsorService = {
      findAll: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      setLogoUrl: jest.fn(),
      addMessage: jest.fn(),
      removeMessage: jest.fn(),
      rotateOverlay: jest.fn(),
    };

    mockAnnouncer = {
      announceOnServer: jest.fn(),
      broadcastToAllNonPlayingServers: jest.fn(),
    };

    controller = new SponsorController(
      mockSponsorService as unknown as SponsorService,
      mockAnnouncer as unknown as SponsorChatAnnouncerService,
    );
  });

  it('GET /sponsors returns public active sponsors', async () => {
    mockSponsorService.findAll.mockResolvedValueOnce([sampleSponsor]);

    const res = await controller.getPublicSponsors('tourn-1');
    expect(res).toEqual([sampleSponsor]);
    expect(mockSponsorService.findAll).toHaveBeenCalledWith({
      activeOnly: true,
      tournamentId: 'tourn-1',
    });
  });

  it('GET /admin/sponsors lists sponsors with filters', async () => {
    mockSponsorService.findAll.mockResolvedValueOnce([sampleSponsor]);

    const res = await controller.listSponsors(undefined, 'true', SponsorTier.GOLD);
    expect(res).toEqual([sampleSponsor]);
    expect(mockSponsorService.findAll).toHaveBeenCalledWith({
      tournamentId: undefined,
      activeOnly: true,
      tier: SponsorTier.GOLD,
    });
  });

  it('POST /admin/sponsors creates sponsor', async () => {
    mockSponsorService.create.mockResolvedValueOnce(sampleSponsor);

    const res = await controller.createSponsor({ name: 'Logitech G', tier: SponsorTier.GOLD });
    expect(res).toEqual(sampleSponsor);
    expect(mockSponsorService.create).toHaveBeenCalledWith({ name: 'Logitech G', tier: SponsorTier.GOLD });
  });

  it('GET /admin/sponsors/:id retrieves sponsor', async () => {
    mockSponsorService.findById.mockResolvedValueOnce(sampleSponsor);

    const res = await controller.getSponsor('sp-1');
    expect(res).toEqual(sampleSponsor);
  });

  it('PATCH /admin/sponsors/:id updates sponsor', async () => {
    mockSponsorService.update.mockResolvedValueOnce({ ...sampleSponsor, active: false });

    const res = await controller.updateSponsor('sp-1', { active: false });
    expect(res.active).toBe(false);
  });

  it('DELETE /admin/sponsors/:id deletes sponsor', async () => {
    mockSponsorService.delete.mockResolvedValueOnce(undefined);

    const res = await controller.deleteSponsor('sp-1');
    expect(res).toEqual({ success: true });
  });

  it('POST /admin/sponsors/:id/logo updates logo', async () => {
    mockSponsorService.setLogoUrl.mockResolvedValueOnce({
      ...sampleSponsor,
      logoUrl: '/uploads/sponsors/logo-file.png',
    });

    const mockFile = {
      filename: 'logo-file.png',
    } as Express.Multer.File;

    const res = await controller.uploadLogo('sp-1', mockFile);
    expect(res.success).toBe(true);
    expect(res.logoUrl).toBe('/uploads/sponsors/logo-file.png');
    expect(mockSponsorService.setLogoUrl).toHaveBeenCalledWith('sp-1', '/uploads/sponsors/logo-file.png');
  });

  it('POST /admin/sponsors/:id/logo throws if no file uploaded', async () => {
    await expect(controller.uploadLogo('sp-1', undefined as unknown as Express.Multer.File)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('POST & DELETE /admin/sponsors/:id/messages manages sponsor messages', async () => {
    mockSponsorService.addMessage.mockResolvedValueOnce({ ...sampleSponsor, messages: ['Nouveau'] });
    mockSponsorService.removeMessage.mockResolvedValueOnce({ ...sampleSponsor, messages: [] });

    const added = await controller.addMessage('sp-1', 'Nouveau');
    expect(added.messages).toEqual(['Nouveau']);

    const removed = await controller.removeMessage('sp-1', '0');
    expect(removed.messages).toEqual([]);
    expect(mockSponsorService.removeMessage).toHaveBeenCalledWith('sp-1', 0);
  });

  it('POST /admin/sponsors/rotate triggers overlay rotation', async () => {
    const payload = {
      sponsorId: 'sp-1',
      name: 'Logitech G',
      tier: SponsorTier.GOLD,
      slot: 'stream-corner',
      durationMs: 12000,
    };
    mockSponsorService.rotateOverlay.mockResolvedValueOnce(payload);

    const res = await controller.triggerRotate('stream-corner', undefined, 12000);
    expect(res).toEqual({ success: true, payload });
  });

  it('POST /admin/sponsors/announce triggers server or all broadcast', async () => {
    mockAnnouncer.announceOnServer.mockResolvedValueOnce(true);
    const srvRes = await controller.triggerAnnounce('srv-1', 'sp-1', '[Sponsor]');
    expect(srvRes).toEqual({ success: true, serverId: 'srv-1' });

    mockAnnouncer.broadcastToAllNonPlayingServers.mockResolvedValueOnce({ sent: 2, servers: ['srv-1', 'srv-2'] });
    const allRes = await controller.triggerAnnounce('all', undefined, '[Sponsor]');
    expect(allRes).toEqual({ sent: 2, servers: ['srv-1', 'srv-2'] });
  });
});
