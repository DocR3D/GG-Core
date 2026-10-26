// src/application/match/sandbox/sandbox.service.spec.ts
import { SandboxService } from './sandbox.service';
import { InjectStateDto } from './sandbox.dto';
import { MatchStateService } from '../state/match-state.service';
import { SidesScoreService } from '../state/sides-score.service';
import { SnapshotQuery } from '../state/snapshot.query';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { RoundBackupService } from '../backup/round-backup.service';
import { MatchPhase } from '@domain/phase.types';
import { REDIS_CHANNELS, redisConst } from '../state/redis.keys';
import { CS2_RCON_COMMANDS, CS2_CFG } from '@domain/rules/rules.constants';

describe('SandboxService', () => {
  let service: SandboxService;
  let mockRedis: any;
  let mockPub: any;
  let mockState: any;
  let mockSidesScore: any;
  let mockSnapshotQ: any;
  let mockCmds: any;
  let mockWs: any;
  let mockBackupService: any;

  beforeEach(() => {
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
    mockPub = {
      publish: jest.fn().mockResolvedValue(1),
    };
    mockState = {
      setServerIdToMatchId: jest.fn().mockResolvedValue('OK'),
      setSides: jest.fn().mockResolvedValue('OK'),
      setTeams: jest.fn().mockResolvedValue('OK'),
      setPhase: jest.fn().mockResolvedValue('OK'),
      getSides: jest.fn().mockResolvedValue({ home: 'CT', away: 'T' }),
      setHalftimePlayed: jest.fn().mockResolvedValue('OK'),
      setOvertimeCount: jest.fn().mockResolvedValue('OK'),
      setLastScoredRound: jest.fn().mockResolvedValue('OK'),
      setSettings: jest.fn().mockResolvedValue('OK'),
      upsertPlayer: jest.fn().mockResolvedValue('OK'),
      setPlayerMoney: jest.fn().mockResolvedValue('OK'),
      sideToLogical: jest.fn().mockResolvedValue('home'),
    };
    mockSidesScore = {};
    mockSnapshotQ = {
      getSnapshot: jest.fn().mockResolvedValue({
        matchId: 'm-test-1',
        phase: MatchPhase.LIVE_MAIN,
        score: { ct: 6, t: 5, round: 11 },
      }),
    };
    mockCmds = {
      rcon: jest.fn().mockResolvedValue({ ok: true }),
    };
    mockWs = {
      push: jest.fn().mockResolvedValue(undefined),
    };
    mockBackupService = {
      generateValveBackup: jest.fn().mockReturnValue('"SaveFile" { "round" "11" }'),
      writeBackupFile: jest.fn().mockResolvedValue('/tmp/backup.txt'),
    };

    service = new SandboxService(
      mockRedis,
      mockPub,
      mockState,
      mockSidesScore as SidesScoreService,
      mockSnapshotQ as SnapshotQuery,
      mockCmds as MatchCommandsService,
      mockWs as WsBroadcaster,
      mockBackupService as RoundBackupService,
    );
  });

  it('devrait être défini', () => {
    expect(service).toBeDefined();
  });

  describe('getPresets', () => {
    it('devrait retourner les presets essentiels dont mi-temps et overtime', () => {
      const presets = service.getPresets();
      expect(presets.length).toBeGreaterThanOrEqual(5);

      const halftime = presets.find((p) => p.id === 'halftime_pivot');
      expect(halftime).toBeDefined();
      expect(halftime?.phase).toBe(MatchPhase.LIVE_MAIN);
      expect(halftime?.round).toBe(11);

      const ot = presets.find((p) => p.id === 'overtime_mr3_start');
      expect(ot).toBeDefined();
      expect(ot?.phase).toBe(MatchPhase.OVERTIME);
      expect(ot?.overtimeCount).toBe(1);

      const warmupKnife = presets.find((p) => p.id === 'warmup_knife');
      expect(warmupKnife).toBeDefined();
      expect(warmupKnife?.phase).toBe(MatchPhase.KNIFE_WARMUP);

      const knife = presets.find((p) => p.id === 'knife_live');
      expect(knife).toBeDefined();
      expect(knife?.phase).toBe(MatchPhase.KNIFE_LIVE);
    });
  });

  describe('injectState', () => {
    it('devrait configurer Redis et pousser les événements WebSockets', async () => {
      const dto: InjectStateDto = {
        matchId: 'm-test-1',
        serverId: 'srv-a',
        phase: MatchPhase.LIVE_MAIN,
        score: { ct: 6, t: 5, round: 11 },
        sides: { home: 'CT', away: 'T' },
        halftimePlayed: false,
        overtimeCount: 0,
        players: [
          { steamId: '76561198000000001', name: 'PlayerOne', side: 'CT', cash: 16000 },
        ],
      };

      const result = await service.injectState(dto);

      expect(mockState.setServerIdToMatchId).toHaveBeenCalledWith('srv-a', 'm-test-1');
      expect(mockState.setSides).toHaveBeenCalledWith('m-test-1', { home: 'CT', away: 'T' });
      expect(mockState.setPhase).toHaveBeenCalledWith('m-test-1', MatchPhase.LIVE_MAIN);
      expect(mockRedis.hset).toHaveBeenCalled();
      expect(mockState.upsertPlayer).toHaveBeenCalledWith('m-test-1', expect.objectContaining({
        steamId: '76561198000000001',
        name: 'PlayerOne',
        logical: 'home',
      }));
      expect(mockState.setPlayerMoney).toHaveBeenCalledWith('m-test-1', '76561198000000001', 16000);
      expect(mockRedis.hset).toHaveBeenCalledWith(redisConst.ready('m-test-1'), { home: '0', away: '0' });
      expect(mockRedis.del).toHaveBeenCalledWith(redisConst.phaseLock('m-test-1'), redisConst.phasePending('m-test-1'));
      expect(mockWs.push).toHaveBeenCalledWith('m-test-1', 'match:state', expect.any(Object));
      expect(mockWs.push).toHaveBeenCalledWith('m-test-1', 'score:update', expect.any(Object));
      expect(result.matchId).toBe('m-test-1');
    });

    it('doit envoyer exec knife.cfg via RCON si la phase injectée est KNIFE_LIVE', async () => {
      await service.injectState({
        matchId: 'm-test-1',
        serverId: 'srv-a',
        phase: MatchPhase.KNIFE_LIVE,
      });

      expect(mockCmds.rcon).toHaveBeenCalledWith({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        command: CS2_RCON_COMMANDS.KNIFE_START,
      });
    });

    it('doit calculer automatiquement round, halftimePlayed et overtimeCount depuis le score si omis', async () => {
      // 13-11 -> round 24, halftimePlayed true, overtimeCount 0
      await service.injectState({
        matchId: 'm-test-1',
        score: { ct: 13, t: 11 },
      });
      expect(mockState.setHalftimePlayed).toHaveBeenCalledWith('m-test-1', true);
      expect(mockState.setOvertimeCount).toHaveBeenCalledWith('m-test-1', 0);
      expect(mockState.setLastScoredRound).toHaveBeenCalledWith('m-test-1', 24);

      // 14-13 -> round 27 (OT1), halftimePlayed true, overtimeCount 1
      await service.injectState({
        matchId: 'm-test-1',
        score: { ct: 14, t: 13 },
      });
      expect(mockState.setHalftimePlayed).toHaveBeenCalledWith('m-test-1', true);
      expect(mockState.setOvertimeCount).toHaveBeenCalledWith('m-test-1', 1);
      expect(mockState.setLastScoredRound).toHaveBeenCalledWith('m-test-1', 27);
    });
  });

  describe('restoreInGame', () => {
    it('devrait générer le fichier backup et envoyer la commande RCON native mp_backup_restore_load_file', async () => {
      const result = await service.restoreInGame({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        round: 12,
        scoreTeam1: 7,
        scoreTeam2: 5,
        team1Name: 'Team Alpha',
        team2Name: 'Team Bravo',
        map: 'de_inferno',
      });

      expect(result.ok).toBe(true);
      expect(mockBackupService.generateValveBackup).toHaveBeenCalledWith(expect.objectContaining({
        round: 12,
        team1Name: 'Team Alpha',
        team2Name: 'Team Bravo',
        scoreTeam1: 7,
        scoreTeam2: 5,
      }));
      expect(mockBackupService.writeBackupFile).toHaveBeenCalled();
      expect(mockCmds.rcon).toHaveBeenCalledWith({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        command: 'mp_backup_restore_load_file sandbox_round12.txt',
      });
      expect(result.rconCommand).toBe('mp_backup_restore_load_file sandbox_round12.txt');
    });

    it('devrait exécuter knife.cfg et passer en phase knife_live si round=0 et phase=knife_live (1-clic)', async () => {
      const result = await service.restoreInGame({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        round: 0,
        phase: MatchPhase.KNIFE_LIVE,
      });

      expect(result.ok).toBe(true);
      expect(mockBackupService.generateValveBackup).not.toHaveBeenCalled();
      expect(mockCmds.rcon).toHaveBeenCalledWith({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        command: CS2_RCON_COMMANDS.KNIFE_START,
      });
      expect(result.rconCommand).toBe(CS2_RCON_COMMANDS.KNIFE_START);
      expect(mockState.setPhase).toHaveBeenCalledWith('m-test-1', MatchPhase.KNIFE_LIVE);
    });

    it('devrait exécuter warmup.cfg si round=0 et phase=warmup_main (1-clic)', async () => {
      const result = await service.restoreInGame({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        round: 0,
        phase: MatchPhase.WARMUP_MAIN,
      });

      expect(result.ok).toBe(true);
      expect(mockBackupService.generateValveBackup).not.toHaveBeenCalled();
      expect(mockCmds.rcon).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-a',
          command: expect.stringContaining(CS2_CFG.WARMUP),
        }),
      );
      expect(mockState.setPhase).toHaveBeenCalledWith('m-test-1', MatchPhase.WARMUP_MAIN);
    });

    it('doit calculer automatiquement le round depuis scoreCt et scoreT si round est omis', async () => {
      const result = await service.restoreInGame({
        serverId: 'srv-a',
        matchId: 'm-test-1',
        scoreCt: 8,
        scoreT: 5,
        map: 'de_inferno',
      });

      expect(result.ok).toBe(true);
      expect(result.backupFileName).toBe('sandbox_round13.txt');
      expect(mockBackupService.generateValveBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          round: 13,
          scoreTeam1: 5, // round 13: team 1 est T (2ème mi-temps)
          scoreTeam2: 8, // team 2 est CT
        }),
      );
    });
  });

  describe('simulateRoundWin', () => {
    it('devrait publier un événement team_round_win sur le canal des événements Redis', async () => {
      const res = await service.simulateRoundWin('m-test-1', 'srv-a', 'CT');
      expect(res.ok).toBe(true);
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('"type":"team_round_win"'),
      );
    });
  });

  describe('simulateCommand', () => {
    it('devrait publier une commande chat joueur sur le bus Redis', async () => {
      const res = await service.simulateCommand('m-test-1', 'srv-a', '!ready', {
        name: 'Tester',
        steamId: '76561198000000001',
        team: 'CT',
      });
      expect(res.ok).toBe(true);
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('!ready'),
      );
    });
  });
});
