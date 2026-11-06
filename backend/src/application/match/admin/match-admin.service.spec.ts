import { MatchPhase } from '@domain/phase.types';
import { MatchAdminError, MatchAdminService } from './match-admin.service';

describe('MatchAdminService (match console)', () => {
  const M = 'game-1';
  let orch: any, state: any, cmds: any, pause: any, prisma: any, ws: any, svc: MatchAdminService;
  const phase = (p: string) => state.getPhase.mockResolvedValue(p);

  beforeEach(() => {
    orch = {
      requestPauseTechnical: jest.fn().mockResolvedValue({ ok: true }),
      resume: jest.fn().mockResolvedValue({ ok: true }),
      isCountdownActive: jest.fn().mockResolvedValue(false),
      checkTeamPlacement: jest.fn().mockResolvedValue(true),
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      execCfg: jest.fn().mockResolvedValue(undefined),
      pushState: jest.fn().mockResolvedValue(undefined),
    };
    state = {
      getServerIdFromMatchId: jest.fn().mockResolvedValue('srv-a'),
      getPhase: jest.fn().mockResolvedValue(MatchPhase.LIVE_MAIN),
      getSettings: jest.fn().mockResolvedValue({ fixedSides: false }),
      swapSides: jest.fn().mockResolvedValue(true),
      getSnapshot: jest.fn().mockResolvedValue({ score: { round: 7 } }),
      getDbMatchMapId: jest.fn().mockResolvedValue(null),
    };
    cmds = { say: jest.fn(), rcon: jest.fn(), unpause: jest.fn() };
    pause = { isPaused: jest.fn().mockResolvedValue(false) };
    prisma = { eventPrimary: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) } };
    ws = { push: jest.fn() };
    svc = new MatchAdminService(orch, state, cmds, pause, prisma, ws);
  });

  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof MatchAdminError ? e.code : 'other';
    }
  };

  it('records every action with its author (event log + admins on the WebSocket)', async () => {
    await svc.pauseMatch(M, 'Admin Steam');
    expect(orch.requestPauseTechnical).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: M }, 'system');
    expect(prisma.eventPrimary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchId: M, serverId: 'srv-a', type: 'admin_action', payload: { action: 'pause', by: 'Admin Steam' } }),
    });
    expect(ws.push).toHaveBeenCalledWith(M, 'admin:action', expect.objectContaining({ action: 'pause', by: 'Admin Steam' }), 'admin');
  });

  it('pause: refused when already paused, or when the match is over / not on a server', async () => {
    pause.isPaused.mockResolvedValue(true);
    expect(await code(svc.pauseMatch(M, 'a'))).toBe('conflict');
    pause.isPaused.mockResolvedValue(false);
    phase(MatchPhase.POSTGAME);
    expect(await code(svc.pauseMatch(M, 'a'))).toBe('conflict');
    state.getServerIdFromMatchId.mockResolvedValue(null);
    expect(await code(svc.pauseMatch(M, 'a'))).toBe('not_found');
  });

  it("unpause: ends GG-Core's pause, or only the server's own pause (after a backup restore)", async () => {
    pause.isPaused.mockResolvedValue(true);
    await svc.unpauseMatch(M, 'a');
    expect(orch.resume).toHaveBeenCalled();
    pause.isPaused.mockResolvedValue(false);
    await svc.unpauseMatch(M, 'a');
    expect(cmds.unpause).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: M });
  });

  it('force start: next phase from the warmups, sides checked before the first live, nothing during the live', async () => {
    phase(MatchPhase.KNIFE_WARMUP);
    await svc.forceStart(M, 'a');
    expect(orch.startPhaseCountdown).toHaveBeenCalledWith(M, MatchPhase.KNIFE_LIVE, expect.any(Number), 'srv-a');

    phase(MatchPhase.WARMUP_MAIN);
    orch.checkTeamPlacement.mockResolvedValue(false);
    expect(await code(svc.forceStart(M, 'a'))).toBe('conflict');

    phase(MatchPhase.LIVE_MAIN);
    expect(await code(svc.forceStart(M, 'a'))).toBe('conflict');
  });

  it('swap teams: before the live only, GG-Core follows the teams; refused with sides from the veto', async () => {
    phase(MatchPhase.WARMUP_MAIN);
    await svc.swapTeams(M, 'a');
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: M, command: 'mp_swapteams' });
    expect(state.swapSides).toHaveBeenCalledWith(M);

    state.getSettings.mockResolvedValue({ fixedSides: true });
    expect(await code(svc.swapTeams(M, 'a'))).toBe('conflict');
    phase(MatchPhase.LIVE_MAIN);
    state.getSettings.mockResolvedValue({ fixedSides: false });
    expect(await code(svc.swapTeams(M, 'a'))).toBe('conflict');
  });

  it('restore round N loads backup_round(N-1), within the rounds played', async () => {
    await svc.restoreRound(M, 6, 'a');
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: M, command: 'mp_backup_restore_load_file backup_round05.txt' });
    expect(await code(svc.restoreRound(M, 8, 'a'))).toBe('invalid'); // round 7 is being played
    expect(await code(svc.restoreRound(M, 0, 'a'))).toBe('invalid');
    phase(MatchPhase.WARMUP_MAIN);
    expect(await code(svc.restoreRound(M, 1, 'a'))).toBe('conflict');
  });

  it('say: signed [Admin], quotes and line breaks removed, empty refused, allowed after the end', async () => {
    phase(MatchPhase.POSTGAME);
    await svc.say(M, '  Pause "repas"\nà 13h ', 'a');
    expect(cmds.say).toHaveBeenCalledWith('srv-a', '[Admin] Pause  repas  à 13h');
    expect(await code(svc.say(M, '   ', 'a'))).toBe('invalid');
  });

  describe('setPhase (back to the warmup or the knife, before the live)', () => {
    it('takes the match from the warmup to the knife warmup through the engine, and records it', async () => {
      phase(MatchPhase.WARMUP_MAIN);
      await svc.setPhase(M, 'knife', 'Admin');
      expect(orch.startPhaseCountdown).toHaveBeenCalledWith(M, MatchPhase.KNIFE_WARMUP, 0, 'srv-a');
      expect(cmds.say).toHaveBeenCalledWith('srv-a', expect.stringContaining('knife'));
      expect(prisma.eventPrimary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'admin_action', payload: { action: 'set_phase', by: 'Admin', from: MatchPhase.WARMUP_MAIN, to: MatchPhase.KNIFE_WARMUP } }),
      });
    });

    it('removes the knife config first when the knife is in progress, then goes back to the warmup', async () => {
      phase(MatchPhase.KNIFE_LIVE);
      await svc.setPhase(M, 'warmup', 'Admin');
      expect(orch.execCfg).toHaveBeenCalledWith({ serverId: 'srv-a', matchId: M }, 'knife_undo.cfg');
      expect(orch.execCfg.mock.invocationCallOrder[0]).toBeLessThan(orch.startPhaseCountdown.mock.invocationCallOrder[0]);
      expect(orch.startPhaseCountdown).toHaveBeenCalledWith(M, MatchPhase.WARMUP_MAIN, 0, 'srv-a');
    });

    it.each([MatchPhase.KNIFE_WARMUP, MatchPhase.KNIFE_CHOICE, MatchPhase.WARMUP_MAIN])('is allowed from %s without touching the knife config', async (from) => {
      phase(from);
      await svc.setPhase(M, 'warmup', 'Admin');
      expect(orch.execCfg).not.toHaveBeenCalled();
      expect(orch.startPhaseCountdown).toHaveBeenCalledWith(M, MatchPhase.WARMUP_MAIN, 0, 'srv-a');
    });

    it.each([MatchPhase.LIVE_MAIN, MatchPhase.OVERTIME, MatchPhase.HALFTIME, MatchPhase.PAUSED_TECH])('is refused from %s (the live has started)', async (from) => {
      phase(from);
      expect(await code(svc.setPhase(M, 'warmup', 'Admin'))).toBe('conflict');
      expect(orch.startPhaseCountdown).not.toHaveBeenCalled();
      expect(prisma.eventPrimary.create).not.toHaveBeenCalled();
    });

    it('is refused when the match is over, during a countdown, and for an unknown phase', async () => {
      phase(MatchPhase.POSTGAME);
      expect(await code(svc.setPhase(M, 'knife', 'Admin'))).toBe('conflict');
      phase(MatchPhase.WARMUP_MAIN);
      orch.isCountdownActive.mockResolvedValue(true);
      expect(await code(svc.setPhase(M, 'knife', 'Admin'))).toBe('conflict');
      orch.isCountdownActive.mockResolvedValue(false);
      expect(await code(svc.setPhase(M, 'overtime', 'Admin'))).toBe('invalid');
      expect(await code(svc.setPhase(M, '', 'Admin'))).toBe('invalid');
      expect(orch.startPhaseCountdown).not.toHaveBeenCalled();
    });
  });
});
