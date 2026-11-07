import { MatchPhaseService } from './match-phase.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst, REDIS_CHANNELS } from '@app/match/state/redis.keys';
import { MatchPhase, RoundPhase } from '@domain/phase.types';
import { EventTypes } from '@domain/events/event.types';

const M = 'm-1';
const SRV = 'srv-a';

/** The countdown and the phase writes run against an in-memory Redis; the collaborators are recorded. */
function setup(opts: { paused?: boolean; rule?: { say?: () => Promise<unknown> } } = {}) {
  const redis = new FakeRedis();
  const published: Array<{ channel: string; msg: Record<string, any> }> = [];
  const pub = { publish: jest.fn((channel: string, raw: string) => { published.push({ channel, msg: JSON.parse(raw) }); return Promise.resolve(1); }) };
  const said: string[] = [];
  const actions = { say: jest.fn((_srv: string, text: string) => { said.push(text); return Promise.resolve(); }) };
  const pauseSvc = { isPaused: jest.fn().mockResolvedValue(opts.paused ?? false) };
  const messages = { stop: jest.fn(), stopPhaseGroups: jest.fn(), startPhase: jest.fn() };
  const registry = { getRule: jest.fn().mockReturnValue(opts.rule) };
  const rcF = { make: jest.fn().mockReturnValue({}) };
  const svc = new MatchPhaseService(redis as never, pub as never, actions as never, rcF as never, pauseSvc as never, messages as never, registry as never);
  const types = () => published.map((p) => p.msg.type);
  return { redis, svc, said, published, types, pauseSvc, messages, registry };
}

const tick = (ms = 1000) => jest.advanceTimersByTimeAsync(ms);

describe('MatchPhaseService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('countdown to a phase', () => {
    it('with no delay, applies the phase at once: phase written, flags and knife state reset, announced', async () => {
      const { svc, redis, said, types } = setup();
      await redis.hset(redisConst.ready(M), { home: '1', away: '1' });
      await redis.set(redisConst.knifeWinner(M), 'CT');
      await redis.set(redisConst.knifeChoice(M), 'stay');

      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 0, SRV);

      expect(await redis.get(redisConst.phase(M))).toBe(MatchPhase.LIVE_MAIN);
      expect(await svc.isBothReady(M)).toBe(false);
      expect(await redis.get(redisConst.knifeWinner(M))).toBeNull();
      expect(await redis.get(redisConst.knifeChoice(M))).toBeNull();
      expect(await svc.isCountdownActive(M)).toBe(false);
      expect(said).toContain(`➡️ Phase: ${MatchPhase.LIVE_MAIN}`);
      expect(types()).toEqual(['phase:countdown', EventTypes.PHASE_CHANGED]);
    });

    it('publishes only on the shared events channel', async () => {
      const { svc, published } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 0, SRV);
      expect(published.length).toBeGreaterThan(0);
      expect(published.every((p) => p.channel === REDIS_CHANNELS.EVENTS)).toBe(true);
    });

    it('counts down second by second, announces the last five seconds, then applies the phase', async () => {
      const { svc, redis, said, published } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 3, SRV);
      expect(await svc.isCountdownActive(M)).toBe(true);
      expect(await redis.get(redisConst.phasePending(M))).toBe(MatchPhase.LIVE_MAIN);
      expect(await redis.get(redisConst.phase(M))).toBeNull(); // not yet

      await tick(); await tick(); await tick();

      expect(said.filter((t) => t.startsWith('Début de'))).toEqual(['Début de live_main dans 3s…', 'Début de live_main dans 2s…', 'Début de live_main dans 1s…']);
      expect(published.filter((p) => p.msg.type === 'phase:countdown').map((p) => p.msg.payload.remain)).toEqual([3, 2, 1]);
      expect(await redis.get(redisConst.phase(M))).toBe(MatchPhase.LIVE_MAIN);
      expect(await svc.isCountdownActive(M)).toBe(false);
      expect(await redis.get(redisConst.phasePending(M))).toBeNull();
      expect(published.at(-1)?.msg).toMatchObject({ type: EventTypes.PHASE_CHANGED, payload: { newPhase: MatchPhase.LIVE_MAIN } });
    });

    it('does not announce every second of a long countdown (only 60, 30, 20, 10 and the last five)', async () => {
      const { svc, said } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 11, SRV);
      expect(said.filter((t) => t.startsWith('Début de'))).toEqual([]); // 11 s: nothing at the start
      await tick(); // 10 s
      expect(said.filter((t) => t.startsWith('Début de'))).toEqual(['Début de live_main dans 10s…']);
      await tick(); // 9 s: silent
      expect(said.filter((t) => t.startsWith('Début de'))).toHaveLength(1);
    });

    it('ignores a second countdown while one is running (no double announcement, no second timer)', async () => {
      const { svc, said } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 3, SRV);
      const before = said.length;
      await svc.startPhaseCountdown(M, MatchPhase.KNIFE_LIVE, 3, SRV);
      expect(said).toHaveLength(before);
    });

    it('starts the messages of the new phase when its rule has some', async () => {
      const spec = { id: 'x' };
      const { svc, messages } = setup({ rule: { say: () => Promise.resolve(spec) } });
      await svc.startPhaseCountdown(M, MatchPhase.WARMUP_MAIN, 0, SRV);
      expect(messages.stopPhaseGroups).toHaveBeenCalledWith(M); // sweep of the previous phase first
      expect(messages.startPhase).toHaveBeenCalledWith(M, MatchPhase.WARMUP_MAIN, SRV, spec);
    });
  });

  describe('cancelling', () => {
    it('stops a countdown when the game gets paused, keeping the target phase for later', async () => {
      const { svc, redis, pauseSvc, types } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 5, SRV);
      pauseSvc.isPaused.mockResolvedValue(true);

      await tick();

      expect(types().at(-1)).toBe('phase:cancelled');
      expect(await svc.isCountdownActive(M)).toBe(false);
      expect(await redis.get(redisConst.phasePending(M))).toBe(MatchPhase.LIVE_MAIN); // kept
      expect(await redis.get(redisConst.phase(M))).toBeNull();
      await tick(10_000); // no timer left: the phase is never applied by itself
      expect(await redis.get(redisConst.phase(M))).toBeNull();
    });

    it('stops a countdown whose lock disappeared (another process cancelled it), without keeping the target', async () => {
      const { svc, redis, types } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 5, SRV);
      await redis.del(redisConst.phaseLock(M));

      await tick();

      expect(types().at(-1)).toBe('phase:cancelled');
      expect(await redis.get(redisConst.phasePending(M))).toBeNull();
    });

    it('cancels on demand: timer, lock and target removed, messages of the target phase stopped, event published', async () => {
      const { svc, redis, messages, types } = setup();
      await svc.startPhaseCountdown(M, MatchPhase.LIVE_MAIN, 5, SRV);

      await svc.cancelPhaseCountdown(M, 'team_unready');

      expect(messages.stop).toHaveBeenCalledWith(M, MatchPhase.LIVE_MAIN);
      expect(await svc.isCountdownActive(M)).toBe(false);
      expect(await redis.get(redisConst.phasePending(M))).toBeNull();
      expect(types().at(-1)).toBe('phase:cancelled');
      await tick(10_000);
      expect(await redis.get(redisConst.phase(M))).toBeNull();
    });
  });

  describe('phase and ready flags', () => {
    it('reads the match phase (warmup_main by default) and the round phase (warmup by default)', async () => {
      const { svc } = setup();
      expect(await svc.getPhase(M)).toBe(MatchPhase.WARMUP_MAIN);
      expect(await svc.getRoundPhase(M)).toBe(RoundPhase.WARMUP);
      await svc.setRoundPhase(M, RoundPhase.FREEZE);
      expect(await svc.getRoundPhase(M)).toBe(RoundPhase.FREEZE);
    });

    it('setPhase writes the phase and clears the ready flags (a phase starts with nobody ready)', async () => {
      const { svc, redis } = setup();
      await svc.setReady(M, 'home', true);
      await svc.setReady(M, 'away', true);
      expect(await svc.isBothReady(M)).toBe(true);
      await svc.setPhase(M, MatchPhase.KNIFE_LIVE);
      expect(await redis.get(redisConst.phase(M))).toBe(MatchPhase.KNIFE_LIVE);
      expect(await svc.isBothReady(M)).toBe(false);
    });

    it('needs both teams ready, and a team can take it back', async () => {
      const { svc } = setup();
      await svc.setReady(M, 'home', true);
      expect(await svc.isBothReady(M)).toBe(false);
      await svc.setReady(M, 'away', true);
      expect(await svc.isBothReady(M)).toBe(true);
      await svc.setReady(M, 'home', false);
      expect(await svc.isBothReady(M)).toBe(false);
    });

    it('never goes from the knife back to the warmup, any other transition is allowed', () => {
      const { svc } = setup();
      expect(svc.canTransition(MatchPhase.KNIFE_LIVE, MatchPhase.WARMUP_MAIN)).toBe(false);
      expect(svc.canTransition(MatchPhase.WARMUP_MAIN, MatchPhase.KNIFE_LIVE)).toBe(true);
      expect(svc.canTransition(MatchPhase.LIVE_MAIN, MatchPhase.HALFTIME)).toBe(true);
    });
  });
});
