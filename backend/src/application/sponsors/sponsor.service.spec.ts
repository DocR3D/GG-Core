// src/application/sponsors/sponsor.service.spec.ts
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SponsorService } from './sponsor.service';
import { SponsorTier } from './sponsor.types';
import type { PrismaService } from '@adapters/database/prisma.service';
import type { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import type { Sponsor, Tournament } from '@prisma/client';

describe('SponsorService', () => {
  let service: SponsorService;
  let mockPrisma: {
    sponsor: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    tournament: {
      findUnique: jest.Mock;
    };
  };
  let mockEmitter: {
    emitBroadcast: jest.Mock;
  };

  const sampleSponsor: Sponsor = {
    id: 'sp-1',
    name: 'Hardware Pro',
    description: 'PC Gaming',
    logoUrl: '/uploads/sponsors/hw.png',
    websiteUrl: 'https://hardwarepro.local',
    tier: SponsorTier.PRIMARY,
    weight: 3,
    active: true,
    messages: ['Équipez-vous chez Hardware Pro !'],
    tournamentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      sponsor: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
      },
    };

    mockEmitter = {
      emitBroadcast: jest.fn(),
    };

    service = new SponsorService(
      mockPrisma as unknown as PrismaService,
      mockEmitter as unknown as RealtimeEmitter,
    );
  });

  describe('create', () => {
    it('creates a global sponsor with default tier weight', async () => {
      mockPrisma.sponsor.create.mockResolvedValueOnce(sampleSponsor);

      const res = await service.create({
        name: 'Hardware Pro',
        tier: SponsorTier.PRIMARY,
      });

      expect(res).toEqual(sampleSponsor);
      expect(mockPrisma.sponsor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Hardware Pro',
          tier: SponsorTier.PRIMARY,
          weight: 3,
          active: true,
          tournamentId: null,
        }),
      });
    });

    it('validates tournament existence when tournamentId is passed', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.create({
          name: 'Local Partner',
          tournamentId: 't-unknown',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if name is blank', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('finds active sponsors with tournament and global fallback', async () => {
      mockPrisma.sponsor.findMany.mockResolvedValueOnce([sampleSponsor]);

      const res = await service.findAll({ activeOnly: true, tournamentId: 't-1' });

      expect(res).toEqual([sampleSponsor]);
      expect(mockPrisma.sponsor.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [{ tournamentId: 't-1' }, { tournamentId: null }],
        },
        orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findById', () => {
    it('returns sponsor if found', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValueOnce(sampleSponsor);

      const res = await service.findById('sp-1');
      expect(res).toEqual(sampleSponsor);
    });

    it('throws NotFoundException if missing', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValueOnce(null);

      await expect(service.findById('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update & delete', () => {
    it('updates sponsor fields and tier weights', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValueOnce(sampleSponsor);
      mockPrisma.sponsor.update.mockResolvedValueOnce({
        ...sampleSponsor,
        tier: SponsorTier.GOLD,
        weight: 2,
      });

      const res = await service.update('sp-1', { tier: SponsorTier.GOLD });
      expect(res.tier).toBe(SponsorTier.GOLD);
      expect(res.weight).toBe(2);
    });

    it('deletes sponsor after verifying existence', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValueOnce(sampleSponsor);
      mockPrisma.sponsor.delete.mockResolvedValueOnce(sampleSponsor);

      await service.delete('sp-1');
      expect(mockPrisma.sponsor.delete).toHaveBeenCalledWith({ where: { id: 'sp-1' } });
    });
  });

  describe('messages & logo', () => {
    it('adds and removes messages', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValue(sampleSponsor);
      mockPrisma.sponsor.update.mockImplementation(({ data }: { data: { messages: string[] } }) =>
        Promise.resolve({ ...sampleSponsor, messages: data.messages }),
      );

      const added = await service.addMessage('sp-1', 'Deuxième phrase !');
      expect(added.messages).toEqual(['Équipez-vous chez Hardware Pro !', 'Deuxième phrase !']);

      const removed = await service.removeMessage('sp-1', 0);
      expect(removed.messages).toEqual([]);
    });

    it('updates logo url', async () => {
      mockPrisma.sponsor.findUnique.mockResolvedValueOnce(sampleSponsor);
      mockPrisma.sponsor.update.mockResolvedValueOnce({
        ...sampleSponsor,
        logoUrl: '/uploads/sponsors/new.png',
      });

      const res = await service.setLogoUrl('sp-1', '/uploads/sponsors/new.png');
      expect(res.logoUrl).toBe('/uploads/sponsors/new.png');
    });
  });

  describe('weighted selection & rotateOverlay', () => {
    it('returns null if no sponsors', async () => {
      mockPrisma.sponsor.findMany.mockResolvedValueOnce([]);
      const res = await service.selectWeightedSponsor('t-1');
      expect(res).toBeNull();
    });

    it('selects active sponsor based on weights', async () => {
      const sp1: Sponsor = { ...sampleSponsor, id: 'sp-1', weight: 10 };
      mockPrisma.sponsor.findMany.mockResolvedValueOnce([sp1]);

      const res = await service.selectWeightedSponsor('t-1');
      expect(res).toEqual(sp1);
    });

    it('rotates overlay and emits WebSocket event', async () => {
      mockPrisma.sponsor.findMany.mockResolvedValueOnce([sampleSponsor]);

      const payload = await service.rotateOverlay({ slot: 'top-bar', durationMs: 10000 });

      expect(payload).not.toBeNull();
      expect(payload?.sponsorId).toBe('sp-1');
      expect(payload?.name).toBe('Hardware Pro');
      expect(payload?.slot).toBe('top-bar');
      expect(payload?.durationMs).toBe(10000);
      expect(mockEmitter.emitBroadcast).toHaveBeenCalledWith('sponsor:rotate', payload);
    });
  });
});
