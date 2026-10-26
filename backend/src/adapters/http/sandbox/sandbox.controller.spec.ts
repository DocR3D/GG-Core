// src/adapters/http/sandbox/sandbox.controller.spec.ts
import { SandboxController } from './sandbox.controller';
import { SandboxService } from '@app/match/sandbox/sandbox.service';

describe('SandboxController', () => {
  let controller: SandboxController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getPresets: jest.fn().mockReturnValue([{ id: 'halftime_pivot', name: 'Halftime' }]),
      getAvailableFixtures: jest.fn().mockReturnValue([
        { id: 'sample.log', name: 'Sample Log', type: 'raw-log', sizeBytes: 1024 },
        { id: 'sample.json', name: 'Sample Scenario', type: 'scenario', sizeBytes: 2048 },
      ]),
      injectState: jest.fn().mockResolvedValue({ matchId: 'm-test-1', phase: 'live_main' }),
      restoreInGame: jest.fn().mockResolvedValue({ ok: true, rconCommand: 'mp_unpause_match' }),
      simulateRoundWin: jest.fn().mockResolvedValue({ ok: true }),
      simulateCommand: jest.fn().mockResolvedValue({ ok: true }),
      executeRcon: jest.fn().mockResolvedValue({ ok: true, command: 'status' }),
      getState: jest.fn().mockResolvedValue({ matchId: 'm-test-1', score: { ct: 1, t: 0 } }),
      replayRawLog: jest.fn().mockResolvedValue({
        ok: true,
        totalLines: 10,
        linesSent: 10,
        mode: 'agent_http',
        durationMs: 50,
      }),
      replayScenario: jest.fn().mockResolvedValue({
        ok: true,
        totalEvents: 5,
        eventsSent: 5,
        durationMs: 20,
      }),
    };

    controller = new SandboxController(mockService as unknown as SandboxService);
  });

  it('devrait être défini', () => {
    expect(controller).toBeDefined();
  });

  describe('getFixtures', () => {
    it('devrait retourner les fixtures fournies par SandboxService', () => {
      const result = controller.getFixtures();
      expect(result.ok).toBe(true);
      expect(result.fixtures).toHaveLength(2);
      expect(mockService.getAvailableFixtures).toHaveBeenCalledTimes(1);
    });
  });

  describe('replayRawLog', () => {
    it('devrait déléguer au SandboxService et retourner le résultat du rejeu', async () => {
      const dto = {
        matchId: 'm-test-1',
        serverId: 'srv-a',
        content: 'L 10/25/2025: Round_Start',
        speed: 'instant' as const,
      };

      const result = await controller.replayRawLog(dto);
      expect(result.ok).toBe(true);
      expect(result.linesSent).toBe(10);
      expect(result.mode).toBe('agent_http');
      expect(mockService.replayRawLog).toHaveBeenCalledWith(dto);
    });
  });

  describe('replayScenario', () => {
    it('devrait déléguer au SandboxService avec la liste d\'événements structurés', async () => {
      const dto = {
        matchId: 'm-test-1',
        serverId: 'srv-a',
        events: [{ type: 'round_start' }],
        speed: 'instant' as const,
      };

      const result = await controller.replayScenario(dto);
      expect(result.ok).toBe(true);
      expect(result.eventsSent).toBe(5);
      expect(mockService.replayScenario).toHaveBeenCalledWith(dto);
    });
  });

  describe('getState', () => {
    it('devrait retourner le snapshot complet incluant la phase du match', async () => {
      mockService.getState.mockResolvedValue({
        matchId: 'm-sandbox-1',
        phase: 'live_main',
        roundPhase: 'freeze',
        score: { ct: 6, t: 5, round: 11 },
      });

      const res = await controller.getState('m-sandbox-1');
      expect(res.ok).toBe(true);
      expect(res.snapshot).toBeDefined();
      expect(res.snapshot.phase).toBe('live_main');
      expect(res.snapshot.roundPhase).toBe('freeze');
      expect(mockService.getState).toHaveBeenCalledWith('m-sandbox-1');
    });
  });

  describe('getSandboxHtml', () => {
    it('devrait retourner la page HTML contenant la carte de rejeu et les fonctions JS', () => {
      let sentContent = '';
      const mockRes: any = {
        send: jest.fn((content) => {
          sentContent = content;
          return content;
        }),
      };

      controller.getSandboxHtml(mockRes);
      expect(mockRes.send).toHaveBeenCalled();
      expect(sentContent).toContain('GG-Core Match Sandbox & Round Doctor');
      expect(sentContent).toContain('Replay de Match Réel (.log Valve / Scénario JSON)');
      expect(sentContent).toContain('fixtureSelect');
      expect(sentContent).toContain('fileUpload');
      expect(sentContent).toContain('btnStartReplay');
      expect(sentContent).toContain('startReplay');
      expect(sentContent).toContain('loadFixtures');
      expect(sentContent).toContain('/socket.io/socket.io.js');
      expect(sentContent).toContain('wsStatusPill');
      expect(sentContent).toContain('setLogFilter');
      expect(sentContent).toContain('initWebSocket');
    });
  });
});
