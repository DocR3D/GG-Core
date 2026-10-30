import { AuthService, SESSION_COOKIE } from './auth.service';
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

  it('AUTH_DISABLED=1 laisse tout passer (dev jetable uniquement)', () => {
    process.env = { ...ENV, AUTH_DISABLED: '1', JWT_SECRET: 's' };
    const mw = new AuthMiddleware(service());
    const next = jest.fn();
    mw.use({ method: 'DELETE', path: '/api/x', originalUrl: '/api/x', headers: {}, accepts: () => false } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});
