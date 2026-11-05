// src/application/community-messages/community-messages.service.spec.ts
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CommunityMessagesService } from './community-messages.service';
import { DEFAULT_COMMUNITY_MESSAGES } from './community-messages.types';
import type { PrismaService } from '@adapters/database/prisma.service';
import type { CommunityMessage } from '@prisma/client';

describe('CommunityMessagesService', () => {
  let service: CommunityMessagesService;
  let mockPrisma: {
    communityMessage: {
      count: jest.Mock;
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

  const sampleMessage: CommunityMessage = {
    id: 'msg-1',
    text: 'La GG-Lan est entièrement financée par vos participations ! Merci à vous !',
    category: 'fun_fact',
    active: true,
    tournamentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      communityMessage: {
        count: jest.fn(),
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

    service = new CommunityMessagesService(mockPrisma as unknown as PrismaService);
  });

  describe('seedDefaults', () => {
    it('seeds 3 default historical GG-Lan facts when table is empty', async () => {
      mockPrisma.communityMessage.count.mockResolvedValueOnce(0);
      mockPrisma.communityMessage.create.mockResolvedValue(sampleMessage);

      const inserted = await service.seedDefaults();
      expect(inserted).toBe(3);
      expect(mockPrisma.communityMessage.create).toHaveBeenCalledTimes(3);
      expect(mockPrisma.communityMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          text: DEFAULT_COMMUNITY_MESSAGES[0],
          category: 'fun_fact',
          active: true,
        }),
      });
    });

    it('does nothing if table already contains messages', async () => {
      mockPrisma.communityMessage.count.mockResolvedValueOnce(5);

      const inserted = await service.seedDefaults();
      expect(inserted).toBe(0);
      expect(mockPrisma.communityMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a global community message', async () => {
      mockPrisma.communityMessage.create.mockResolvedValueOnce(sampleMessage);

      const res = await service.create({
        text: 'Buvette ouverte jusqu à 2h',
        category: 'info',
      });

      expect(res).toEqual(sampleMessage);
      expect(mockPrisma.communityMessage.create).toHaveBeenCalledWith({
        data: {
          text: 'Buvette ouverte jusqu à 2h',
          category: 'info',
          active: true,
          tournamentId: null,
        },
      });
    });

    it('throws if text is blank', async () => {
      await expect(service.create({ text: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('validates tournament if tournamentId is given', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.create({
          text: 'Important',
          tournamentId: 't-invalid',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll & findById', () => {
    it('lists messages matching filters', async () => {
      mockPrisma.communityMessage.findMany.mockResolvedValueOnce([sampleMessage]);

      const res = await service.findAll({ activeOnly: true, tournamentId: 't-1' });
      expect(res).toEqual([sampleMessage]);
      expect(mockPrisma.communityMessage.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [{ tournamentId: 't-1' }, { tournamentId: null }],
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('finds by id', async () => {
      mockPrisma.communityMessage.findUnique.mockResolvedValueOnce(sampleMessage);
      const res = await service.findById('msg-1');
      expect(res).toEqual(sampleMessage);
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.communityMessage.findUnique.mockResolvedValueOnce(null);
      await expect(service.findById('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update & delete', () => {
    it('updates text and active status', async () => {
      mockPrisma.communityMessage.findUnique.mockResolvedValueOnce(sampleMessage);
      mockPrisma.communityMessage.update.mockResolvedValueOnce({
        ...sampleMessage,
        active: false,
      });

      const res = await service.update('msg-1', { active: false });
      expect(res.active).toBe(false);
    });

    it('deletes message', async () => {
      mockPrisma.communityMessage.findUnique.mockResolvedValueOnce(sampleMessage);
      mockPrisma.communityMessage.delete.mockResolvedValueOnce(sampleMessage);

      await service.delete('msg-1');
      expect(mockPrisma.communityMessage.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } });
    });
  });

  describe('getActiveWarmupMessages', () => {
    it('returns messages from DB when available', async () => {
      mockPrisma.communityMessage.findMany.mockResolvedValueOnce([
        { text: 'Phrase DB 1' },
        { text: 'Phrase DB 2' },
      ]);

      const items = await service.getActiveWarmupMessages();
      expect(items).toEqual(['Phrase DB 1', 'Phrase DB 2']);
    });

    it('falls back to default historical messages if DB is empty', async () => {
      mockPrisma.communityMessage.findMany.mockResolvedValueOnce([]);

      const items = await service.getActiveWarmupMessages();
      expect(items).toEqual(DEFAULT_COMMUNITY_MESSAGES);
    });
  });
});
