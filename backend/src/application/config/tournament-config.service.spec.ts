// src/application/config/tournament-config.service.spec.ts

import { TournamentConfigService } from './tournament-config.service';
import { DEFAULT_BOT_TAG } from '@domain/config/config.constants';

describe('TournamentConfigService', () => {
  let service: TournamentConfigService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      tournament: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      matchMap: {
        findUnique: jest.fn(),
      },
    };
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    service = new TournamentConfigService(mockPrisma, mockRedis);
  });

  describe('getDefaults & mergeWithDefaults', () => {
    it('returns default configuration baseline', () => {
      const defaults = service.getDefaults();
      expect(defaults.botTag).toBe(DEFAULT_BOT_TAG);
      expect(defaults.commandAliases.ready).toContain('ready');
      expect(defaults.commandAliases.pause).toContain('pause');
      expect(defaults.commandAliases.admin).toContain('admin');
      expect(defaults.disabledCommands).toEqual([]);
      expect(defaults.matchRules.tacticalPauseBankSec).toBe(120);
    });

    it('merges custom overrides without erasing untouched defaults', () => {
      const custom = {
        botTag: '[GG-LAN 2026]',
        commandAliases: {
          admin: ['admin', 'sos', 'arbitre', 'urgent'],
        },
        disabledCommands: ['restore' as const],
        messages: {
          ADMIN_CALL_ACK: '{tag} Help is coming: "{message}"',
        },
        matchRules: {
          tacticalPauseBankSec: 180,
        },
      };

      const effective = service.mergeWithDefaults(custom);
      expect(effective.botTag).toBe('[GG-LAN 2026]');
      expect(effective.commandAliases.admin).toEqual(['admin', 'sos', 'arbitre', 'urgent']);
      expect(effective.commandAliases.ready).toContain('ready'); // preserved
      expect(effective.disabledCommands).toEqual(['restore']);
      expect(effective.messages.ADMIN_CALL_ACK).toBe('{tag} Help is coming: "{message}"');
      expect(effective.messages.PAUSE_TAC_ARMED).toContain('Pause tactique'); // preserved
      expect(effective.matchRules.tacticalPauseBankSec).toBe(180);
      expect(effective.matchRules.technicalPauseMaxDurationSec).toBe(300); // preserved
    });
  });

  describe('getTournamentConfig', () => {
    it('returns default config when tournament has no custom settings', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({ id: 't-1', settings: {} });

      const config = await service.getTournamentConfig('t-1');
      expect(config.botTag).toBe(DEFAULT_BOT_TAG);
      expect(config.commandAliases.admin).toContain('admin');
    });

    it('loads custom config from DB and caches it', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't-2',
        settings: {
          config: {
            botTag: '[BREST-LAN]',
            commandAliases: { admin: ['admin', 'sos'] },
          },
        },
      });

      const config = await service.getTournamentConfig('t-2');
      expect(config.botTag).toBe('[BREST-LAN]');
      expect(config.commandAliases.admin).toEqual(['admin', 'sos']);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'config:tournament:t-2',
        expect.any(String),
        'EX',
        expect.any(Number),
      );

      // Second call hits cache
      mockPrisma.tournament.findUnique.mockClear();
      const cached = await service.getTournamentConfig('t-2');
      expect(cached.botTag).toBe('[BREST-LAN]');
      expect(mockPrisma.tournament.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveCommand', () => {
    it('resolves standard commands with different prefixes', async () => {
      const matchId = 'm-1';
      expect(await service.resolveCommand(matchId, '!ready')).toEqual({
        canonical: 'ready',
        rawInput: 'ready',
        isAllowed: true,
      });

      expect(await service.resolveCommand(matchId, '.pause')).toEqual({
        canonical: 'pause',
        rawInput: 'pause',
        isAllowed: true,
      });

      expect(await service.resolveCommand(matchId, '/calladmin')).toEqual({
        canonical: 'admin',
        rawInput: 'calladmin',
        isAllowed: true,
      });
    });

    it('resolves custom aliases configured for a tournament', async () => {
      const tid = 't-custom';
      const matchId = 'm-custom';
      await service.setMatchTournamentId(matchId, tid);

      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tid,
        settings: {
          config: {
            commandAliases: {
              admin: ['admin', 'sos', 'arbitre', 'panique'],
              pause: ['pause', 'tac', 'temps'],
            },
          },
        },
      });

      const resSos = await service.resolveCommand(matchId, '!sos');
      expect(resSos).toEqual({
        canonical: 'admin',
        rawInput: 'sos',
        isAllowed: true,
      });

      const resTemps = await service.resolveCommand(matchId, '!temps');
      expect(resTemps).toEqual({
        canonical: 'pause',
        rawInput: 'temps',
        isAllowed: true,
      });
    });

    it('returns isAllowed: false when command is in disabledCommands', async () => {
      const tid = 't-disabled';
      const matchId = 'm-disabled';
      await service.setMatchTournamentId(matchId, tid);

      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tid,
        settings: {
          config: {
            disabledCommands: ['restore'],
          },
        },
      });

      const res = await service.resolveCommand(matchId, '!restore');
      expect(res).toEqual({
        canonical: 'restore',
        rawInput: 'restore',
        isAllowed: false,
      });
    });

    it('returns null for unknown command', async () => {
      expect(await service.resolveCommand('m-1', '!unknowncmd')).toBeNull();
    });
  });

  describe('formatMessage', () => {
    it('formats message with default botTag and parameters', async () => {
      const msg = await service.formatMessage('m-1', 'ADMIN_CALL_ACK', {
        message: 'souris cassée',
      });
      expect(msg).toBe(
        '[GG-Core] Message reçu par les admins : "souris cassée". Un arbitre arrive ou va vous répondre.',
      );
    });

    it('formats message with custom botTag and custom template from tournament', async () => {
      const tid = 't-msg';
      const matchId = 'm-msg';
      await service.setMatchTournamentId(matchId, tid);

      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tid,
        settings: {
          config: {
            botTag: '[LAN-BREST]',
            messages: {
              ADMIN_CALL_ACK: '{tag} Alerte arbitre enregistrée pour "{message}" !',
            },
          },
        },
      });

      const msg = await service.formatMessage(matchId, 'ADMIN_CALL_ACK', {
        message: 'table 4 écran noir',
      });
      expect(msg).toBe('[LAN-BREST] Alerte arbitre enregistrée pour "table 4 écran noir" !');
    });
  });

  describe('updateTournamentConfig & resetTournamentConfig', () => {
    it('updates tournament settings and invalidates cache', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't-upd',
        settings: { otherField: 123 },
      });

      await service.updateTournamentConfig('t-upd', {
        botTag: '[NEW-TAG]',
      });

      expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 't-upd' },
        data: {
          settings: {
            otherField: 123,
            config: { botTag: '[NEW-TAG]' },
          },
        },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('config:tournament:t-upd');
    });

    it('resets tournament configuration to default', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 't-reset',
        settings: { otherField: 123, config: { botTag: '[CUSTOM]' } },
      });

      const res = await service.resetTournamentConfig('t-reset');
      expect(res.botTag).toBe(DEFAULT_BOT_TAG);
      expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 't-reset' },
        data: {
          settings: { otherField: 123 },
        },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('config:tournament:t-reset');
    });
  });
});
