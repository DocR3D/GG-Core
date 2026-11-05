// src/adapters/http/tournament/tournament-config.controller.spec.ts

import { TournamentConfigController } from './tournament-config.controller';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DEFAULT_BOT_TAG } from '@domain/config/config.constants';

describe('TournamentConfigController', () => {
  let controller: TournamentConfigController;
  let mockService: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockService = {
      getDefaults: jest.fn().mockReturnValue({
        botTag: DEFAULT_BOT_TAG,
        commandAliases: { admin: ['admin'] },
        messages: {},
        matchRules: {},
        disabledCommands: [],
      }),
      getTournamentConfig: jest.fn().mockResolvedValue({
        botTag: '[CUSTOM-TAG]',
        commandAliases: { admin: ['admin', 'sos'] },
        messages: {},
        matchRules: {},
        disabledCommands: [],
      }),
      updateTournamentConfig: jest.fn().mockResolvedValue({
        botTag: '[NEW-TAG]',
        commandAliases: { admin: ['admin'] },
        messages: {},
        matchRules: {},
        disabledCommands: [],
      }),
      resetTournamentConfig: jest.fn().mockResolvedValue({
        botTag: DEFAULT_BOT_TAG,
        commandAliases: { admin: ['admin'] },
        messages: {},
        matchRules: {},
        disabledCommands: [],
      }),
    };

    mockPrisma = {
      tournament: {
        findUnique: jest.fn(),
      },
    };

    controller = new TournamentConfigController(mockService, mockPrisma);
  });

  describe('GET /api/tournament/config/defaults', () => {
    it('returns default configuration', () => {
      const res = controller.getDefaults();
      expect(res.botTag).toBe(DEFAULT_BOT_TAG);
      expect(mockService.getDefaults).toHaveBeenCalled();
    });
  });

  describe('GET /api/tournament/tournaments/:id/config', () => {
    it('returns 404 when tournament does not exist', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue(null);
      await expect(controller.getTournamentConfig('t-404')).rejects.toThrow(NotFoundException);
    });

    it('returns effective, custom, and default config', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'GGLan 2026',
        settings: {
          config: {
            botTag: '[CUSTOM-TAG]',
          },
        },
      });

      const res = await controller.getTournamentConfig('t-1');
      expect(res.tournamentId).toBe('t-1');
      expect(res.tournamentName).toBe('GGLan 2026');
      expect(res.effective.botTag).toBe('[CUSTOM-TAG]');
      expect(res.custom.botTag).toBe('[CUSTOM-TAG]');
      expect(res.defaults.botTag).toBe(DEFAULT_BOT_TAG);
    });
  });

  describe('PUT /api/tournament/tournaments/:id/config', () => {
    it('throws BadRequest when body is empty/invalid', async () => {
      await expect(controller.updateTournamentConfig('t-1', null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates tournament config and returns effective config', async () => {
      const res = await controller.updateTournamentConfig('t-1', {
        botTag: '[NEW-TAG]',
      });
      expect(res.tournamentId).toBe('t-1');
      expect(res.effective.botTag).toBe('[NEW-TAG]');
      expect(mockService.updateTournamentConfig).toHaveBeenCalledWith('t-1', {
        botTag: '[NEW-TAG]',
      });
    });

    it('handles not found error', async () => {
      mockService.updateTournamentConfig.mockRejectedValue(new Error('Tournament t-404 not found'));
      await expect(
        controller.updateTournamentConfig('t-404', { botTag: '[X]' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /api/tournament/tournaments/:id/config/reset', () => {
    it('resets tournament config to defaults', async () => {
      const res = await controller.resetTournamentConfig('t-1');
      expect(res.tournamentId).toBe('t-1');
      expect(res.message).toContain('reset to defaults');
      expect(mockService.resetTournamentConfig).toHaveBeenCalledWith('t-1');
    });

    it('handles not found error on reset', async () => {
      mockService.resetTournamentConfig.mockRejectedValue(new Error('Tournament t-404 not found'));
      await expect(controller.resetTournamentConfig('t-404')).rejects.toThrow(NotFoundException);
    });
  });
});
