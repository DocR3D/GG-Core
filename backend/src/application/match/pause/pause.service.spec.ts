import { PauseMatchService } from './pause.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst } from '@app/match/state/redis.keys';
import { DEFAULT_TAC_BANK_SEC } from '@domain/rules/rules.constants';

const M = 'm-1';
const SRV = 'srv-a';

/** The service against a real (in-memory) Redis: what the tests check is the state it leaves behind. */
function setup() {
  const redis = new FakeRedis();
  const messenger = { schedule: jest.fn(), cancel: jest.fn() };
  const svc = new PauseMatchService(redis as never, messenger as never);
  const state = () => redis.hgetall(redisConst.pause(M));
  return { redis, messenger, svc, state };
}

describe('PauseMatchService', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-07T10:00:00Z')));
  afterEach(() => jest.useRealTimers());

  describe('tactical banks', () => {
    it('starts every team with the default bank and reads it back', async () => {
      const { svc } = setup();
      expect(await svc.getTacBank(M, 'home')).toBe(DEFAULT_TAC_BANK_SEC); // nothing stored: the default
      await svc.initTacBanks(M, 90);
      expect(await svc.getTacBank(M, 'home')).toBe(90);
      expect(await svc.getTacBank(M, 'away')).toBe(90);
    });

    it('allows a tactical pause while the bank lasts, refuses it when empty, never limits technical / admin ones', async () => {
      const { svc } = setup();
      await svc.initTacBanks(M, 0);
      expect(await svc.isPauseAllowed(M, { reason: 'tactical', team: 'home' })).toMatchObject({ allowed: false, why: 'no_bank' });
      expect(await svc.isPauseAllowed(M, { reason: 'technical', team: 'home' })).toMatchObject({ allowed: true });
      expect(await svc.isPauseAllowed(M, { reason: 'admin' })).toMatchObject({ allowed: true });
      await svc.initTacBanks(M, 45);
      expect(await svc.isPauseAllowed(M, { reason: 'tactical', team: 'away' })).toMatchObject({ allowed: true, remainingSec: 45 });
    });

    it('refuses any pause while one is running, and a tactical one without a team', async () => {
      const { svc } = setup();
      expect(await svc.isPauseAllowed(M, { reason: 'tactical' })).toMatchObject({ allowed: false, why: 'unknown_reason' });
      await svc.pause(M, SRV, { reason: 'technical', team: 'home' });
      expect(await svc.isPauseAllowed(M, { reason: 'tactical', team: 'away' })).toMatchObject({ allowed: false, why: 'already_paused' });
    });
  });

  describe('starting a pause', () => {
    it('stores the state and starts the periodic reminder of its kind (none for an admin pause)', async () => {
      const { svc, messenger, state } = setup();
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home', durationSec: 30 });
      expect(await svc.isPaused(M)).toBe(true);
      expect(await state()).toMatchObject({ state: 'paused', reason: 'tactical', team: 'home' });
      expect(messenger.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: `pause:tac:${M}`, serverId: SRV, intervalMs: 15_000 }));

      messenger.schedule.mockClear();
      await svc.resume(M);
      await svc.pause(M, SRV, { reason: 'technical', customReason: 'souris' });
      expect(await svc.getPauseState(M)).toMatchObject({ state: 'paused', reason: 'technical', team: 'system', customReason: 'souris' });
      expect(messenger.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: `pause:tec:${M}`, intervalMs: 30_000 }));

      messenger.schedule.mockClear();
      await svc.resume(M);
      await svc.pause(M, SRV, { reason: 'admin' });
      expect(messenger.schedule).not.toHaveBeenCalled();
    });

    it('a pause that replaces a running tactical one first charges the bank for the time already spent', async () => {
      const { svc, messenger } = setup();
      await svc.initTacBanks(M, 120);
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home' });
      jest.advanceTimersByTime(25_000);

      await svc.pause(M, SRV, { reason: 'technical', team: 'system' }); // e.g. a round restore proposal

      expect(await svc.getTacBank(M, 'home')).toBe(95);
      expect(messenger.cancel).toHaveBeenCalledWith(`pause:tac:${M}`, `lock:periodic:pause:tac:${M}`);
      expect(await svc.getPauseState(M)).toMatchObject({ state: 'paused', reason: 'technical', team: 'system' });
    });
  });

  describe('arming a pause for the next freeze time', () => {
    it('keeps the request without pausing, one slot per team', async () => {
      const { svc, messenger, state } = setup();
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home', armOnly: true, by: { steamId: 'S1', name: 'Alice', source: 'chat' } });
      await svc.pause(M, SRV, { reason: 'tactical', team: 'away', armOnly: true });
      await svc.pause(M, SRV, { reason: 'technical', armOnly: true });

      expect(await svc.isPaused(M)).toBe(false);
      expect(messenger.schedule).not.toHaveBeenCalled();
      expect(Object.keys(await state()).sort()).toEqual(['arm_away_json', 'arm_home_json', 'arm_system_json']);
      expect(JSON.parse((await state()).arm_home_json).by).toMatchObject({ steamId: 'S1', name: 'Alice', source: 'chat' });
    });

    it('keeps the FIRST request of a team when it asks again (a second one is dropped, not queued)', async () => {
      const { svc, state } = setup();
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home', armOnly: true });
      await svc.pause(M, SRV, { reason: 'technical', team: 'home', armOnly: true, customReason: 'second' });
      expect(JSON.parse((await state()).arm_home_json)).toMatchObject({ reason: 'tactical' });
    });

    it('consumes the OLDEST request, removes only that slot, and does not start the pause itself', async () => {
      const { svc, state } = setup();
      await svc.pause(M, SRV, { reason: 'technical', team: 'away', armOnly: true });
      jest.advanceTimersByTime(5_000);
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home', armOnly: true });

      const first = await svc.consumeArmed(M);
      expect(first.consumed).toBe(true);
      expect(first.pick).toMatchObject({ team: 'away', req: { reason: 'technical' } });
      expect(Object.keys(await state())).toEqual(['arm_home_json']);
      expect(await svc.isPaused(M)).toBe(false);

      expect((await svc.consumeArmed(M)).pick?.team).toBe('home');
      expect(await svc.consumeArmed(M)).toEqual({ consumed: false });
    });

    it('does not consume a request while the game is already paused (it would be lost)', async () => {
      const { svc, state } = setup();
      await svc.pause(M, SRV, { reason: 'tactical', team: 'home', armOnly: true });
      await svc.pause(M, SRV, { reason: 'admin', team: 'system' });
      expect(await svc.consumeArmed(M)).toEqual({ consumed: false });
      expect(Object.keys(await state())).toContain('arm_home_json');
    });

    it('survives a damaged request instead of throwing', async () => {
      const { svc, redis } = setup();
      await redis.hset(redisConst.pause(M), 'arm_home_json', '{not json');
      expect(await svc.consumeArmed(M)).toEqual({ consumed: false });
    });
  });

  describe('resuming', () => {
    it('does nothing when the game is not paused', async () => {
      const { svc, messenger } = setup();
      await svc.resume(M);
      expect(messenger.cancel).not.toHaveBeenCalled();
    });

    it('charges a tactical pause to the bank of its team, by the time really spent, never below 0', async () => {
      const { svc } = setup();
      await svc.initTacBanks(M, 120);
      await svc.pause(M, SRV, { reason: 'tactical', team: 'away' });
      jest.advanceTimersByTime(40_500);
      await svc.resume(M);
      expect(await svc.getTacBank(M, 'away')).toBe(80);
      expect(await svc.getTacBank(M, 'home')).toBe(120);

      await svc.pause(M, SRV, { reason: 'tactical', team: 'away' });
      jest.advanceTimersByTime(500_000);
      await svc.resume(M);
      expect(await svc.getTacBank(M, 'away')).toBe(0);
    });

    it('does not charge a technical pause, stops its reminder and clears the state and the votes', async () => {
      const { svc, messenger, state } = setup();
      await svc.initTacBanks(M, 120);
      await svc.pause(M, SRV, { reason: 'technical', team: 'home', customReason: 'x' });
      await svc.voteUnpause(M, 'home');
      jest.advanceTimersByTime(60_000);

      await svc.resume(M);

      expect(await svc.getTacBank(M, 'home')).toBe(120);
      expect(messenger.cancel).toHaveBeenCalledWith(`pause:tec:${M}`, `lock:periodic:pause:tec:${M}`);
      expect(await svc.isPaused(M)).toBe(false);
      expect(await svc.getPauseState(M)).toMatchObject({ state: 'none', unpauseHome: false, unpauseAway: false });
      expect((await state()).custom_reason).toBe('');
    });
  });

  describe('mutual unpause', () => {
    it('needs both teams, in any order, and a new pause starts again from zero votes', async () => {
      const { svc } = setup();
      await svc.pause(M, SRV, { reason: 'technical', team: 'system' });
      expect(await svc.voteUnpause(M, 'away')).toEqual({ bothReady: false, homeReady: false, awayReady: true });
      expect(await svc.voteUnpause(M, 'away')).toMatchObject({ bothReady: false });
      expect(await svc.voteUnpause(M, 'home')).toEqual({ bothReady: true, homeReady: true, awayReady: true });

      await svc.resume(M);
      await svc.pause(M, SRV, { reason: 'technical', team: 'system' });
      expect(await svc.voteUnpause(M, 'home')).toMatchObject({ bothReady: false, awayReady: false });
    });
  });

  describe('reading the state', () => {
    it('reads "none" for a match that never paused, and the round phase only when it is a known one', async () => {
      const { svc, redis } = setup();
      expect(await svc.getPauseState(M)).toMatchObject({ state: 'none', unpauseHome: false });
      expect(await svc.getPhase(M)).toBeNull();
      for (const phase of ['live', 'bomb_planted', 'freeze', 'end'] as const) {
        await redis.set(redisConst.roundPhase(M), phase);
        expect(await svc.getPhase(M)).toBe(phase);
      }
      await redis.set(redisConst.roundPhase(M), 'warmup');
      expect(await svc.getPhase(M)).toBeNull();
    });
  });
});
