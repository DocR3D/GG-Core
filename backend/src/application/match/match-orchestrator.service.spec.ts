/**
 * MatchOrchestrator : pause use cases (request, armed pause at the freeze, automatic end of a tactical pause, resume),
 * round phase events and the start of a match. (Game Over review and postgame: the two other specs of this folder.)
 */
import { MatchOrchestrator } from './match-orchestrator.service';
import { MatchPhase, RoundPhase } from '@domain/phase.types';
import { DEFAULT_MATCH_SETTINGS } from '@domain/match-settings.types';
import { REDIS_CHANNELS } from './state/redis.keys';

const M = 'm-1';
const SRV = 'srv-a';

function setup(over: { allowed?: { allowed: boolean; why?: string }; roundPhase?: RoundPhase; armed?: unknown } = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => jest.fn((..._a: unknown[]) => { calls.push(name); return Promise.resolve(value); });

  const published: Array<Record<string, any>> = [];
  const pub = { publish: jest.fn((_c: string, raw: string) => { published.push(JSON.parse(raw)); return Promise.resolve(1); }) };
  const ws = { push: jest.fn().mockResolvedValue(undefined) };
  const pause = {
    isPauseAllowed: jest.fn().mockResolvedValue(over.allowed ?? { allowed: true }),
    pause: track('pause.pause', undefined),
    resume: track('pause.resume', undefined),
    consumeArmed: jest.fn().mockResolvedValue(over.armed ?? { consumed: false }),
    getTacBank: jest.fn().mockResolvedValue(30),
    getPauseState: jest.fn().mockResolvedValue({ state: 'none' }),
    initTacBanks: track('pause.initTacBanks', undefined),
  };
  const phase = {
    getRoundPhase: jest.fn().mockResolvedValue(over.roundPhase ?? RoundPhase.LIVE),
    setRoundPhase: jest.fn().mockResolvedValue(undefined),
    isCountdownActive: jest.fn().mockReturnValue(true),
    startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
    isBothReady: jest.fn().mockResolvedValue(true),
    setReady: jest.fn().mockResolvedValue(undefined),
    resetReady: jest.fn().mockResolvedValue(undefined),
  };
  const cmds = {
    say: track('cmds.say', undefined),
    pause: track('cmds.pause', { ok: true }),
    unpause: track('cmds.unpause', { ok: true }),
    rcon: jest.fn((a: { command: string }) => { calls.push(`rcon:${a.command}`); return Promise.resolve({ ok: true }); }),
    exec: jest.fn((a: { cfgName: string }) => { calls.push(`exec:${a.cfgName}`); return Promise.resolve({ ok: true }); }),
    changeLevel: jest.fn((a: { map: string }) => { calls.push(`changelevel:${a.map}`); return Promise.resolve({ ok: true }); }),
    restartGame: jest.fn().mockResolvedValue({ ok: true }),
  };
  const state = {
    getServerIdFromMatchId: jest.fn().mockResolvedValue(SRV),
    getMatchIdFromServerId: jest.fn().mockResolvedValue(M),
    getSnapshot: jest.fn().mockResolvedValue({
      matchId: M, sides: { home: 'CT', away: 'T' }, score: { round: 4, ct: 2, t: 2, phase: 'live_main' },
      teams: { ct_name: 'Alpha', t_name: 'Bravo' }, economy: { home_bank: 8000, away_bank: 5000, home_loss_streak: 1, away_loss_streak: 0 },
    }),
    setSettings: track('state.setSettings', undefined),
    setServerIdToMatchId: track('state.bind', undefined),
    swapSides: jest.fn().mockResolvedValue(true),
    getSides: jest.fn().mockResolvedValue({ home: 'T', away: 'CT' }),
    sideToLogical: jest.fn().mockResolvedValue('home'),
    logicalToSide: jest.fn().mockResolvedValue('CT'),
    applyKnifeResult: jest.fn().mockResolvedValue(undefined),
    getKnifeResult: jest.fn().mockResolvedValue({ winner: 'CT' }),
    roundEnd: jest.fn().mockResolvedValue(undefined),
  };
  const sides = { setPhase: track('sides.setPhase', undefined), getPhase: jest.fn().mockResolvedValue(MatchPhase.LIVE_MAIN) };
  const accessSvc = { apply: track('access.apply', { password: 'pw', whitelist: 4 }) };
  const placement = { checkBeforeLive: jest.fn().mockResolvedValue(false) };
  const buytime = { onFreezeTime: jest.fn().mockResolvedValue(undefined) };
  const sponsors = { onPauseStarted: jest.fn().mockResolvedValue(undefined) };

  const orch = new MatchOrchestrator(
    ws as never, pause as never, phase as never, cmds as never, state as never, sides as never, {} as never, pub as never,
    undefined, accessSvc as never, placement as never, buytime as never, sponsors as never,
  );
  return { orch, calls, published, pub, ws, pause, phase, cmds, state, sides, accessSvc, placement, buytime, sponsors };
}

type H = ReturnType<typeof setup>;

describe('MatchOrchestrator : pause requests', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-07T10:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('finds the other id by itself, and refuses to act when neither can be found', async () => {
    const h = setup({ roundPhase: RoundPhase.FREEZE });
    await h.orch.requestPauseTactical({ matchId: M }, 'home');
    expect(h.state.getServerIdFromMatchId).toHaveBeenCalledWith(M);
    await h.orch.requestPauseTactical({ serverId: SRV }, 'home');
    expect(h.state.getMatchIdFromServerId).toHaveBeenCalledWith(SRV);

    h.state.getServerIdFromMatchId.mockResolvedValue(undefined);
    await expect(h.orch.requestPauseTactical({ matchId: M }, 'home')).rejects.toThrow('serverId et/ou matchId manquant');
    await expect(h.orch.requestPauseTactical({}, 'home')).rejects.toThrow();
  });

  describe('tactical', () => {
    it('is refused with the reason given by the pause rules, nothing is sent', async () => {
      const h = setup({ allowed: { allowed: false, why: 'no_bank' }, roundPhase: RoundPhase.FREEZE });
      expect(await h.orch.requestPauseTactical({ matchId: M, serverId: SRV }, 'home')).toEqual({ ok: false, why: 'no_bank' });
      expect(h.calls).toEqual([]);
    });

    it('during a round, only arms the pause (told in the chat), nothing reaches the game yet', async () => {
      const h = setup({ roundPhase: RoundPhase.LIVE });
      expect(await h.orch.requestPauseTactical({ matchId: M, serverId: SRV }, 'away')).toEqual({ ok: true });
      expect(h.pause.pause).toHaveBeenCalledWith(M, SRV, { reason: 'tactical', team: 'away', armOnly: true });
      expect(h.cmds.pause).not.toHaveBeenCalled();
      expect(h.cmds.say).toHaveBeenCalledWith(SRV, expect.stringContaining('enregistree'));
      expect(h.published).toEqual([]);
    });

    it('in the freeze time, pauses the game and the state, announces it and ends by itself when the bank is spent', async () => {
      const h = setup({ roundPhase: RoundPhase.FREEZE });
      h.pause.getTacBank.mockResolvedValue(30);

      await h.orch.requestPauseTactical({ matchId: M, serverId: SRV }, 'home');

      expect(h.calls).toEqual(['cmds.pause', 'pause.pause']);
      expect(h.pause.pause).toHaveBeenCalledWith(M, SRV, { reason: 'tactical', team: 'home' });
      expect(h.published).toEqual([expect.objectContaining({ v: 1, type: 'pause:started', matchId: M, serverId: SRV, reason: 'tactical', team: 'home' })]);
      expect(h.sponsors.onPauseStarted).toHaveBeenCalledWith(M, SRV, 'tactical');
      expect(h.pub.publish).toHaveBeenCalledWith(REDIS_CHANNELS.EVENTS, expect.any(String));

      // 30 s later the pause is still running and its bank is spent: resumed by itself, said as "expired"
      h.pause.getPauseState.mockResolvedValue({ state: 'paused', reason: 'tactical', team: 'home', startedAt: Date.now(), tacBankHome: 30 });
      await jest.advanceTimersByTimeAsync(30_000);
      expect(h.pause.resume).toHaveBeenCalledWith(M);
      expect(h.cmds.unpause).toHaveBeenCalled();
      expect(h.published.at(-1)).toMatchObject({ type: 'pause:resumed', source: 'expired', reason: 'tactical' });
    });
  });

  describe('automatic end of a tactical pause', () => {
    async function pausedTactical(h: H, state: Record<string, unknown>) {
      h.pause.getPauseState.mockResolvedValue({ state: 'paused', reason: 'tactical', team: 'home', startedAt: Date.now(), tacBankHome: 30, ...state });
      await h.orch.requestPauseTactical({ matchId: M, serverId: SRV }, 'home');
    }
    const freeze = () => setup({ roundPhase: RoundPhase.FREEZE });

    it('does nothing when the game is no longer in a tactical pause (resumed, or replaced by a technical one)', async () => {
      for (const state of [{ state: 'none' }, { reason: 'technical' }, { team: undefined }]) {
        const h = freeze();
        await pausedTactical(h, state);
        await jest.advanceTimersByTimeAsync(31_000);
        expect(h.pause.resume).not.toHaveBeenCalled();
      }
    });

    it('waits again for what is left when the bank is bigger than the time spent', async () => {
      const h = freeze();
      await pausedTactical(h, { tacBankHome: 60 });
      await jest.advanceTimersByTimeAsync(30_000);
      expect(h.pause.resume).not.toHaveBeenCalled(); // 30 s left
      await jest.advanceTimersByTimeAsync(30_000);
      expect(h.pause.resume).toHaveBeenCalledTimes(1);
    });

    it('is cancelled by a manual resume, and not repeated if the resume itself fails', async () => {
      const h = freeze();
      await pausedTactical(h, {});
      await h.orch.resume({ matchId: M, serverId: SRV });
      h.pause.resume.mockClear();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(h.pause.resume).not.toHaveBeenCalled();

      const failing = freeze();
      await pausedTactical(failing, {});
      failing.pause.resume.mockRejectedValue(new Error('redis down'));
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(failing.pause.resume).toHaveBeenCalledTimes(1); // not re-armed: it would loop
    });

    it('a new tactical pause replaces the previous timer instead of adding one', async () => {
      const h = freeze();
      await pausedTactical(h, {});
      await pausedTactical(h, {});
      await jest.advanceTimersByTimeAsync(30_000);
      expect(h.pause.resume).toHaveBeenCalledTimes(1);
    });
  });

  describe('pause armed during the round, applied at the next freeze time', () => {
    const ev = { matchId: M, serverId: SRV } as never;

    it('does nothing when nobody armed a pause', async () => {
      const h = setup();
      await h.orch.applyPauseIfArmed(ev);
      expect(h.calls).toEqual([]);
    });

    it('applies the oldest request: state first, then the game, with 30 s for a tactical and 60 s for a technical pause', async () => {
      const tactical = setup({ armed: { consumed: true, pick: { team: 'home', req: { reason: 'tactical', by: { steamId: 'S1', name: 'A', source: 'chat' } } } } });
      await tactical.orch.applyPauseIfArmed(ev);
      expect(tactical.calls.slice(0, 2)).toEqual(['pause.pause', 'cmds.pause']);
      expect(tactical.pause.pause).toHaveBeenCalledWith(M, SRV, { reason: 'tactical', team: 'home', durationSec: 30, armOnly: false, by: { steamId: 'S1', name: 'A', source: 'chat' } });
      expect(tactical.sponsors.onPauseStarted).toHaveBeenCalledWith(M, SRV, 'tactical');

      const technical = setup({ armed: { consumed: true, pick: { team: 'away', req: { reason: 'technical' } } } });
      await technical.orch.applyPauseIfArmed(ev);
      expect(technical.pause.pause).toHaveBeenCalledWith(M, SRV, expect.objectContaining({ reason: 'technical', durationSec: 60 }));

      const given = setup({ armed: { consumed: true, pick: { team: 'away', req: { reason: 'technical', durationSec: 15 } } } });
      await given.orch.applyPauseIfArmed(ev);
      expect(given.pause.pause).toHaveBeenCalledWith(M, SRV, expect.objectContaining({ durationSec: 15 }));
    });

    it('arms the automatic end for a tactical pause of a team, never for a technical or system pause', async () => {
      const tactical = setup({ armed: { consumed: true, pick: { team: 'home', req: { reason: 'tactical' } } } });
      tactical.pause.getPauseState.mockResolvedValue({ state: 'paused', reason: 'tactical', team: 'home', startedAt: Date.now(), tacBankHome: 30 });
      await tactical.orch.applyPauseIfArmed(ev);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(tactical.pause.resume).toHaveBeenCalledTimes(1);

      for (const pick of [{ team: 'home', req: { reason: 'technical' } }, { team: 'system', req: { reason: 'tactical' } }]) {
        const h = setup({ armed: { consumed: true, pick } });
        h.pause.getPauseState.mockResolvedValue({ state: 'paused', reason: 'tactical', team: 'home', startedAt: Date.now(), tacBankHome: 30 });
        await h.orch.applyPauseIfArmed(ev);
        await jest.advanceTimersByTimeAsync(60_000);
        expect(h.pause.resume).not.toHaveBeenCalled();
      }
    });
  });

  it('technical pause: state, game and announcement, no automatic end', async () => {
    const h = setup();
    expect(await h.orch.requestPauseTechnical({ matchId: M, serverId: SRV })).toEqual({ ok: true });
    expect(h.pause.pause).toHaveBeenCalledWith(M, SRV, { reason: 'technical', team: 'home', armOnly: false });
    expect(h.calls).toEqual(['pause.pause', 'cmds.pause']);
    expect(h.published[0]).toMatchObject({ type: 'pause:started', reason: 'technical', team: 'home' });
    await jest.advanceTimersByTimeAsync(600_000);
    expect(h.pause.resume).not.toHaveBeenCalled();

    await h.orch.requestPauseTechnical({ matchId: M, serverId: SRV }, 'system');
    expect(h.pause.pause).toHaveBeenLastCalledWith(M, SRV, expect.objectContaining({ team: 'system' }));
  });

  it('resume: bank charged, game unpaused, announced (an admin resume by default, the source and reason when given)', async () => {
    const h = setup();
    await h.orch.resume({ matchId: M, serverId: SRV });
    expect(h.calls).toEqual(['pause.resume', 'cmds.unpause']);
    expect(h.published[0]).toMatchObject({ type: 'pause:resumed', matchId: M, serverId: SRV, source: 'admin', reason: 'tactical' });

    await h.orch.resume({ matchId: M, serverId: SRV }, { source: 'chat', reason: 'technical' });
    expect(h.published[1]).toMatchObject({ source: 'chat', reason: 'technical' });
  });
});

describe('MatchOrchestrator : round events', () => {
  const ev = { matchId: M, serverId: SRV } as never;

  it('follows the round phase: freeze (and applies an armed pause + buy time), live, bomb planted, end', async () => {
    const h = setup({ armed: { consumed: true, pick: { team: 'home', req: { reason: 'technical' } } } });
    await h.orch.onFreezeTimeStart(ev);
    expect(h.phase.setRoundPhase).toHaveBeenCalledWith(M, RoundPhase.FREEZE);
    expect(h.pause.pause).toHaveBeenCalled();
    expect(h.buytime.onFreezeTime).toHaveBeenCalledWith(M, SRV);

    await h.orch.onRoundStart(ev);
    expect(h.phase.setRoundPhase).toHaveBeenLastCalledWith(M, RoundPhase.LIVE);
    expect(h.buytime.onFreezeTime).toHaveBeenCalledTimes(2);
    await h.orch.onBombPlanted(ev);
    expect(h.phase.setRoundPhase).toHaveBeenLastCalledWith(M, RoundPhase.BOMB_PLANTED);
    await h.orch.onRoundEnd(ev);
    expect(h.phase.setRoundPhase).toHaveBeenLastCalledWith(M, RoundPhase.END);
  });

  it('works without the buy time broadcast, and with a snapshot whose economy is still empty', async () => {
    const h = setup();
    const bare = new MatchOrchestrator(h.ws as never, h.pause as never, h.phase as never, h.cmds as never, h.state as never, h.sides as never, {} as never, h.pub as never);
    h.state.getSnapshot.mockResolvedValue({ matchId: M, sides: { home: 'T', away: 'CT' }, score: { round: 1, ct: 0, t: 0, phase: 'live_main' }, teams: {}, economy: {} });
    await expect(bare.onFreezeTimeStart(ev)).resolves.toBeUndefined();
    await expect(bare.onRoundStart(ev)).resolves.toBeUndefined();
  });
});

describe('MatchOrchestrator : starting a match', () => {
  const opts = { serverId: SRV, matchId: M };

  it('sets the game up in order: settings, server link, banks, GOTV on, map, warmup cfg, access, demo, phase, announcement, state', async () => {
    const h = setup();

    const out = await h.orch.startMatch({ ...opts, mapName: 'de_nuke', access: { password: 'pw' } });

    expect(h.calls).toEqual([
      'state.setSettings', 'state.bind', 'pause.initTacBanks',
      'rcon:tv_enable 1', 'rcon:tv_stoprecord',
      'changelevel:de_nuke', 'exec:warmup.cfg', 'access.apply',
      `rcon:tv_record "${M}_de_nuke"`,
      'sides.setPhase', 'cmds.say',
    ]);
    expect(out).toEqual({ ok: true, matchId: M, serverId: SRV, map: 'de_nuke', phase: MatchPhase.KNIFE_WARMUP, access: { password: 'pw', whitelist: 4 } });
    expect(h.accessSvc.apply).toHaveBeenCalledWith(M, SRV, { password: 'pw' });
    expect(h.cmds.say).toHaveBeenCalledWith(SRV, expect.stringContaining('de_nuke'));
    expect(h.ws.push).toHaveBeenCalledWith(M, 'match:state', expect.objectContaining({ matchId: M }), undefined);
  });

  it('merges the settings over the defaults, and starts in the main warmup when there is no knife round', async () => {
    const h = setup();
    const out = await h.orch.startMatch({ ...opts, settings: { knifeEnabled: false, tacticalPauseBankSec: 90 } });
    expect(h.state.setSettings).toHaveBeenCalledWith(M, { ...DEFAULT_MATCH_SETTINGS, knifeEnabled: false, tacticalPauseBankSec: 90 });
    expect(h.pause.initTacBanks).toHaveBeenCalledWith(M, 90);
    expect(out.phase).toBe(MatchPhase.WARMUP_MAIN);
    expect(h.sides.setPhase).toHaveBeenCalledWith(M, MatchPhase.WARMUP_MAIN);
    expect(out.map).toBe('de_mirage'); // default map
  });

  it('goes on when the game refuses GOTV, the map change or the warmup cfg (a server that is not ready yet)', async () => {
    const h = setup();
    h.cmds.rcon.mockRejectedValue(new Error('rcon down'));
    h.cmds.changeLevel.mockRejectedValue(new Error('no such map'));
    h.cmds.exec.mockRejectedValue(new Error('cfg'));
    const out = await h.orch.startMatch(opts);
    expect(out.ok).toBe(true);
    expect(h.sides.setPhase).toHaveBeenCalled();
    expect(h.cmds.say).toHaveBeenCalled();
  });

  it('a start without access service (sandbox, tests) reports no access', async () => {
    const h = setup();
    const bare = new MatchOrchestrator(h.ws as never, h.pause as never, h.phase as never, h.cmds as never, h.state as never, h.sides as never, {} as never, h.pub as never);
    expect((await bare.startMatch(opts)).access).toBeUndefined();
  });
});

describe('MatchOrchestrator : delegations', () => {
  it('check of the sides before the live: true without placement service or server, otherwise the verdict of the placement', async () => {
    const h = setup();
    expect(await h.orch.checkTeamPlacement(M, SRV)).toBe(false);
    expect(h.placement.checkBeforeLive).toHaveBeenCalledWith(M, SRV);
    expect(await h.orch.checkTeamPlacement(M, '')).toBe(true);

    const bare = new MatchOrchestrator(h.ws as never, h.pause as never, h.phase as never, h.cmds as never, h.state as never, h.sides as never, {} as never, h.pub as never);
    expect(await bare.checkTeamPlacement(M, SRV)).toBe(true);
  });

  it('swapping the sides tells the clients only when the sides were really swapped', async () => {
    const h = setup();
    expect(await h.orch.swapSides(M)).toBe(true);
    expect(h.ws.push).toHaveBeenCalledWith(M, 'sides:swapped', { sides: { home: 'T', away: 'CT' } }, undefined);

    const nothing = setup();
    nothing.state.swapSides.mockResolvedValue(false);
    expect(await nothing.orch.swapSides(M)).toBe(false);
    expect(nothing.ws.push).not.toHaveBeenCalled();
  });

  it('hands the countdown, ready flags, knife, sides and phase to the services that own them', async () => {
    const h = setup();
    expect(h.orch.isCountdownActive(M)).toBe(true);
    await h.orch.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 5, SRV);
    expect(h.phase.startPhaseCountdown).toHaveBeenCalledWith(M, MatchPhase.LIVE_MAIN, 5, SRV);
    expect(await h.orch.isBothReady(M)).toBe(true);
    await h.orch.setReady(M, 'home', true);
    expect(h.phase.setReady).toHaveBeenCalledWith(M, 'home', true);
    await h.orch.resetReady(M);
    expect(h.phase.resetReady).toHaveBeenCalledWith(M);

    await h.orch.applyKnifeResult(M, 'CT');
    expect(h.state.applyKnifeResult).toHaveBeenCalledWith(M, 'CT');
    expect(await h.orch.getKnifeResult(M)).toEqual({ winner: 'CT' });
    await h.orch.roundEnd(M, 'T');
    expect(h.state.roundEnd).toHaveBeenCalledWith(M, 'T');
    expect(await h.orch.sideToLogical(M, 'CT')).toBe('home');
    expect(await h.orch.logicalToSide(M, 'home')).toBe('CT');

    await h.orch.setPhase(M, MatchPhase.LIVE_MAIN);
    expect(h.sides.setPhase).toHaveBeenCalledWith(M, MatchPhase.LIVE_MAIN);
    expect(await h.orch.getPhase(M)).toBe(MatchPhase.LIVE_MAIN);
  });

  it('sends raw commands, cfg files, warmup start and game restart through the agent', async () => {
    const h = setup();
    await h.orch.rcon({ serverId: SRV, matchId: M, command: 'say hi' });
    expect(h.cmds.rcon).toHaveBeenCalledWith({ serverId: SRV, matchId: M, command: 'say hi' });
    await h.orch.execCfg({ serverId: SRV, matchId: M }, 'knife.cfg');
    expect(h.cmds.exec).toHaveBeenCalledWith({ serverId: SRV, matchId: M, cfgName: 'knife.cfg' });
    await h.orch.startWarmup(SRV);
    expect(h.cmds.rcon).toHaveBeenLastCalledWith({ serverId: SRV, command: 'mp_warmup_start' });
    await h.orch.restartGame({ serverId: SRV, matchId: M, delay: 3 });
    expect(h.cmds.restartGame).toHaveBeenCalledWith({ serverId: SRV, matchId: M, delay: 3 });
  });

  it('pushes the state snapshot and any event to the websocket, with its audience', async () => {
    const h = setup();
    await h.orch.pushState(M);
    expect(h.ws.push).toHaveBeenCalledWith(M, 'match:state', expect.objectContaining({ matchId: M }));
    await h.orch.push(M, 'admin:alert', { a: 1 }, 'admin');
    expect(h.ws.push).toHaveBeenLastCalledWith(M, 'admin:alert', { a: 1 }, 'admin');
  });
});
