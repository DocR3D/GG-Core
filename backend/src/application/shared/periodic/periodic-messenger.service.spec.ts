/**
 * PeriodicMessenger : a message said again and again in the chat of a server (the pause countdown). What it does at each
 * tick: take a lock so that two backends do not say it twice, ask what to say, say it, let the lock go. And how a message
 * stops: the text asks for it, or somebody cancels it.
 */
import { Logger } from '@nestjs/common';
import { PeriodicMessenger, fmtMmSs, type MessageSpec } from './periodic-messenger.service';
import { PeriodicScheduler } from './periodic-scheduler.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { MatchCommandsService } from '@app/commands/match-commands.service';

const SERVER = 'srv-a';

function setup() {
  const redis = new FakeRedis();
  // The real scheduler on a fake clock: the first tick runs at once, the next ones every interval.
  const scheduler = new PeriodicScheduler();
  const commands = { say: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = { get: jest.fn((token: unknown) => (token === MatchCommandsService ? commands : undefined)) };
  const messenger = new PeriodicMessenger(scheduler, moduleRef as never, redis as never);
  messenger.onModuleInit();
  return { messenger, scheduler, redis, commands, moduleRef };
}

function spec(over: Partial<MessageSpec> = {}): MessageSpec {
  return { id: 'pause:m-1', intervalMs: 10_000, serverId: SERVER, compute: async () => ({ text: 'tick' }), ...over };
}

/** Lets the first tick (planned for "now") and everything it awaits run. */
const firstTick = () => jest.advanceTimersByTimeAsync(0);

describe('PeriodicMessenger', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('finds the commands service when the module starts, not before (they depend on each other)', () => {
    const { moduleRef } = setup();

    expect(moduleRef.get).toHaveBeenCalledWith(MatchCommandsService, { strict: false });
  });

  it('says what the message computes to the server, at once and then every interval', async () => {
    const { messenger, scheduler, commands } = setup();
    let n = 0;

    messenger.schedule(spec({ compute: async () => ({ text: `tick ${++n}` }) }));
    await firstTick();
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(commands.say.mock.calls).toEqual([[SERVER, 'tick 1'], [SERVER, 'tick 2'], [SERVER, 'tick 3']]);
    scheduler.onModuleDestroy();
  });

  it('stops when the message says so, and does not say anything that tick', async () => {
    const { messenger, commands, scheduler } = setup();
    let n = 0;

    messenger.schedule(spec({ compute: async () => (++n < 2 ? { text: 'more' } : { stop: true }) }));
    await firstTick();
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(commands.say).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
    scheduler.onModuleDestroy();
  });

  it('cancel stops the message', async () => {
    const { messenger, commands } = setup();

    messenger.schedule(spec());
    await firstTick();
    messenger.cancel('pause:m-1');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(commands.say).toHaveBeenCalledTimes(1);
  });

  it('cancel also lets go of the lock it was given', async () => {
    const { messenger, redis } = setup();
    redis.strings.set('lock:pause', 'x');

    messenger.cancel('pause:m-1', 'lock:pause');

    await Promise.resolve();
    expect(redis.strings.has('lock:pause')).toBe(false);
  });

  it('a message that fails to compute is logged and tried again at the next tick', async () => {
    const { messenger, commands, scheduler } = setup();
    const compute = jest.fn().mockRejectedValueOnce(new Error('no pause state')).mockResolvedValue({ text: 'back' });

    messenger.schedule(spec({ compute }));
    await firstTick();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('no pause state'), expect.anything());
    expect(commands.say).toHaveBeenCalledWith(SERVER, 'back');
    scheduler.onModuleDestroy();
  });

  it('a server that does not answer is logged and does not stop the message', async () => {
    const { messenger, commands, scheduler } = setup();
    commands.say.mockRejectedValueOnce(new Error('rcon down'));

    messenger.schedule(spec());
    await firstTick();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('rcon down'), expect.anything());
    expect(commands.say).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
  });

  describe('with a lock', () => {
    const LOCK = 'lock:pause:m-1';

    it('takes the lock for the tick, with a lifetime of half the interval and at least 5 seconds, and lets it go after', async () => {
      const { messenger, redis, scheduler } = setup();
      const set = jest.spyOn(redis, 'set');
      const seenDuringCompute: Array<string | null> = [];

      messenger.schedule(spec({ lockKey: LOCK, intervalMs: 60_000, compute: async () => (seenDuringCompute.push(await redis.get(LOCK)), { text: 'x' }) }));
      await firstTick();

      expect(set).toHaveBeenCalledWith(LOCK, expect.any(String), 'EX', 30, 'NX');
      expect(seenDuringCompute[0]).not.toBeNull();
      expect(redis.strings.has(LOCK)).toBe(false);
      scheduler.onModuleDestroy();
    });

    it('never asks for a lock shorter than 5 seconds', async () => {
      const { messenger, redis, scheduler } = setup();
      const set = jest.spyOn(redis, 'set');

      messenger.schedule(spec({ lockKey: LOCK, intervalMs: 2000 }));
      await firstTick();

      expect(set).toHaveBeenCalledWith(LOCK, expect.any(String), 'EX', 5, 'NX');
      scheduler.onModuleDestroy();
    });

    it('skips the tick, and does not touch the lock, when another backend holds it', async () => {
      const { messenger, redis, commands, scheduler } = setup();
      redis.strings.set(LOCK, 'other');
      const compute = jest.fn().mockResolvedValue({ text: 'x' });

      messenger.schedule(spec({ lockKey: LOCK, compute }));
      await firstTick();

      expect(compute).not.toHaveBeenCalled();
      expect(commands.say).not.toHaveBeenCalled();
      expect(redis.strings.get(LOCK)).toBe('other');
      scheduler.onModuleDestroy();
    });

    it('skips the tick when the lock cannot be asked for', async () => {
      const { messenger, redis, commands, scheduler } = setup();
      jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis down'));

      messenger.schedule(spec({ lockKey: LOCK }));
      await firstTick();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('redis down'));
      expect(commands.say).not.toHaveBeenCalled();
      scheduler.onModuleDestroy();
    });

    it('lets the lock go when the message asks to stop, and when computing fails', async () => {
      const { messenger, redis, scheduler } = setup();

      messenger.schedule(spec({ id: 'a', lockKey: LOCK, compute: async () => ({ stop: true }) }));
      await firstTick();
      expect(redis.strings.has(LOCK)).toBe(false);

      messenger.schedule(spec({ id: 'b', lockKey: LOCK, compute: () => Promise.reject(new Error('boom')) }));
      await jest.advanceTimersByTimeAsync(0);
      expect(redis.strings.has(LOCK)).toBe(false);
      scheduler.onModuleDestroy();
    });

    it('a lock that cannot be released is only a warning', async () => {
      const { messenger, redis, scheduler } = setup();
      jest.spyOn(redis, 'del').mockRejectedValue(new Error('redis down'));

      messenger.schedule(spec({ lockKey: LOCK }));
      await firstTick();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('release failed'));
      scheduler.onModuleDestroy();
    });
  });
});

describe('fmtMmSs', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [125, '2:05'],
    [600, '10:00'],
  ])('%s seconds read %s', (seconds, text) => {
    expect(fmtMmSs(seconds)).toBe(text);
  });
});
