import { generateServerPassword, KICK_NOT_REGISTERED, MatchAccessService, toLogSteamId } from './match-access.service';

/** Minimal in-memory Redis: strings and sets, MULTI applied in order. */
function fakeRedis() {
  const store = new Map<string, any>();
  const ops = {
    del: (...keys: string[]) => keys.forEach((k) => store.delete(k)),
    set: (k: string, v: string) => store.set(k, v),
    sadd: (k: string, ...m: string[]) => store.set(k, new Set([...(store.get(k) ?? []), ...m])),
  };
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    exists: jest.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    sismember: jest.fn(async (k: string, m: string) => (store.get(k)?.has(m) ? 1 : 0)),
    multi: jest.fn(() => {
      const queue: (() => void)[] = [];
      const tx: any = {
        del: (...a: string[]) => (queue.push(() => ops.del(...a)), tx),
        set: (k: string, v: string) => (queue.push(() => ops.set(k, v)), tx),
        sadd: (k: string, ...m: string[]) => (queue.push(() => ops.sadd(k, ...m)), tx),
        exec: async () => queue.forEach((f) => f()),
      };
      return tx;
    }),
  };
}

describe('MatchAccessService', () => {
  const MATCH = 'game-1';
  const SERVER = 'srv-b';
  let redis: ReturnType<typeof fakeRedis>;
  let cmds: { rcon: jest.Mock };
  let ws: { push: jest.Mock };
  let access: MatchAccessService;

  beforeEach(() => {
    redis = fakeRedis();
    cmds = { rcon: jest.fn().mockResolvedValue({ ok: true }) };
    ws = { push: jest.fn().mockResolvedValue(undefined) };
    access = new MatchAccessService(redis as any, cmds as any, ws as any);
  });

  it('converts SteamID64 to the CS2 log format, keeps [U:1:x], rejects anything else', () => {
    expect(toLogSteamId('76561197960265729')).toBe('[U:1:1]');
    expect(toLogSteamId('[U:1:10000007]')).toBe('[U:1:10000007]');
    expect(toLogSteamId('BOT')).toBeNull();
    expect(toLogSteamId('')).toBeNull();
  });

  it('generates passwords without ambiguous characters', () => {
    const pw = generateServerPassword();
    expect(pw).toMatch(/^[a-z2-9]{10}$/);
    expect(pw).not.toMatch(/[01ilo]/);
  });

  it('sets the password on the server and stores the whitelist in log format', async () => {
    const res = await access.apply(MATCH, SERVER, { password: 'abc23', allowedSteamIds: ['76561197960265729', '[U:1:2]', '[U:1:2]', 'junk'] });
    expect(res).toEqual({ password: 'abc23', whitelist: 2 });
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: SERVER, matchId: MATCH, command: 'sv_password "abc23"' });
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: SERVER, matchId: MATCH, command: 'tv_password ""' });
    expect([...redis.store.get(`match:${MATCH}:allowed`)]).toEqual(['[U:1:1]', '[U:1:2]']);
    expect(await access.getPassword(MATCH)).toBe('abc23');
  });

  it('a match without access clears the server password and any previous whitelist', async () => {
    await access.apply(MATCH, SERVER, { password: 'abc23', allowedSteamIds: ['[U:1:1]'] });
    await access.apply(MATCH, SERVER);
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: SERVER, matchId: MATCH, command: 'sv_password ""' });
    expect(redis.store.has(`match:${MATCH}:allowed`)).toBe(false);
    expect(await access.getPassword(MATCH)).toBeNull();
  });

  it('kicks a connected player who is not in the whitelist, by userid, and alerts the admins', async () => {
    await access.apply(MATCH, SERVER, { allowedSteamIds: ['[U:1:1]'] });
    cmds.rcon.mockClear();

    const kicked = await access.onPlayerConnected(MATCH, SERVER, { name: 'Intrus', steamId: '[U:1:99]', userId: 7 });
    expect(kicked).toBe(true);
    expect(cmds.rcon).toHaveBeenCalledWith({ serverId: SERVER, matchId: MATCH, command: `kickid 7 "${KICK_NOT_REGISTERED}"` });
    expect(ws.push).toHaveBeenCalledWith(MATCH, 'access:not_allowed', expect.objectContaining({ kicked: true }), 'admin');
  });

  it('lets in allowed players, bots and GOTV; no whitelist = nobody kicked', async () => {
    await access.apply(MATCH, SERVER, { allowedSteamIds: ['[U:1:1]'] });
    cmds.rcon.mockClear();
    expect(await access.onPlayerConnected(MATCH, SERVER, { steamId: '[U:1:1]', userId: 3 })).toBe(false);
    expect(await access.onPlayerConnected(MATCH, SERVER, { name: 'Bot_0', steamId: 'BOT', userId: 0 })).toBe(false);

    await access.apply(MATCH, SERVER, { password: 'x' });
    cmds.rcon.mockClear();
    expect(await access.onPlayerConnected(MATCH, SERVER, { steamId: '[U:1:99]', userId: 7 })).toBe(false);
    expect(cmds.rcon).not.toHaveBeenCalled();
  });

  it('without userid in the log: not kicked, admins alerted', async () => {
    await access.apply(MATCH, SERVER, { allowedSteamIds: ['[U:1:1]'] });
    cmds.rcon.mockClear();
    expect(await access.onPlayerConnected(MATCH, SERVER, { steamId: '[U:1:99]' })).toBe(false);
    expect(cmds.rcon).not.toHaveBeenCalled();
    expect(ws.push).toHaveBeenCalledWith(MATCH, 'access:not_allowed', expect.objectContaining({ kicked: false }), 'admin');
  });
});
