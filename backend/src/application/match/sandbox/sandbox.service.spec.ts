// src/application/match/sandbox/sandbox.service.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import { SandboxService, splitRawLogIntoRounds, parseCs2LineFallback } from './sandbox.service';
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
      getMatchIdFromServerId: jest.fn().mockResolvedValue(null),
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
      setPlayerStats: jest.fn().mockResolvedValue('OK'),
      resetPlayerStats: jest.fn().mockResolvedValue('OK'),
      clearRoster: jest.fn().mockResolvedValue(undefined),
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
      exec: jest.fn().mockResolvedValue({ ok: true }),
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

    it("doit appliquer knife.cfg via l'agent (pas en RCON brut) si la phase injectée est KNIFE_LIVE", async () => {
      await service.injectState({
        matchId: 'm-test-1',
        serverId: 'srv-a',
        phase: MatchPhase.KNIFE_LIVE,
      });

      expect(mockCmds.exec).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: 'm-test-1', cfgName: 'knife.cfg' });
      expect(mockCmds.rcon).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'exec knife.cfg' }));
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
      expect(mockCmds.exec).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: 'm-test-1', cfgName: 'knife.cfg' });
      expect(result.rconCommand).toContain('knife.cfg');
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
      expect(mockCmds.exec).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv-a', cfgName: CS2_CFG.WARMUP }));
      expect(mockCmds.rcon).toHaveBeenCalledWith(
        expect.objectContaining({ serverId: 'srv-a', command: expect.stringContaining('mp_warmup_start 1') }),
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

    it('devrait basculer automatiquement de postgame à live_main pour autoriser le comptage', async () => {
      mockState.getPhase = jest.fn().mockResolvedValue(MatchPhase.POSTGAME);
      mockState.setPhase = jest.fn().mockResolvedValue('OK');

      await service.simulateRoundWin('m-test-1', 'srv-a', 'CT');

      expect(mockState.setPhase).toHaveBeenCalledWith('m-test-1', MatchPhase.LIVE_MAIN);
      expect(mockWs.push).toHaveBeenCalledWith('m-test-1', 'phase:changed', expect.objectContaining({ phase: MatchPhase.LIVE_MAIN }));
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

    it('devrait assigner une équipe par défaut (CT) si sender.team est omis (ex: !pause)', async () => {
      await service.simulateCommand('m-test-1', 'srv-a', '!pause', {
        name: 'Tester',
      });

      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('"team":"CT"'),
      );
    });

    it('devrait automatiquement s\'aligner sur le vainqueur du knife pour !stay ou !switch', async () => {
      mockState.getKnifeResult = jest.fn().mockResolvedValue({ side: 'T', winnerTeam: 'away' });

      await service.simulateCommand('m-test-1', 'srv-a', '!stay', {
        name: 'Captain_T',
      });

      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('"team":"T"'),
      );
    });
  });

  describe('getAvailableFixtures', () => {
    it('devrait retourner les fixtures de logs bruts et les scénarios JSON disponibles', () => {
      const fixtures = service.getAvailableFixtures();
      expect(Array.isArray(fixtures)).toBe(true);
      expect(fixtures.length).toBeGreaterThan(0);

      const rawLog = fixtures.find((f) => f.type === 'raw-log');
      expect(rawLog).toBeDefined();
      expect(rawLog?.id).toContain('.log');

      const scenario = fixtures.find((f) => f.type === 'scenario');
      expect(scenario).toBeDefined();
      expect(scenario?.id).toContain('.json');
    });
  });

  describe('replay : serveur occupé par un vrai match', () => {
    const LOG = 'L 10/25/2025 - 10:00:00: World triggered "Round_Start"';

    it('refuse le replay si le serveur fait tourner un autre match non terminé', async () => {
      mockState.getMatchIdFromServerId = jest.fn().mockResolvedValue('m-real-match');
      mockState.getPhase = jest.fn().mockResolvedValue(MatchPhase.LIVE_MAIN);
      await expect(service.replayRawLog({ content: LOG, matchId: 'm-sandbox-1', serverId: 'srv-a' }))
        .rejects.toThrow(/m-real-match.*live_main/);
      expect(mockState.setServerIdToMatchId).not.toHaveBeenCalled();
    });

    it('autorise le replay si le match lié au serveur est terminé, ou si c’est le même match (log coupé rejoué)', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Agent offline')) as any;
      try {
        mockState.getMatchIdFromServerId = jest.fn().mockResolvedValue('m-real-match');
        mockState.getPhase = jest.fn().mockResolvedValue(MatchPhase.POSTGAME);
        await expect(service.replayRawLog({ content: LOG, matchId: 'm-sandbox-1', serverId: 'srv-a' })).resolves.toEqual(expect.objectContaining({ ok: true }));

        mockState.getMatchIdFromServerId = jest.fn().mockResolvedValue('m-sandbox-1');
        mockState.getPhase = jest.fn().mockResolvedValue(MatchPhase.LIVE_MAIN);
        await expect(service.replayRawLog({ content: LOG, matchId: 'm-sandbox-1', serverId: 'srv-a' })).resolves.toEqual(expect.objectContaining({ ok: true }));
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('replayRawLog', () => {
    it('devrait lever une BadRequestException si aucun contenu ou fixture valide n\'est fourni', async () => {
      await expect(service.replayRawLog({ content: '   ' })).rejects.toThrow();
    });

    it('devrait analyser les lignes de log via le fallback parser et publier sur Redis si l\'Agent est indisponible', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Agent offline')) as any;

      try {
        const sampleLogs = [
          'L 10/25/2025 - 10:00:00: World triggered "Round_Start"',
          'L 10/25/2025 - 10:00:45: "PlayerOne<1><[U:1:1]><CT>" [100 200 0] killed "PlayerTwo<2><[U:1:2]><TERRORIST>" [150 250 0] with "m4a1_silencer" (headshot)',
          'L 10/25/2025 - 10:01:10: Team "CT" triggered "SFUI_Notice_CTs_Win" (CT "1") (T "0")',
          'L 10/25/2025 - 10:01:15: World triggered "Round_End"',
        ].join('\n');

        const res = await service.replayRawLog({
          matchId: 'm-test-1',
          serverId: 'srv-a',
          content: sampleLogs,
          speed: 'instant',
        });

        expect(res.ok).toBe(true);
        expect(res.mode).toBe('fallback_parser');
        expect(res.totalLines).toBe(4);
        expect(res.linesSent).toBeGreaterThanOrEqual(3);
        expect(mockPub.publish).toHaveBeenCalledWith(
          REDIS_CHANNELS.EVENTS,
          expect.stringContaining('round_start'),
        );
        expect(mockPub.publish).toHaveBeenCalledWith(
          REDIS_CHANNELS.EVENTS,
          expect.stringContaining('kill'),
        );
        expect(mockPub.publish).toHaveBeenCalledWith(
          REDIS_CHANNELS.EVENTS,
          expect.stringContaining('team_round_win'),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('devrait envoyer les lignes via HTTP si l\'agent est joignable', async () => {
      const originalFetch = global.fetch;
      const mockFetch = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () => Promise.resolve('OK'),
        });
      });
      global.fetch = mockFetch as any;

      try {
        const sampleLogs = 'L 10/25/2025 - 10:00:00: World triggered "Round_Start"';
        const res = await service.replayRawLog({
          matchId: 'm-test-1',
          serverId: 'srv-a',
          content: sampleLogs,
          speed: 'instant',
        });

        expect(res.ok).toBe(true);
        expect(res.mode).toBe('agent_http');
        expect(mockFetch).toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('replayScenario', () => {
    it('devrait lever une BadRequestException si la liste d\'événements est vide', async () => {
      await expect(service.replayScenario({ events: [] })).rejects.toThrow();
    });

    it('devrait publier tous les événements du scénario sur le bus Redis', async () => {
      const events = [
        { type: 'round_start', payload: { round: 1 } },
        { type: 'kill', payload: { attacker: { name: 'P1' }, victim: { name: 'P2' } } },
        { type: 'team_round_win', payload: { winner: 'CT' } },
      ];

      const res = await service.replayScenario({
        matchId: 'm-test-1',
        serverId: 'srv-a',
        events,
        speed: 'instant',
      });

      expect(res.ok).toBe(true);
      expect(res.totalEvents).toBe(3);
      expect(res.eventsSent).toBe(3);
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('round_start'),
      );
      expect(mockPub.publish).toHaveBeenCalledWith(
        REDIS_CHANNELS.EVENTS,
        expect.stringContaining('team_round_win'),
      );
    });
  });

  describe('replay round par round', () => {
    const FIXTURE = 'gglan19_match69_nuke_backup_restore_anonymized.log';
    const realAgentUrl = process.env.AGENT_LOGS_URL;
    let chunkEvents: number[];

    beforeAll(() => {
      // Jamais d'envoi vers un vrai Agent Go pendant les tests : URL injoignable => parser de secours
      process.env.AGENT_LOGS_URL = 'http://127.0.0.1:1/logs';
      const lines = fs.readFileSync(path.resolve(__dirname, '../../../../../test/fixtures/raw-logs', FIXTURE), 'utf8')
        .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // nombre d'événements publiés par tranche (même parser que le service)
      chunkEvents = splitRawLogIntoRounds(lines).map(
        (c) => c.items.filter((l) => parseCs2LineFallback(l, 'm-rbr', 'srv-a') !== null).length,
      );
    });
    afterAll(() => {
      if (realAgentUrl === undefined) delete process.env.AGENT_LOGS_URL;
      else process.env.AGENT_LOGS_URL = realAgentUrl;
    });

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    it('prépare la session sans jouer de round, puis avance round par round', async () => {
      const st = await service.startRoundByRound({ matchId: 'm-rbr', fixtureName: FIXTURE });
      expect(st).toMatchObject({ ok: true, kind: 'raw-log', cursor: 0, totalRounds: chunkEvents.length });
      expect(mockPub.publish).not.toHaveBeenCalled();

      await service.stepRoundByRound({ matchId: 'm-rbr', action: 'next' });
      const after2 = await service.stepRoundByRound({ matchId: 'm-rbr', action: 'next' });
      expect(after2.cursor).toBe(2);
      expect(mockPub.publish).toHaveBeenCalledTimes(sum(chunkEvents.slice(0, 2)));
    });

    it("recule en réinitialisant le match puis en rejouant jusqu'au round visé", async () => {
      await service.startRoundByRound({ matchId: 'm-rbr', fixtureName: FIXTURE });
      await service.stepRoundByRound({ matchId: 'm-rbr', action: 'goto', round: 3 });
      mockPub.publish.mockClear();
      mockState.resetPlayerStats.mockClear();

      const st = await service.stepRoundByRound({ matchId: 'm-rbr', action: 'prev' });
      expect(st.cursor).toBe(2);
      expect(mockState.resetPlayerStats).toHaveBeenCalled(); // reset complet
      expect(mockPub.publish).toHaveBeenCalledTimes(sum(chunkEvents.slice(0, 2)));
    });

    it('borne les déplacements et refuse un step sans session', async () => {
      await service.startRoundByRound({ matchId: 'm-rbr', fixtureName: FIXTURE });
      const end = await service.stepRoundByRound({ matchId: 'm-rbr', action: 'goto', round: 999 });
      expect(end.cursor).toBe(chunkEvents.length);
      const back = await service.stepRoundByRound({ matchId: 'm-rbr', action: 'goto', round: -5 });
      expect(back.cursor).toBe(0);
      await expect(service.stepRoundByRound({ matchId: 'm-inconnu', action: 'next' })).rejects.toThrow(/Aucun replay/);
    });
  });
});
