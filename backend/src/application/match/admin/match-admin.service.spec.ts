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
});
