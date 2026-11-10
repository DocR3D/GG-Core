import { AuthService, SESSION_COOKIE, sessionHours } from './auth.service';
import { AuthMiddleware, isPublic } from '@adapters/http/auth/auth.middleware';

const ENV = { ...process.env };
const ADMIN = '76561198000000001';
const PLAYER = '76561198000000002';

function service(knownPlayers: string[] = []) {
  const prisma = {
    player: {
      findFirst: jest.fn(async ({ where }: any) =>
        knownPlayers.some((id) => where.steamId.in.includes(id)) ? { username: 'Player_01' } : null),
    },
  };
  return new AuthService(prisma as any);
}

describe('AuthService', () => {
  beforeEach(() => {
    process.env = { ...ENV, JWT_SECRET: 'test-secret', GG_ADMIN_STEAMIDS: `${ADMIN}, 76561198000000009`, GG_ADMIN_PASSWORD: 'lan-pass', GG_ADMIN_TOKEN: 'tok' };
  });
  afterAll(() => (process.env = ENV));

  it('rôle selon le SteamID : admin (liste), joueur (connu, SteamID64 ou format des logs), visiteur', async () => {
    const auth = service(['[U:1:39734274]']); // = PLAYER au format des logs CS2
    await expect(auth.roleForSteamId(ADMIN)).resolves.toEqual({ role: 'admin', name: ADMIN });
    await expect(auth.roleForSteamId(PLAYER)).resolves.toEqual({ role: 'player', name: 'Player_01' });
    await expect(auth.roleForSteamId('76561198000000077')).resolves.toEqual({ role: 'visitor', name: '76561198000000077' });
  });

  it('mot de passe admin hors ligne et jeton des scripts', () => {
    const auth = service();
    expect(auth.checkAdminPassword('lan-pass')).toBe(true);
    expect(auth.checkAdminPassword('nope')).toBe(false);
    expect(auth.checkAdminPassword('')).toBe(false);
    expect(auth.sessionFromBearer('Bearer tok')?.role).toBe('admin');
    expect(auth.sessionFromBearer('Bearer other')).toBeNull();
    expect(auth.sessionFromBearer('bearer   tok')?.role).toBe('admin'); // case and spacing of the scheme do not matter
    for (const bad of [undefined, '', 'Bearer', 'Bearer ', 'Bearer    ', 'tok', 'Basic tok']) {
      expect(auth.sessionFromBearer(bad)).toBeNull();
    }
    delete process.env.GG_ADMIN_PASSWORD;
    expect(auth.checkAdminPassword('lan-pass')).toBe(false); // pas de mot de passe configuré = pas de connexion hors ligne
  });

  it('session signée dans un cookie ; cookie modifié ou signé avec un autre secret refusé', () => {
    const auth = service();
    const token = auth.sign({ sub: ADMIN, role: 'admin', name: 'x', via: 'steam' });
    const header = `other=1; ${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    expect(auth.sessionFromCookie(header)).toEqual({ sub: ADMIN, role: 'admin', name: 'x', via: 'steam' });
    expect(auth.sessionFromCookie(`${SESSION_COOKIE}=${token.slice(0, -2)}xx`)).toBeNull();
    process.env.JWT_SECRET = 'another';
    expect(auth.sessionFromCookie(header)).toBeNull();
  });
});

describe('règles d’accès', () => {
  it.each([
    ['GET', '/view/tournaments/x', true],
    ['GET', '/api/tournament/tournaments', true],
    ['GET', '/login', true],
    ['GET', '/auth/steam/return', true],
    ['POST', '/auth/local', true],
    ['POST', '/cs2/logs', true],
    ['POST', '/ws/', true],
    ['GET', '/sandbox', false],
    ['GET', '/sandbox/tournament', false],
    ['POST', '/api/tournament/matches/x/games/1/result', false],
    ['DELETE', '/api/tournament/tournaments/x', false],
    ['POST', '/api/matches/x/start', false],
    ['GET', '/veto/x', true],
    ['GET', '/veto/x/admin', false],
    ['POST', '/veto/x/step', false],
  ])('%s %s public = %s', (method, path, expected) => {
    expect(isPublic(method, path)).toBe(expected);
  });

  const call = (method: string, path: string, headers: Record<string, string> = {}, accepts = false) => {
    process.env = { ...ENV, JWT_SECRET: 'test-secret', GG_ADMIN_TOKEN: 'tok' };
    const auth = service();
    const mw = new AuthMiddleware(auth);
    const res: any = { redirect: jest.fn(), status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();
    mw.use({ method, path, originalUrl: path, headers, accepts: () => accepts } as any, res, next);
    return { res, next, auth };
  };

  it('une modification sans session → 401 ; avec le jeton admin → passe', () => {
    const anon = call('POST', '/api/tournament/teams');
    expect(anon.next).not.toHaveBeenCalled();
    expect(anon.res.status).toHaveBeenCalledWith(401);
    expect(call('POST', '/api/tournament/teams', { authorization: 'Bearer tok' }).next).toHaveBeenCalled();
  });

  it('le Sandbox dans un navigateur sans session → redirigé vers /login', () => {
    const { res, next } = call('GET', '/sandbox', {}, true);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, '/login?next=%2Fsandbox');
  });

  it('un joueur connecté ouvre une page admin dans un navigateur → page « réservé aux admins » (pas /login : boucle)', () => {
    process.env = { ...ENV, JWT_SECRET: 'test-secret' };
    const token = service().sign({ sub: PLAYER, role: 'player', name: 'p', via: 'steam' });
    const res: any = { redirect: jest.fn(), status: jest.fn(() => res), type: jest.fn(() => res), send: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    new AuthMiddleware(service()).use(
      { method: 'GET', path: '/sandbox', originalUrl: '/sandbox', headers: { cookie: `${SESSION_COOKIE}=${token}` }, accepts: () => true } as any,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send.mock.calls[0][0]).toContain('Réservé aux admins');
  });

  it('un joueur connecté n’a pas les droits admin → 403', () => {
    process.env = { ...ENV, JWT_SECRET: 'test-secret' };
    const token = service().sign({ sub: PLAYER, role: 'player', name: 'p', via: 'steam' });
    const { res, next } = call('POST', '/api/tournament/teams', { cookie: `${SESSION_COOKIE}=${token}` });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('véto : un joueur connecté atteint les actions de capitaine, pas undo / reset ; un anonyme → 401', () => {
    process.env = { ...ENV, JWT_SECRET: 'test-secret' };
    const cookie = `${SESSION_COOKIE}=${service().sign({ sub: PLAYER, role: 'player', name: 'p', via: 'steam' })}`;
    for (const action of ['rps', 'start', 'step']) expect(call('POST', `/veto/m1/${action}`, { cookie }).next).toHaveBeenCalled();
    expect(call('POST', '/veto/m1/undo', { cookie }).res.status).toHaveBeenCalledWith(403);
    expect(call('POST', '/veto/m1/step').res.status).toHaveBeenCalledWith(401);
  });

  it('AUTH_DISABLED=1 laisse tout passer en mode dev (dev jetable uniquement)', () => {
    process.env = { ...ENV, AUTH_DISABLED: '1', GG_ENV: 'dev', JWT_SECRET: 's' };
    const mw = new AuthMiddleware(service());
    const next = jest.fn();
    mw.use({ method: 'DELETE', path: '/api/x', originalUrl: '/api/x', headers: {}, accepts: () => false } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it.each(['rec', 'prod', undefined, 'staging'])("AUTH_DISABLED=1 est ignoré hors du mode dev (GG_ENV=%s) : l'authentification reste en place", (GG_ENV) => {
    process.env = { ...ENV, AUTH_DISABLED: '1', ...(GG_ENV ? { GG_ENV } : {}), JWT_SECRET: 's' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    new AuthMiddleware(service()).use({ method: 'DELETE', path: '/api/x', originalUrl: '/api/x', headers: {}, accepts: () => false } as any, res as any, next);

    expect(service().disabled).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('how long a login lasts', () => {
  const sessionOf = { sub: 'local-admin', role: 'admin', name: 'admin', via: 'password' } as const;

  afterEach(() => {
    process.env = { ...ENV };
  });

  it('is 24 hours without a setting, and for anything that is not a positive number', () => {
    expect(sessionHours({})).toBe(24);
    for (const value of ['', '  ', 'abc', '0', '-3', 'NaN', 'Infinity']) expect(sessionHours({ GG_SESSION_HOURS: value })).toBe(24);
  });

  it('is what GG_SESSION_HOURS says, a fraction of an hour included', () => {
    expect(sessionHours({ GG_SESSION_HOURS: '8' })).toBe(8);
    expect(sessionHours({ GG_SESSION_HOURS: '0.5' })).toBe(0.5);
    expect(sessionHours({ GG_SESSION_HOURS: ' 72 ' })).toBe(72);
  });

  it('sets the lifetime of the signed session and of its cookie, both from the setting', () => {
    process.env = { ...ENV, JWT_SECRET: 's', GG_SESSION_HOURS: '2' };
    const auth = service();
    const token = auth.sign(sessionOf);
    const { iat, exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { iat: number; exp: number };

    expect(exp - iat).toBe(2 * 3600);
    expect(auth.cookie(token)).toContain('Max-Age=7200');
    expect(auth.cookie(token)).toContain('HttpOnly');
    expect(auth.cookie(null)).toContain('Max-Age=0');
  });

  it('is 24 hours for the session and the cookie when nothing is set', () => {
    process.env = { ...ENV, JWT_SECRET: 's' };
    delete process.env.GG_SESSION_HOURS;
    const auth = service();
    const { iat, exp } = JSON.parse(Buffer.from(auth.sign(sessionOf).split('.')[1], 'base64url').toString()) as { iat: number; exp: number };

    expect(exp - iat).toBe(24 * 3600);
    expect(auth.cookie('t')).toContain('Max-Age=86400');
  });
});
