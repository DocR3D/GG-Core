// src/application/sponsors/sponsor-chat-announcer.service.spec.ts
import { SponsorChatAnnouncerService } from './sponsor-chat-announcer.service';
import { SponsorTier } from './sponsor.types';
import { MatchPhase } from '@domain/phase.types';
import type { SponsorService } from './sponsor.service';
import type { MatchCommandsService } from '@app/commands/match-commands.service';
import type { MatchStateService } from '@app/match/state/match-state.service';
import type { PrismaService } from '@adapters/database/prisma.service';
import type { Sponsor } from '@prisma/client';

describe('SponsorChatAnnouncerService', () => {
  let announcer: SponsorChatAnnouncerService;
  let mockSponsorService: {
    findById: jest.Mock;
    selectWeightedSponsor: jest.Mock;
  };
  let mockCmds: {
    say: jest.Mock;
  };
  let mockState: {
    getMatchIdFromServerId: jest.Mock;
    getPhase: jest.Mock;
  };
  let mockPrisma: {
    matchMap: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    server: {
      findMany: jest.Mock;
    };
  };

  const sampleSponsor: Sponsor = {
    id: 'sp-1',
    name: 'Hardware Pro',
    description: null,
    logoUrl: null,
    websiteUrl: null,
    tier: SponsorTier.PRIMARY,
    weight: 3,
    active: true,
    messages: ['Profitez de 10% de remise chez Hardware Pro !'],
    tournamentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.useFakeTimers();

    mockSponsorService = {
      findById: jest.fn(),
      selectWeightedSponsor: jest.fn(),
    };
    mockCmds = {
      say: jest.fn().mockResolvedValue(undefined),
    };
    mockState = {
      getMatchIdFromServerId: jest.fn().mockResolvedValue(null),
      getPhase: jest.fn().mockResolvedValue(null),
    };
    mockPrisma = {
      matchMap: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      server: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    announcer = new SponsorChatAnnouncerService(
      mockSponsorService as unknown as SponsorService,
      mockCmds as unknown as MatchCommandsService,
      mockState as unknown as MatchStateService,
      mockPrisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('announceOnServer', () => {
    it('sends weighted sponsor message to server chat with prefix', async () => {
      mockSponsorService.selectWeightedSponsor.mockResolvedValueOnce(sampleSponsor);

      const success = await announcer.announceOnServer('srv-1');

      expect(success).toBe(true);
      expect(mockCmds.say).toHaveBeenCalledWith(
        'srv-1',
        '[Partenaire] Profitez de 10% de remise chez Hardware Pro !',
      );
    });

    it('falls back to default courteous message if sponsor has no custom messages', async () => {
      mockSponsorService.selectWeightedSponsor.mockResolvedValueOnce({
        ...sampleSponsor,
        messages: [],
      });

      const success = await announcer.announceOnServer('srv-1', { prefix: '[Sponsor]' });

      expect(success).toBe(true);
      expect(mockCmds.say).toHaveBeenCalledWith(
        'srv-1',
        '[Sponsor] Merci a Hardware Pro pour son soutien !',
      );
    });

    it('returns false if no active sponsor available', async () => {
      mockSponsorService.selectWeightedSponsor.mockResolvedValueOnce(null);

      const success = await announcer.announceOnServer('srv-1');
      expect(success).toBe(false);
      expect(mockCmds.say).not.toHaveBeenCalled();
    });
  });

  describe('onPauseStarted', () => {
    it('dispatches sponsor message after delay when match is in tactical pause', async () => {
      mockState.getPhase.mockResolvedValue(MatchPhase.PAUSED_TAC);
      mockSponsorService.selectWeightedSponsor.mockResolvedValue(sampleSponsor);

      announcer.onPauseStarted('m-1', 'srv-1', 'tactical');

      // Before timer ticks -> not sent yet
      expect(mockCmds.say).not.toHaveBeenCalled();

      // Advance by 2000ms
      await jest.advanceTimersByTimeAsync(2000);

      expect(mockCmds.say).toHaveBeenCalledTimes(1);
      expect(mockCmds.say).toHaveBeenCalledWith(
        'srv-1',
        '[Partenaire] Profitez de 10% de remise chez Hardware Pro !',
      );
    });

    it('does not send if disabled', async () => {
      announcer.setEnabled(false);
      announcer.onPauseStarted('m-1', 'srv-1', 'tactical');

      await jest.advanceTimersByTimeAsync(2000);
      expect(mockCmds.say).not.toHaveBeenCalled();
    });
  });

  describe('broadcastToAllNonPlayingServers', () => {
    it('announces to warmup / idle servers and ignores live matches', async () => {
      mockPrisma.server.findMany.mockResolvedValueOnce([
        { name: 'srv-warmup', status: 'IDLE' },
        { name: 'srv-live', status: 'BUSY' },
      ]);

      mockState.getMatchIdFromServerId.mockImplementation((s: string) => {
        if (s === 'srv-live') return Promise.resolve('m-live');
        return Promise.resolve(null); // idle
      });
      mockState.getPhase.mockImplementation((m: string) => {
        if (m === 'm-live') return Promise.resolve(MatchPhase.LIVE_MAIN);
        return Promise.resolve(null);
      });

      mockSponsorService.selectWeightedSponsor.mockResolvedValue(sampleSponsor);

      const res = await announcer.broadcastToAllNonPlayingServers();

      expect(res.sent).toBe(1);
      expect(res.servers).toEqual(['srv-warmup']);
      expect(mockCmds.say).toHaveBeenCalledTimes(1);
      expect(mockCmds.say).toHaveBeenCalledWith('srv-warmup', expect.stringContaining('Hardware Pro'));
    });
  });
});
