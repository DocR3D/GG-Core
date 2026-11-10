/**
 * AuthController : the login pages, Steam, the session routes and the redirect rules. (The JSON answers of the offline
 * password and its 429 are in auth.controller.spec.ts.) Two ways in: Steam (needs Internet) and the offline admin
 * password. After a login everybody goes on to the page he was heading to, and only to a page of this site.
 */
import type { Request, Response } from 'express';
import { AuthController, publicBase } from './auth.controller';
import { verifySteamAssertion } from '@app/auth/steam-openid';

jest.mock('@app/auth/steam-openid', () => ({
  steamLoginUrl: jest.fn((returnTo: string, realm: string) => `https://steam.test/login?return=${encodeURIComponent(returnTo)}&realm=${encodeURIComponent(realm)}`),
  verifySteamAssertion: jest.fn(),
}));

const verify = verifySteamAssertion as jest.Mock;

function setup(over: { password?: boolean; role?: 'admin' | 'player' | 'visitor' } = {}) {
  const auth = {
    checkAdminPassword: jest.fn().mockReturnValue(over.password ?? true),
    roleForSteamId: jest.fn().mockResolvedValue({ role: over.role ?? 'admin', name: 'Garitos' }),
    sign: jest.fn((session: unknown) => `signed:${JSON.stringify(session)}`),
    cookie: jest.fn((token: string | null) => (token ? `gg_session=${token}` : 'gg_session=; Max-Age=0')),
  };
  return { controller: new AuthController(auth as never), auth };
}

function res() {
  const r = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
    type: jest.fn().mockReturnThis(),
  };
  return r as typeof r & Response;
}

function req(over: { ip?: string; accept?: string; json?: boolean; session?: unknown; host?: string } = {}) {
  return {
    ip: over.ip ?? '10.0.0.5',
    socket: { remoteAddress: '10.9.9.9' },
    protocol: 'http',
    headers: {},
    app: { get: () => undefined },
    get: (name: string) => ({ accept: over.accept, host: over.host ?? 'gg.lan:8081' })[name.toLowerCase()],
    is: (type: string) => (over.json && type === 'application/json' ? 'application/json' : false),
    ggSession: over.session,
  } as unknown as Request & { ggSession?: never };
}

const html = (r: ReturnType<typeof res>) => (r.send.mock.calls[0]?.[0] ?? '') as string;
const target = (r: ReturnType<typeof res>) => decodeURIComponent((r.redirect.mock.calls[0] as [number, string])[1]);

describe('AuthController : the login page', () => {
  it('shows the two ways in to somebody who is not logged in, and keeps where he was heading', () => {
    const { controller } = setup();
    const r = res();

    controller.login(req(), '/veto/m-1', '', r);

    expect(html(r)).toContain('href="/auth/steam?next=%2Fveto%2Fm-1"');
    expect(html(r)).toContain('action="/auth/local"');
    expect(html(r)).toContain('name="next" value="/veto/m-1"');
    expect(html(r)).toContain('href="/view"'); // the tournaments can be seen without logging in
    expect(r.redirect).not.toHaveBeenCalled();
  });

  it('sends somebody who is already logged in on to where he was heading, not to the login again', () => {
    const { controller } = setup();
    const r = res();

    controller.login(req({ session: { role: 'player' } }), '/veto/m-1', '', r);

    expect(r.redirect).toHaveBeenCalledWith(302, '/veto/m-1');
    expect(r.send).not.toHaveBeenCalled();
  });

  it('shows an error, escaped', () => {
    const { controller } = setup();
    const r = res();

    controller.login(req(), '/', 'Mot de passe <b>incorrect</b>', r);

    expect(html(r)).toContain('<b>Mot de passe &lt;b&gt;incorrect&lt;/b&gt;</b>');
  });

  it.each([
    ['another site', 'https://evil.example/steal', '/'],
    ['a protocol-relative address', '//evil.example/steal', '/'],
    ['no address', undefined, '/'],
    ['something that is not text', 42, '/'],
    ['a path of this site', '/admin/tournaments/t-1', '/admin/tournaments/t-1'],
    ['the home', '/', '/'],
  ])('only ever goes on to a page of this site: %s', (_label, next, expected) => {
    const { controller } = setup();
    const r = res();

    controller.login(req({ session: { role: 'admin' } }), next as string, '', r);

    expect(r.redirect).toHaveBeenCalledWith(302, expected);
  });
});

describe('AuthController : Steam', () => {
  it('sends the browser to Steam, and asks it to come back here with the page it was heading to', () => {
    const { controller } = setup();
    const r = res();

    controller.steam(req({ host: 'gg.lan:8081' }), '/veto/m-1', r);

    const [status, url] = r.redirect.mock.calls[0] as [number, string];
    expect(status).toBe(302);
    expect(decodeURIComponent(url)).toContain('return=http://gg.lan:8081/auth/steam/return?next=%2Fveto%2Fm-1'); // the page is encoded once inside the return address
    expect(decodeURIComponent(url)).toContain('realm=http://gg.lan:8081');
  });

  it('never asks Steam to send the browser back to another site', () => {
    const { controller } = setup();
    const r = res();

    controller.steam(req(), 'https://evil.example', r);

    expect(target(r)).toContain('/auth/steam/return?next=%2F&realm='); // the home, not the other site
  });

  it.each(['admin', 'player', 'visitor'] as const)(
    'a %s who comes back from Steam is logged in and goes on to the page he was heading to',
    async (role) => {
      verify.mockResolvedValue('76561198000000001');
      const { controller, auth } = setup({ role });
      const r = res();

      await controller.steamReturn(req(), { next: '/veto/m-1' }, r);

      expect(auth.roleForSteamId).toHaveBeenCalledWith('76561198000000001');
      expect(auth.sign).toHaveBeenCalledWith({ sub: '76561198000000001', role, name: 'Garitos', via: 'steam' });
      expect(r.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('gg_session=signed:'));
      expect(r.redirect).toHaveBeenCalledWith(302, '/veto/m-1');
    },
  );

  it('goes to the home when no page was asked for, or when it is not a page of this site', async () => {
    verify.mockResolvedValue('76561198000000001');
    const { controller } = setup();
    const a = res();
    const b = res();

    await controller.steamReturn(req(), {}, a);
    await controller.steamReturn(req(), { next: 'https://evil.example' }, b);

    expect(a.redirect).toHaveBeenCalledWith(302, '/');
    expect(b.redirect).toHaveBeenCalledWith(302, '/');
  });

  it('says so, and offers the offline login, when Steam cannot be reached', async () => {
    verify.mockRejectedValue(new Error('ENOTFOUND steamcommunity.com'));
    const { controller, auth } = setup();
    const r = res();

    await controller.steamReturn(req(), { next: '/veto/m-1' }, r);

    expect(target(r)).toContain('/login?error=Steam injoignable : utiliser la connexion hors ligne');
    expect(target(r)).toContain('next=/veto/m-1');
    expect(r.setHeader).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('refuses a login that Steam does not confirm, without a session', async () => {
    verify.mockResolvedValue(null);
    const { controller, auth } = setup();
    const r = res();

    await controller.steamReturn(req(), { next: '/' }, r);

    expect(target(r)).toContain('/login?error=Connexion Steam refusée');
    expect(r.setHeader).not.toHaveBeenCalled();
    expect(auth.roleForSteamId).not.toHaveBeenCalled();
  });
});

describe('AuthController : the offline admin password, the parts the JSON tests do not reach', () => {
  it('logs the admin in as the offline admin, with a cookie, and sends him on with a 303 that a form follows with a GET', () => {
    const { controller, auth } = setup();
    const r = res();

    controller.local({ password: 'lan-pass', next: '/admin' }, req(), r);

    expect(auth.checkAdminPassword).toHaveBeenCalledWith('lan-pass');
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'local-admin', role: 'admin', name: 'admin (hors ligne)', via: 'password' });
    expect(r.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('gg_session='));
    expect(r.redirect).toHaveBeenCalledWith(303, '/admin');
  });

  it('answers a wrong password with the login page, the reason and where he was heading, and no session', () => {
    const { controller, auth } = setup({ password: false });
    const r = res();

    controller.local({ password: 'nope', next: '/admin' }, req(), r);

    expect(target(r)).toBe('/login?error=Mot de passe incorrect&next=/admin');
    expect(r.redirect.mock.calls[0][0]).toBe(303);
    expect(auth.sign).not.toHaveBeenCalled();
    expect(r.setHeader).not.toHaveBeenCalled();
  });

  it('treats a missing body as a wrong password', () => {
    const { controller, auth } = setup({ password: false });

    controller.local(undefined as never, req(), res());

    expect(auth.checkAdminPassword).toHaveBeenCalledWith('');
  });

  it('goes only to a page of this site after the login', () => {
    const { controller } = setup();
    const r = res();

    controller.local({ password: 'lan-pass', next: 'https://evil.example' }, req(), r);

    expect(r.redirect).toHaveBeenCalledWith(303, '/');
  });

  describe('the brake on wrong passwords', () => {
    function fail(controller: AuthController, times: number, ip = '10.0.0.5') {
      for (let i = 0; i < times; i++) controller.local({ password: 'nope' }, req({ ip, json: true }), res());
    }

    it('does not even check the password while the address is refused, so the right one does not get through either', () => {
      const { controller, auth } = setup({ password: false });
      fail(controller, 10);
      auth.checkAdminPassword.mockClear().mockReturnValue(true);
      const r = res();

      controller.local({ password: 'lan-pass' }, req({ json: true }), r);

      expect(r.status).toHaveBeenCalledWith(429);
      expect(auth.checkAdminPassword).not.toHaveBeenCalled();
      expect(auth.sign).not.toHaveBeenCalled();
    });

    it('sends a browser back to the login with the wait, instead of JSON', () => {
      const { controller } = setup({ password: false });
      fail(controller, 10);
      const r = res();

      controller.local({ password: 'nope', next: '/admin' }, req(), r);

      expect(target(r)).toMatch(/^\/login\?error=Trop d’essais : réessaie dans \d+ s&next=\/admin$/);
      expect(r.redirect.mock.calls[0][0]).toBe(303);
    });

    it('is counted per address: another address is not refused', () => {
      const { controller } = setup({ password: false });
      fail(controller, 10, '10.0.0.5');
      const r = res();

      controller.local({ password: 'nope' }, req({ ip: '10.0.0.6', json: true }), r);

      expect(r.status).toHaveBeenCalledWith(401);
    });

    it('forgets the failures of an address once its owner gets the password right', () => {
      const { controller, auth } = setup({ password: false });
      fail(controller, 9);
      auth.checkAdminPassword.mockReturnValue(true);
      controller.local({ password: 'lan-pass' }, req({ json: true }), res());
      auth.checkAdminPassword.mockReturnValue(false);

      fail(controller, 9);
      const r = res();
      controller.local({ password: 'nope' }, req({ json: true }), r);

      expect(r.status).toHaveBeenCalledWith(401); // only the 10th wrong try since the success: not refused yet
    });

    it('counts by the socket address, then under "unknown", when the request has no address', () => {
      const { controller } = setup({ password: false });
      const noIp = { ...req(), ip: undefined, socket: {} } as unknown as Request;
      for (let i = 0; i < 10; i++) controller.local({ password: 'nope' }, noIp, res());
      const r = res();

      controller.local({ password: 'nope' }, noIp, r);

      expect(target(r)).toContain('Trop d’essais');
    });
  });
});

describe('AuthController : leaving and who I am', () => {
  it('logs out with a page that forgets the cookie and goes to the login', () => {
    const { controller, auth } = setup();
    const r = res();

    controller.logout(r);

    expect(auth.cookie).toHaveBeenCalledWith(null);
    expect(r.setHeader).toHaveBeenCalledWith('Set-Cookie', 'gg_session=; Max-Age=0');
    expect(r.redirect).toHaveBeenCalledWith(302, '/login');
  });

  it('logs out a script with a 204 and no body', () => {
    const { controller } = setup();
    const r = res();

    controller.logoutJson(r);

    expect(r.setHeader).toHaveBeenCalledWith('Set-Cookie', 'gg_session=; Max-Age=0');
    expect(r.status).toHaveBeenCalledWith(204);
    expect(r.send).toHaveBeenCalledWith();
  });

  it('says who is logged in, or that it is a visitor', () => {
    const { controller } = setup();
    const session = { sub: '1', role: 'player', name: 'cap', via: 'steam' };

    expect(controller.me({ ggSession: session } as never)).toBe(session);
    expect(controller.me({ ggSession: null } as never)).toEqual({ role: 'visitor' });
    expect(controller.me({} as never)).toEqual({ role: 'visitor' });
  });
});

describe('publicBase : where Steam sends the browser back to', () => {
  const before = process.env.AUTH_PUBLIC_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.AUTH_PUBLIC_URL;
    else process.env.AUTH_PUBLIC_URL = before;
  });

  function request(over: { host?: string; headers?: Record<string, string>; trusted?: boolean; protocol?: string } = {}) {
    return {
      protocol: over.protocol ?? 'http',
      headers: over.headers ?? {},
      socket: { remoteAddress: '172.30.0.20' },
      get: (name: string) => (name.toLowerCase() === 'host' ? (over.host ?? 'backend:8081') : undefined),
      app: { get: (key: string) => (key === 'trust proxy fn' ? () => over.trusted === true : undefined) },
    } as unknown as Request;
  }

  it('is AUTH_PUBLIC_URL when it is set, without its trailing slash', () => {
    process.env.AUTH_PUBLIC_URL = 'https://gg.example/';
    expect(publicBase(request())).toBe('https://gg.example');
  });

  it('is the host the browser used otherwise', () => {
    delete process.env.AUTH_PUBLIC_URL;
    expect(publicBase(request({ host: 'gg.lan:8081' }))).toBe('http://gg.lan:8081');
  });

  it('behind the front proxy, reads the original host and protocol, first value only, but only from a trusted proxy', () => {
    delete process.env.AUTH_PUBLIC_URL;
    const headers = { 'x-forwarded-host': 'gg.lan:3000, backend:8081', 'x-forwarded-proto': 'https, http' };

    expect(publicBase(request({ headers, trusted: true }))).toBe('https://gg.lan:3000');
  });

  it('ignores the forwarded host from anybody else: a client could choose where Steam sends the browser', () => {
    delete process.env.AUTH_PUBLIC_URL;
    const headers = { 'x-forwarded-host': 'evil.example' };

    expect(publicBase(request({ headers, trusted: false, host: 'gg.lan:8081' }))).toBe('http://gg.lan:8081');
  });

  it('does not read the forwarded host when there is no trust proxy function at all', () => {
    delete process.env.AUTH_PUBLIC_URL;
    const bare = { ...request({ headers: { 'x-forwarded-host': 'evil.example' } }), app: { get: () => undefined } } as unknown as Request;

    expect(publicBase(bare)).toBe('http://backend:8081');
  });
});
