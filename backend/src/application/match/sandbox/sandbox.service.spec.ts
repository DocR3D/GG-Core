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
import { REDIS_CHANNELS } from '../state/redis.keys';

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
      expect(mockWs.push).toHaveBeenCalledWith('m-test-1', 'match:state', expect.any(Object));
      expect(mockWs.push).toHaveBeenCalledWith('m-test-1', 'score:update', expect.any(Object));
      expect(result.matchId).toBe('m-test-1');
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
