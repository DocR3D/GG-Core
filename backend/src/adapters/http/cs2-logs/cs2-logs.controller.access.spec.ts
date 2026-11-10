/**
 * Cs2LogsController : who may post game events, and how the server and the match of an event are found. (How the body is
 * read - array, { events }, one event, NDJSON, not JSON - is in cs2-logs.controller.spec.ts.)
 *
 * Written down as the code is today, so that a change is a choice:
 * - the token is checked ONLY when CS2_TOKEN is set (it is not in the compose). The Go agent does not use this route (it
 *   writes to Redis), so nothing needs it open: it could be closed from the backend alone;
 * - the address allow-list is read from ALLOWED_IPS, and the address is the FIRST value of the X-Forwarded-For header
 *   when the request has one: a client can write that header itself.
 */
import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { Cs2LogsController } from './cs2-logs.controller';

const ENV = { ...process.env };

type Req = { header?: string; token?: string; contentType?: string; ip?: string; forwarded?: string };

function request(over: Req = {}) {
  return {
    header: (name: string) => (name.toLowerCase() === 'x-cs2-token' ? over.header : undefined),
    query: over.token === undefined ? {} : { token: over.token },
    headers: { 'content-type': over.contentType ?? 'application/json', ...(over.forwarded ? { 'x-forwarded-for': over.forwarded } : {}) },
    ip: over.ip ?? '10.0.0.5',
  } as never;
}

function setup(env: NodeJS.ProcessEnv = {}, matchIdOfServer: string | null | Error = 'm-1') {
  process.env = { ...ENV, ...env };
  delete process.env.CS2_TOKEN;
  delete process.env.ALLOWED_IPS;
  Object.assign(process.env, env);
  const svc = { handleEvents: jest.fn().mockResolvedValue(undefined) };
  const lookup = jest.fn();
  if (matchIdOfServer instanceof Error) lookup.mockRejectedValue(matchIdOfServer);
  else lookup.mockResolvedValue(matchIdOfServer);
  const controller = new Cs2LogsController(svc as never, { getMatchIdFromServerId: lookup } as never);
  return { controller, svc, lookup };
}

const one = JSON.stringify({ type: 'kill', payload: {} });

describe('Cs2LogsController : the token', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined));
  afterEach(() => {
    process.env = { ...ENV };
    jest.restoreAllMocks();
  });

  it('accepts anybody when no token is configured', async () => {
    const { controller, svc } = setup();

    await expect(controller.receive(request(), one)).resolves.toEqual({ ok: true, n: 1 });
    expect(svc.handleEvents).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['in the X-Cs2-Token header', { header: 'secret' }],
    ['in the ?token= of the address', { token: 'secret' }],
  ])('accepts the right token %s', async (_label, over) => {
    const { controller } = setup({ CS2_TOKEN: 'secret' });

    await expect(controller.receive(request(over), one)).resolves.toEqual({ ok: true, n: 1 });
  });

  it.each([
    ['no token', {}],
    ['a wrong token', { header: 'nope' }],
    ['a wrong token in the address', { token: 'nope' }],
    ['an empty token', { header: '' }],
  ])('refuses %s once a token is configured, and handles nothing', async (_label, over) => {
    const { controller, svc } = setup({ CS2_TOKEN: 'secret' });

    await expect(controller.receive(request(over), one)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.handleEvents).not.toHaveBeenCalled();
  });

  it('reads the header before the address when both are there', async () => {
    const { controller } = setup({ CS2_TOKEN: 'secret' });

    await expect(controller.receive(request({ header: 'secret', token: 'nope' }), one)).resolves.toEqual({ ok: true, n: 1 });
    await expect(controller.receive(request({ header: 'nope', token: 'secret' }), one)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Cs2LogsController : the address allow-list', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined));
  afterEach(() => {
    process.env = { ...ENV };
    jest.restoreAllMocks();
  });

  it('lets every address through when the list is empty', async () => {
    const { controller } = setup({ ALLOWED_IPS: '' });

    await expect(controller.receive(request({ ip: '8.8.8.8' }), one)).resolves.toEqual({ ok: true, n: 1 });
  });

  it.each([
    ['an address of the list', '127.0.0.1,10.0.0.5', '10.0.0.5'],
    ['an address inside a range', '192.168.1.0/24', '192.168.1.77'],
    ['an IPv4 address written the IPv6 way', '10.0.0.5', '::ffff:10.0.0.5'],
    ['a whole network', '0.0.0.0/0', '203.0.113.9'],
    ['a single address as a /32', '10.0.0.5/32', '10.0.0.5'],
    ['a list with spaces and empty entries', ' 127.0.0.1 , , 10.0.0.5 ', '10.0.0.5'],
  ])('lets %s through', async (_label, allowed, ip) => {
    const { controller } = setup({ ALLOWED_IPS: allowed });

    await expect(controller.receive(request({ ip }), one)).resolves.toEqual({ ok: true, n: 1 });
  });

  it.each([
    ['an address that is not on the list', '127.0.0.1,10.0.0.5', '10.0.0.6'],
    ['an address outside the range', '192.168.1.0/24', '192.168.2.1'],
    ['a range with a size that does not exist', '10.0.0.0/40', '10.0.0.5'],
    ['a range with a size that is not a number', '10.0.0.0/abc', '10.0.0.5'],
  ])('refuses %s with a 403 that names the address', async (_label, allowed, ip) => {
    const { controller, svc } = setup({ ALLOWED_IPS: allowed });

    await expect(controller.receive(request({ ip }), one)).rejects.toThrow(ForbiddenException);
    await expect(controller.receive(request({ ip }), one)).rejects.toThrow(`ip not allowed: ${ip}`);
    expect(svc.handleEvents).not.toHaveBeenCalled();
  });

  it('checks the token before the address', async () => {
    const { controller } = setup({ CS2_TOKEN: 'secret', ALLOWED_IPS: '10.0.0.5' });

    await expect(controller.receive(request({ ip: '8.8.8.8' }), one)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.receive(request({ ip: '8.8.8.8', header: 'secret' }), one)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // The address of the client comes from the header when there is one. Pinned as it is: see the note at the top.
  it('takes the address from the first value of X-Forwarded-For when the request has that header', async () => {
    const { controller } = setup({ ALLOWED_IPS: '10.0.0.5' });

    await expect(controller.receive(request({ ip: '8.8.8.8', forwarded: '10.0.0.5, 172.30.0.20' }), one)).resolves.toEqual({ ok: true, n: 1 });
    await expect(controller.receive(request({ ip: '10.0.0.5', forwarded: '8.8.8.8' }), one)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back on 0.0.0.0, which is on no list, when the request has no address at all', async () => {
    const { controller } = setup({ ALLOWED_IPS: '10.0.0.5' });
    const noAddress = { ...(request() as object), ip: undefined } as never;

    await expect(controller.receive(noAddress, one)).rejects.toThrow('ip not allowed: 0.0.0.0');
  });
});

describe('Cs2LogsController : the server and the match of an event', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined));
  afterEach(() => {
    process.env = { ...ENV };
    jest.restoreAllMocks();
  });

  it.each([
    ['the X-Server-Id header', ['srv-h', undefined, undefined]],
    ['the ?serverId= of the address', [undefined, undefined, 'srv-q']],
    ['the ?server= of the address', [undefined, 'srv-s', undefined]],
  ] as const)('names the server of an event that has none from %s', async (_label, [header, server, serverId]) => {
    const { controller, svc } = setup();

    await controller.receive(request(), one, header, server, serverId);

    const [event] = svc.handleEvents.mock.calls[0][0] as Array<{ serverId: string }>;
    expect(event.serverId).toBe(header ?? serverId ?? server);
  });

  it('prefers the header, then ?serverId=, then ?server=', async () => {
    const { controller, svc } = setup();

    await controller.receive(request(), one, 'srv-h', 'srv-s', 'srv-q');
    await controller.receive(request(), one, undefined, 'srv-s', 'srv-q');

    expect(svc.handleEvents.mock.calls.map((c) => (c[0] as Array<{ serverId: string }>)[0].serverId)).toEqual(['srv-h', 'srv-q']);
  });

  it('takes the match from ?matchId= without asking which match the server plays', async () => {
    const { controller, svc, lookup } = setup();

    await controller.receive(request(), one, 'srv-a', undefined, undefined, 'm-query');

    expect(lookup).not.toHaveBeenCalled();
    expect((svc.handleEvents.mock.calls[0][0] as Array<{ matchId: string }>)[0].matchId).toBe('m-query');
  });

  it('asks which match the server plays when the address does not say', async () => {
    const { controller, svc, lookup } = setup({}, 'm-found');

    await controller.receive(request(), one, 'srv-a');

    expect(lookup).toHaveBeenCalledWith('srv-a');
    expect((svc.handleEvents.mock.calls[0][0] as Array<{ matchId: string }>)[0].matchId).toBe('m-found');
  });

  it.each([
    ['the server plays no match', null],
    ['the lookup fails', new Error('redis down')],
  ])('leaves the match out, and still handles the event, when %s', async (_label, matchIdOfServer) => {
    const { controller, svc } = setup({}, matchIdOfServer);

    await expect(controller.receive(request(), one, 'srv-a')).resolves.toEqual({ ok: true, n: 1 });

    expect((svc.handleEvents.mock.calls[0][0] as Array<{ matchId?: string }>)[0].matchId).toBeUndefined();
  });

  it('does not look the match up when it has no server to ask about', async () => {
    const { controller, lookup } = setup();

    await controller.receive(request(), one);

    expect(lookup).not.toHaveBeenCalled();
  });

  it('never overwrites the server or the match an event already has', async () => {
    const { controller, svc } = setup();
    const own = JSON.stringify({ type: 'kill', payload: {}, serverId: 'srv-own', matchId: 'm-own' });

    await controller.receive(request(), own, 'srv-h', undefined, undefined, 'm-query');

    expect(svc.handleEvents).toHaveBeenCalledWith([{ type: 'kill', payload: {}, serverId: 'srv-own', matchId: 'm-own' }]);
  });

  it('answers 0 and hands nothing over when the body holds no event', async () => {
    const { controller, svc } = setup();

    await expect(controller.receive(request(), '[]')).resolves.toEqual({ ok: true, n: 0 });
    await expect(controller.receive(request({ contentType: 'application/x-ndjson' }), '\n\n')).resolves.toEqual({ ok: true, n: 0 });
    expect(svc.handleEvents).not.toHaveBeenCalled();
  });

  it.each([['42'], ['"text"'], ['true']])('refuses a body that is JSON but not an event (%s) with a 400', async (body) => {
    const { controller } = setup();

    await expect(controller.receive(request(), body)).rejects.toThrow('Expected JSON event(s)');
  });

  it('reads the content type whatever its case or its charset', async () => {
    const { controller } = setup();
    const lines = '{"type":"kill","payload":{}}\n{"type":"assist","payload":{}}';

    await expect(controller.receive(request({ contentType: 'Application/X-NDJSON; charset=utf-8' }), lines)).resolves.toEqual({ ok: true, n: 2 });
  });

  it('reads an NDJSON body that did not arrive as text as no lines at all', async () => {
    const { controller } = setup();

    await expect(controller.receive(request({ contentType: 'application/x-ndjson' }), { not: 'text' })).resolves.toEqual({ ok: true, n: 0 });
  });
});
