import { BadRequestException } from '@nestjs/common';
import { MatchCommandsService } from './match-commands.service';
import { MatchPhase } from '@domain/phase.types';
import { redisConst, REDIS_CHANNELS } from '../match/state/redis.keys';

describe('MatchCommandsService', () => {
  let service: MatchCommandsService;
  let mockRedis: any;
  let mockPub: any;
  let mockMps: any;
  let mockPauseMatchService: any;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      hget: jest.fn(),
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      multi: jest.fn().mockReturnValue({
        hset: jest.fn().mockReturnThis(),
        hsetnx: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        setnx: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    mockPub = {
      publish: jest.fn().mockResolvedValue(1),
    };

    mockMps = {
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      cancelPhaseCountdown: jest.fn().mockResolvedValue(undefined),
    };

    mockPauseMatchService = {
      resume: jest.fn().mockResolvedValue(undefined),
      initTacBanks: jest.fn().mockResolvedValue(undefined),
    };

    service = new MatchCommandsService(
      mockMps,
      mockRedis,
      mockPub,
      mockPauseMatchService,
    );
  });

  describe('resolution serverId et matchId', () => {
    it('résout matchId depuis serverId si manquant', async () => {
      mockRedis.get.mockResolvedValue('m-123');
      await service.pause({ serverId: 'srv-a' });

      expect(mockRedis.get).toHaveBeenCalledWith(redisConst.serverMatch('srv-a'));
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"action":"pause"'),
      );
    });

    it('résout serverId depuis matchId si manquant', async () => {
      mockRedis.get.mockResolvedValue('srv-b');
      await service.pause({ matchId: 'm-456' });

      expect(mockRedis.get).toHaveBeenCalledWith(redisConst.matchServer('m-456'));
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-b'),
        expect.stringContaining('"action":"pause"'),
      );
    });

    it('lève BadRequestException si la résolution échoue', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.pause({ serverId: 'srv-unknown' })).rejects.toThrow(BadRequestException);
      await expect(service.pause({ matchId: 'm-unknown' })).rejects.toThrow(BadRequestException);
      await expect(service.pause({})).rejects.toThrow(BadRequestException);
    });
  });

  describe('actions agent RCON et communication', () => {
    it('pause publie une action de type pause', async () => {
      const res = await service.pause({ serverId: 'srv-a', matchId: 'm-1' });
      expect(res).toEqual({ ok: true });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"action":"pause"'),
      );
    });

    it('unpause publie unpause et appelle pauseMatchService.resume', async () => {
      const res = await service.unpause({
        serverId: 'srv-a',
        matchId: 'm-1',
        actor: { name: 'Player1', teamSide: 'CT' },
      });
      expect(res).toEqual({ ok: true });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"action":"unpause"'),
      );
      expect(mockPauseMatchService.resume).toHaveBeenCalledWith('m-1');
    });

    it('say publie un message admin dans le chat', async () => {
      await service.say('srv-a', 'Hello CS2');
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('Hello CS2'),
      );
    });

    it('say lève une erreur si serverId est manquant', async () => {
      await expect(service.say('', 'Hello')).rejects.toThrow(BadRequestException);
    });

    it('exec publie exec_cfg avec vars optionnelles', async () => {
      await service.exec({
        serverId: 'srv-a',
        matchId: 'm-1',
        cfgName: 'warmup.cfg',
        vars: { FOO: 'bar' },
      });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"action":"exec_cfg"'),
      );
    });

    it('rcon publie une commande brute', async () => {
      await service.rcon({ serverId: 'srv-a', command: 'mp_warmup_end' });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"text":"mp_warmup_end"'),
      );
    });

    it('kickAll publie une action kick_all', async () => {
      await service.kickAll({ serverId: 'srv-a', message: 'Match over' });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"action":"kick_all"'),
      );
    });

    it('restart publie une action restart avec délai personnalisé', async () => {
      await service.restart({ serverId: 'srv-a', matchId: 'm-1', delay: 5 });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"delay":5'),
      );
    });

    it('changeLevel publie changelevel ou refuse si invalide', async () => {
      await service.changeLevel({ serverId: 'srv-a', map: 'de_mirage' });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"map":"de_mirage"'),
      );

      await expect(service.changeLevel({ serverId: '', map: 'de_mirage' })).rejects.toThrow(BadRequestException);
      await expect(service.changeLevel({ serverId: 'srv-a', map: '' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('gestion de l’état et binding', () => {
    it('ensureInitMatch initialise les clés Redis du match et lance le countdown warmup', async () => {
      const res = await service.ensureInitMatch('srv-a', 'm-100', 'de_dust2', 'Lions', 'Tigers');
      expect(res.matchId).toBe('m-100');
      expect(res.map).toBe('de_dust2');
      expect(res.home.name).toBe('Lions');
      expect(res.away.name).toBe('Tigers');

      expect(mockPauseMatchService.initTacBanks).toHaveBeenCalledWith('m-100');
      expect(mockMps.startPhaseCountdown).toHaveBeenCalledWith('m-100', MatchPhase.WARMUP_MAIN, 30, 'srv-a');
    });

    it('ensureInitMatch génère un matchId automatique si absent', async () => {
      const res = await service.ensureInitMatch('srv-a');
      expect(res.matchId).toMatch(/^m-[a-f0-9]{10}$/);
    });

    it('restartGame est un alias vers restart', async () => {
      const res = await service.restartGame({ serverId: 'srv-a', matchId: 'm-1', delay: 10 });
      expect(res).toEqual({ ok: true });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"delay":10'),
      );
    });

    it('swapSides envoie mp_swapteams via RCON', async () => {
      mockRedis.get.mockResolvedValue('srv-a');
      await service.swapSides({ matchId: 'm-1' });
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.agentActions('srv-a'),
        expect.stringContaining('"text":"mp_swapteams"'),
      );
    });
  });
});
