/**
 * EventsRouterSubscriber : the door of the Redis bus into the backend. What it listens to, what it throws away, how it
 * finds the match of a message that only names a server, where it sends a command and where it sends any other event,
 * and that the events of a match are handled one at a time, in the order they arrived.
 */
import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { EventsRouterSubscriber } from './events-router.consumer';
import { REDIS_CHANNELS } from '@app/match/state/redis.keys';

const M = 'm-1';

function setup(opts: { matchIdOfServer?: string | null | Error } = {}) {
  const sub = Object.assign(new EventEmitter(), {
    subscribe: jest.fn().mockResolvedValue(1),
    unsubscribe: jest.fn().mockResolvedValue(1),
  });
  const matchEvents = { handle: jest.fn().mockResolvedValue(undefined) };
  const chatCommands = { handle: jest.fn().mockResolvedValue(undefined) };
  const lookup = jest.fn();
  if (opts.matchIdOfServer instanceof Error) lookup.mockRejectedValue(opts.matchIdOfServer);
  else lookup.mockResolvedValue(opts.matchIdOfServer === undefined ? 'm-found' : opts.matchIdOfServer);
  const router = new EventsRouterSubscriber(sub as never, matchEvents as never, chatCommands as never, { getMatchIdFromServerId: lookup } as never);

  const deliver = (message: unknown) => {
    sub.emit('message', REDIS_CHANNELS.EVENTS, typeof message === 'string' ? message : JSON.stringify(message));
    return router.drain();
  };
  return { router, sub, matchEvents, chatCommands, lookup, deliver };
}

async function started(opts?: Parameters<typeof setup>[0]) {
  const ctx = setup(opts);
  await ctx.router.onModuleInit();
  return ctx;
}

describe('EventsRouterSubscriber : listening', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('subscribes to the events channel and handles what comes on it', async () => {
    const { sub, matchEvents, deliver } = await started();

    expect(sub.subscribe).toHaveBeenCalledWith(REDIS_CHANNELS.EVENTS);
    await deliver({ type: 'kill', matchId: M });

    expect(matchEvents.handle).toHaveBeenCalledTimes(1);
  });

  it('stops listening and unsubscribes when the module is destroyed', async () => {
    const { router, sub, matchEvents, deliver } = await started();

    await router.onModuleDestroy();
    await deliver({ type: 'kill', matchId: M });

    expect(sub.unsubscribe).toHaveBeenCalledWith(REDIS_CHANNELS.EVENTS);
    expect(matchEvents.handle).not.toHaveBeenCalled();
  });

  it('shuts down quietly when the unsubscribe fails (the connection is already gone)', async () => {
    const { router, sub } = await started();
    sub.unsubscribe.mockRejectedValue(new Error('connection closed'));

    await expect(router.onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('EventsRouterSubscriber : routing', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let debug: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends a chat command to the command handler, and nothing else', async () => {
    const { chatCommands, matchEvents, deliver } = await started();
    const command = { type: 'command', matchId: M, payload: { command: 'ready' } };

    await deliver(command);

    expect(chatCommands.handle).toHaveBeenCalledWith(command);
    expect(matchEvents.handle).not.toHaveBeenCalled();
  });

  it('sends any other event to the match events handler, and nothing else', async () => {
    const { chatCommands, matchEvents, deliver } = await started();
    const kill = { type: 'kill', matchId: M, payload: { weapon: 'ak47' } };

    await deliver(kill);

    expect(matchEvents.handle).toHaveBeenCalledWith(kill);
    expect(chatCommands.handle).not.toHaveBeenCalled();
  });

  it('drops a message that is not JSON, with a warning', async () => {
    const { matchEvents, chatCommands, deliver } = await started();

    await deliver('{broken');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
    expect(matchEvents.handle).not.toHaveBeenCalled();
    expect(chatCommands.handle).not.toHaveBeenCalled();
  });

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['a list', '[1,2]'],
    ['an object without a type', '{"matchId":"m-1"}'],
  ])('drops %s without a warning', async (_label, message) => {
    const { matchEvents, chatCommands, deliver } = await started();

    await deliver(message);

    expect(warn).not.toHaveBeenCalled();
    expect(matchEvents.handle).not.toHaveBeenCalled();
    expect(chatCommands.handle).not.toHaveBeenCalled();
  });

  it.each([
    ['telemetry', 'telemetry'],
    ['anything that is not primary', 'debug'],
  ])('ignores the %s flow', async (_label, kind) => {
    const { matchEvents, deliver } = await started();

    await deliver({ type: 'kill', matchId: M, kind });

    expect(matchEvents.handle).not.toHaveBeenCalled();
  });

  it('handles the primary flow, and a message that names no flow', async () => {
    const { matchEvents, deliver } = await started();

    await deliver({ type: 'kill', matchId: M, kind: 'primary' });
    await deliver({ type: 'kill', matchId: M });

    expect(matchEvents.handle).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['has none', undefined],
    ['is "unknown"', 'unknown'],
  ])('finds the match from the server when the message %s', async (_label, matchId) => {
    const { matchEvents, lookup, deliver } = await started({ matchIdOfServer: 'm-found' });

    await deliver({ type: 'kill', matchId, serverId: 'srv-a' });

    expect(lookup).toHaveBeenCalledWith('srv-a');
    expect(matchEvents.handle).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'm-found', serverId: 'srv-a' }));
  });

  it('does not look the match up when the message already names it', async () => {
    const { lookup, deliver } = await started();

    await deliver({ type: 'kill', matchId: M, serverId: 'srv-a' });

    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['no match is bound to the server', null],
    ['the lookup fails', new Error('redis down')],
  ])('drops a message without a match when %s', async (_label, matchIdOfServer) => {
    const { matchEvents, deliver } = await started({ matchIdOfServer });

    await deliver({ type: 'kill', serverId: 'srv-a' });

    expect(matchEvents.handle).not.toHaveBeenCalled();
  });

  it.each([
    ['neither a match nor a server', { type: 'kill' }],
    ['the placeholder "unknown" and no server to look it up from', { type: 'kill', matchId: 'unknown' }],
  ])('drops a message that has %s', async (_label, message) => {
    const { matchEvents, chatCommands, lookup, deliver } = await started();

    await deliver(message);

    expect(lookup).not.toHaveBeenCalled();
    expect(matchEvents.handle).not.toHaveBeenCalled();
    expect(chatCommands.handle).not.toHaveBeenCalled();
  });

  it('writes down every message it drops for want of a match, at debug level, with its type and its server', async () => {
    const { deliver } = await started({ matchIdOfServer: null });

    await deliver({ type: 'kill', matchId: 'unknown', serverId: 'srv-a' });
    await deliver({ type: 'chat_message' });

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('dropped kill: no match (server=srv-a)'));
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('dropped chat_message: no match (server=∅)'));
    expect(warn).not.toHaveBeenCalled(); // a server that is not in a match sends lines all the time: no warning each
  });

  it('does not write a drop down for a message that found its match', async () => {
    const { deliver } = await started();

    await deliver({ type: 'kill', matchId: M });

    expect(debug).not.toHaveBeenCalledWith(expect.stringContaining('dropped'));
  });

  it.each([
    ['a command', { type: 'command', matchId: M }, 'chatCommands'],
    ['an event', { type: 'kill', matchId: M }, 'matchEvents'],
  ] as const)('logs a failure of the handler for %s and keeps going', async (_label, message, which) => {
    const ctx = await started();
    ctx[which].handle.mockRejectedValueOnce(new Error('handler blew up'));

    await ctx.deliver(message);
    await ctx.deliver(message);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('handler blew up'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`type=${message.type} match=${M}`));
    expect(ctx[which].handle).toHaveBeenCalledTimes(2);
  });
});

describe('EventsRouterSubscriber : order', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('handles the events one at a time, in the order they arrived, even when an early one is slow', async () => {
    const { router, sub, matchEvents } = await started();
    const events: string[] = [];
    matchEvents.handle.mockImplementation(async (ev: { id: string }) => {
      events.push(`start ${ev.id}`);
      if (ev.id === 'slow') await new Promise((resolve) => setTimeout(resolve, 40));
      events.push(`end ${ev.id}`);
    });

    for (const id of ['slow', 'fast-1', 'fast-2']) {
      sub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify({ type: 'kill', matchId: M, id }));
    }
    await router.drain();

    expect(events).toEqual(['start slow', 'end slow', 'start fast-1', 'end fast-1', 'start fast-2', 'end fast-2']);
  });

  it('drain waits for the events that arrive while it is waiting', async () => {
    const { router, sub, matchEvents } = await started();
    const done: string[] = [];
    matchEvents.handle.mockImplementation(async (ev: { id: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done.push(ev.id);
    });

    sub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify({ type: 'kill', matchId: M, id: 'first' }));
    const drained = router.drain();
    sub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify({ type: 'kill', matchId: M, id: 'late' }));
    await drained;

    expect(done).toEqual(['first', 'late']);
  });

  it('drain answers at once when nothing is waiting', async () => {
    const { router } = await started();

    await expect(router.drain()).resolves.toBeUndefined();
  });
});
