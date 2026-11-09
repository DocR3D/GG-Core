/**
 * WsBroadcaster : what it does with each message of the Redis bus before it reaches a screen. (The anti-double-delivery
 * of both / public / admin is in broadcaster.service.spec.ts.) Here: what is ignored, how the match is found when the
 * message only names a server, how a bus type becomes a WebSocket event and for whom, and the chat and command payloads.
 */
import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { WsBroadcaster } from './broadcaster.service';
import { REDIS_CHANNELS } from '@app/match/state/redis.keys';

const M = 'm-1';

function setup(opts: { matchIdOfServer?: string | null | Error; seq?: number } = {}) {
  const sub = Object.assign(new EventEmitter(), { subscribe: jest.fn().mockResolvedValue('OK') });
  const emitter = { emitBoth: jest.fn(), emitPublic: jest.fn(), emitAdmin: jest.fn() };
  const seq = { next: jest.fn().mockResolvedValue(opts.seq ?? 7) };
  const lookup = jest.fn();
  if (opts.matchIdOfServer instanceof Error) lookup.mockRejectedValue(opts.matchIdOfServer);
  else lookup.mockResolvedValue(opts.matchIdOfServer === undefined ? M : opts.matchIdOfServer);
  const matchState = { getMatchIdFromServerId: lookup };
  const broadcaster = new WsBroadcaster(sub as never, emitter as never, seq as never, matchState as never);

  /** Sends one message on the bus and waits for the broadcaster to be done with it. */
  const deliver = async (message: unknown) => {
    sub.emit('message', REDIS_CHANNELS.EVENTS, typeof message === 'string' ? message : JSON.stringify(message));
    await new Promise((resolve) => setImmediate(resolve));
  };
  const sent = () => [...emitter.emitBoth.mock.calls, ...emitter.emitPublic.mock.calls, ...emitter.emitAdmin.mock.calls];
  return { broadcaster, sub, emitter, seq, lookup, deliver, sent };
}

async function started(opts?: Parameters<typeof setup>[0]) {
  const ctx = setup(opts);
  await ctx.broadcaster.onModuleInit();
  return ctx;
}

describe('WsBroadcaster : what is ignored', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('drops a message that is not JSON, with a warning', async () => {
    const { deliver, sent } = await started();

    await deliver('{not json');

    expect(sent()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });

  it.each([
    ['an agent heartbeat (rcon)', { rcon: { ok: true } }],
    ['an agent heartbeat (logs)', { logs: { ok: true } }],
    ['a message with neither a type nor a name', { matchId: M, payload: {} }],
  ])('drops %s without a warning', async (_label, message) => {
    const { deliver, sent, seq } = await started();

    await deliver(message);

    expect(sent()).toEqual([]);
    expect(seq.next).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops a type it does not know, and says which', async () => {
    const { deliver, sent } = await started();

    await deliver({ type: 'mystery_event', matchId: M });

    expect(sent()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mystery_event'));
  });

  it.each(['round_freeze_start', 'match_start'])('drops "%s" quietly: only the backend consumes it', async (type) => {
    const { deliver, sent } = await started();

    await deliver({ type, matchId: M });

    expect(sent()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['GRENADE_LAND', 'SFUI_TARGET_BOMBED'])('says nothing to the screens for %s, which has no WebSocket event', async (name) => {
    const { deliver, sent } = await started();

    await deliver({ name, matchId: M, audience: 'both' });

    expect(sent()).toEqual([]);
  });

  it('warns about an internal event name nobody handles', async () => {
    const { deliver, sent } = await started();

    await deliver({ name: 'NOT_A_REAL_EVENT', matchId: M });

    expect(sent()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT_A_REAL_EVENT'));
  });

  it('keeps listening when sending fails: the failure is logged, the next message goes through', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { deliver, emitter } = await started();
    emitter.emitBoth.mockImplementationOnce(() => {
      throw new Error('socket gone');
    });

    await deliver({ type: 'kill', matchId: M, payload: {} });
    await deliver({ type: 'kill', matchId: M, payload: {} });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('socket gone'));
    expect(emitter.emitBoth).toHaveBeenCalledTimes(2);
  });
});

describe('WsBroadcaster : finding the match of a message', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['has none', undefined],
    ['is "unknown"', 'unknown'],
  ])('asks which match a server plays when the message %s', async (_label, matchId) => {
    const { deliver, lookup, emitter } = await started({ matchIdOfServer: 'm-found' });

    await deliver({ type: 'kill', matchId, serverId: 'srv-a', payload: {} });

    expect(lookup).toHaveBeenCalledWith('srv-a');
    expect(emitter.emitBoth).toHaveBeenCalledWith('m-found', 'kill', expect.objectContaining({ matchId: 'm-found', serverId: 'srv-a' }));
  });

  it('does not ask when the message already names its match', async () => {
    const { deliver, lookup } = await started();

    await deliver({ type: 'kill', matchId: M, serverId: 'srv-a', payload: {} });

    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['no server is bound to a match', null],
    ['the lookup fails', new Error('redis down')],
  ])('sends it out as "unknown" when %s', async (_label, matchIdOfServer) => {
    const { deliver, emitter } = await started({ matchIdOfServer });

    await deliver({ type: 'kill', serverId: 'srv-a', payload: {} });

    expect(emitter.emitBoth).toHaveBeenCalledWith('unknown', 'kill', expect.objectContaining({ matchId: 'unknown' }));
  });

  it.each(['', '   '])('does not look up a blank server id (%j)', async (serverId) => {
    const { deliver, lookup, emitter } = await started();

    await deliver({ type: 'kill', serverId, payload: {} });

    expect(lookup).not.toHaveBeenCalled();
    expect(emitter.emitBoth).toHaveBeenCalledWith('unknown', 'kill', expect.anything());
  });
});

describe('WsBroadcaster : from a bus type to a WebSocket event', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // [bus type, event the screens get]
  const toBoth: Array<[string, string]> = [
    ['round_start', 'round:start'],
    ['round_end', 'round:end'],
    ['score_update', 'score:update'],
    ['pause_update', 'pause:update'],
    ['sides_swapped', 'sides:swapped'],
    ['match_state', 'match:state'],
    ['kill', 'kill'],
    ['assist', 'assist'],
    ['team_round_win', 'team_round_win'],
    ['bomb_planted', 'bomb:planted'],
    ['bomb_defused', 'bomb_defused'],
    ['begin_bomb_plant', 'bomb:begin'],
    ['defuse_begin', 'defuse:begin'],
    ['defuse_abort', 'defuse:abort'],
    ['match_paused', 'pause:update'],
    ['match_unpaused', 'pause:update'],
    ['grenade_throw', 'grenade_throw'],
    ['player_blinded', 'player_blinded'],
    ['player_connected', 'player:connected'],
    ['player_disconnected', 'player:disconnected'],
    ['player_name_change', 'player:name_change'],
    ['item_purchase', 'item:purchase'],
    ['phase_countdown', 'phase:countdown'],
    ['phase:countdown', 'phase:countdown'],
    ['phase_changed', 'phase:changed'],
    ['phase:changed', 'phase:changed'],
    ['phase_cancelled', 'phase:cancelled'],
    ['phase:cancelled', 'phase:cancelled'],
  ];

  it.each(toBoth)('"%s" reaches the public and the admins as "%s"', async (type, wsEvent) => {
    const { deliver, emitter } = await started();

    await deliver({ type, matchId: M, serverId: 'srv-a', payload: { x: 1 } });

    expect(emitter.emitBoth).toHaveBeenCalledTimes(1);
    expect(emitter.emitBoth).toHaveBeenCalledWith(M, wsEvent, expect.objectContaining({ matchId: M }));
    expect(emitter.emitPublic).not.toHaveBeenCalled();
    expect(emitter.emitAdmin).not.toHaveBeenCalled();
  });

  const adminOnly: Array<[string, string]> = [
    ['agent:action', 'agent:action'],
    ['agent:result', 'agent:result'],
    ['log:raw', 'log:raw'],
  ];

  it.each(adminOnly)('"%s" is for the admins only', async (type, wsEvent) => {
    const { deliver, emitter } = await started();

    await deliver({ type, matchId: M, payload: {} });

    expect(emitter.emitAdmin).toHaveBeenCalledWith(M, wsEvent, expect.anything());
    expect(emitter.emitBoth).not.toHaveBeenCalled();
    expect(emitter.emitPublic).not.toHaveBeenCalled();
  });

  it('turns both spellings of a landing grenade into the same silent event', async () => {
    const { deliver, sent } = await started();

    await deliver({ type: 'grenade_land', matchId: M });
    await deliver({ type: 'grenade_landed', matchId: M });

    expect(sent()).toEqual([]);
  });

  it('lets the sender choose the audience, the kind and the source', async () => {
    const { deliver, emitter } = await started();

    await deliver({ type: 'kill', matchId: M, audience: 'public', source: 'api', kind: 'telemetry', id: 'ev-9', payload: { w: 'ak47' } });

    expect(emitter.emitPublic).toHaveBeenCalledWith(
      M,
      'kill',
      expect.objectContaining({ id: 'ev-9', source: 'api', kind: 'telemetry', audience: 'public', payload: { w: 'ak47' } }),
    );
  });

  it('fills in the version, the source and the kind when the message does not give them', async () => {
    const { deliver, emitter } = await started();

    await deliver({ type: 'kill', matchId: M, timestamp: 1234, payload: {} });

    expect(emitter.emitBoth).toHaveBeenCalledWith(M, 'kill', expect.objectContaining({ v: 1, source: 'agent', kind: 'primary', ts: 1234 }));
  });

  it('wraps the pause that the agent reports with its state', async () => {
    const { deliver, emitter } = await started({ seq: 12 });

    await deliver({ type: 'match_paused', matchId: M });
    await deliver({ type: 'match_unpaused', matchId: M });

    expect(emitter.emitBoth.mock.calls.map((c) => c[2])).toEqual([
      expect.objectContaining({ type: 'pause:update', matchId: M, seq: 12, payload: { state: 'paused' } }),
      expect.objectContaining({ type: 'pause:update', matchId: M, seq: 12, payload: { state: 'unpaused' } }),
    ]);
  });
});

describe('WsBroadcaster : an event that is already internal', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['CHAT_PUBLIC', 'CHAT_ADMIN', 'COMMAND', 'AGENT_ACTION', 'AGENT_RESULT', 'LOG_RAW'])(
    '%s is for the admins when it names no audience',
    async (name) => {
      const { deliver, emitter } = await started();

      await deliver({ name, matchId: M, payload: { command: 'x', sender: { name: 'n', steamId: null, team: 'CT' }, message: 'm', player: { name: 'n', steamId: null, team: 'CT' } } });

      expect(emitter.emitBoth).not.toHaveBeenCalled();
      expect(emitter.emitPublic).not.toHaveBeenCalled();
    },
  );

  it('is for everybody when it names no audience and is not one of those', async () => {
    const { deliver, emitter } = await started();

    await deliver({ name: 'KILL', matchId: M, payload: {} });

    expect(emitter.emitBoth).toHaveBeenCalledWith(M, 'kill', expect.anything());
  });

  it('keeps its own order number, and numbers the others from the match counter', async () => {
    const { deliver, emitter, seq } = await started({ seq: 40 });

    await deliver({ name: 'KILL', matchId: M, seq: 3, payload: {} });
    await deliver({ name: 'KILL', matchId: M, payload: {} });

    expect(seq.next).toHaveBeenCalledTimes(1);
    expect(seq.next).toHaveBeenCalledWith(M);
    expect(emitter.emitBoth.mock.calls.map((c) => (c[2] as { seq: number }).seq)).toEqual([3, 40]);
  });

  it('takes its time from the message, then from the clock', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }).setSystemTime(5000);
    const { deliver, emitter } = await started();

    await deliver({ name: 'KILL', matchId: M, timestamp: 99 });
    await deliver({ name: 'KILL', matchId: M });

    expect(emitter.emitBoth.mock.calls.map((c) => (c[2] as { ts: number }).ts)).toEqual([99, 5000]);
  });
});

describe('WsBroadcaster : chat and commands, for the admins', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['CT', 'CT'],
    ['T', 'T'],
    ['TERRORIST', 'T'],
    ['SPECTATOR', 'spec'],
    ['Unassigned', 'spec'],
  ])('a chat line from a player on "%s" shows his team as "%s", with the text, the channel and his name', async (team, shown) => {
    const { deliver, emitter } = await started({ seq: 5 });

    await deliver({ type: 'chat_message', matchId: M, payload: { channel: 'say_team', message: 'rush B', player: { name: 'Garitos', steamId: '[U:1:1]', team } } });

    expect(emitter.emitAdmin).toHaveBeenCalledWith(M, 'chat:public', {
      type: 'chat:public',
      matchId: M,
      seq: 5,
      ts: expect.any(Number),
      payload: { text: 'rush B', channel: 'say_team', player: { name: 'Garitos', steamId: '[U:1:1]', team: shown } },
    });
  });

  it('a chat line from a player without a Steam id leaves the Steam id out', async () => {
    const { deliver, emitter } = await started();

    await deliver({ type: 'chat_message', matchId: M, payload: { channel: 'say', message: 'hi', player: { name: 'Bot', steamId: null, team: 'CT' } } });

    expect((emitter.emitAdmin.mock.calls[0][2] as { payload: { player: object } }).payload.player).toEqual({ name: 'Bot', steamId: undefined, team: 'CT' });
  });

  it('a command shows who typed it, from which team and on which channel', async () => {
    const { deliver, emitter } = await started({ seq: 6 });

    await deliver({
      type: 'command',
      matchId: M,
      payload: { command: 'pause', parameters: ['crash'], sender: { name: 'Garitos', steamId: '[U:1:1]', team: 'TERRORIST', channel: 'say' } },
    });

    expect(emitter.emitAdmin).toHaveBeenCalledWith(M, 'command', {
      type: 'command',
      matchId: M,
      seq: 6,
      ts: expect.any(Number),
      payload: { command: 'pause', parameters: ['crash'], sender: { name: 'Garitos', steamId: '[U:1:1]', team: 'T', channel: 'say' } },
    });
  });

  it.each(['chat_message', 'command'])('"%s" is never sent to the public, even when the message asks for it', async (type) => {
    const { deliver, sent } = await started();

    await deliver({
      type,
      matchId: M,
      audience: 'public',
      payload: { channel: 'say', message: 'secret', player: { name: 'n', steamId: null, team: 'CT' }, command: 'x', parameters: [], sender: { name: 'n', steamId: null, team: 'CT', channel: 'say' } },
    });

    expect(sent()).toEqual([]);
  });
});
