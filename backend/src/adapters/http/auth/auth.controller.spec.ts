import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';

const request = (kind: 'json' | 'form' | 'bare'): Request =>
  ({
    ip: '127.0.0.1',
    socket: {},
    is: jest.fn().mockReturnValue(kind === 'json' ? 'application/json' : false),
    get: jest.fn().mockReturnValue(kind === 'json' ? 'application/json' : kind === 'form' ? 'text/html,application/xhtml+xml,*/*;q=0.8' : undefined),
  }) as unknown as Request;

const response = () => {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
    redirect: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { setHeader: jest.Mock; status: jest.Mock; json: jest.Mock; redirect: jest.Mock; send: jest.Mock };
};

const auth = (valid = true) =>
  ({
    checkAdminPassword: jest.fn().mockReturnValue(valid),
    sign: jest.fn().mockReturnValue('signed'),
    cookie: jest.fn((token: string | null) => (token ? 'gg_session=signed' : 'gg_session=; Max-Age=0')),
  }) as any;

describe('AuthController local JSON compatibility', () => {
  it('returns JSON 200 and sets the cookie', () => {
    const controller = new AuthController(auth(true));
    const res = response();
    controller.local({ password: 'ok' }, request('json'), res);
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', 'gg_session=signed');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, session: { role: 'admin', name: 'admin (hors ligne)', via: 'password' } });
  });

  it('returns JSON 401 for a bad password', () => {
    const controller = new AuthController(auth(false));
    const res = response();
    controller.local({ password: 'bad' }, request('json'), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Mot de passe incorrect' });
  });

  it('returns JSON 429 with Retry-After and retryAfter', () => {
    const controller = new AuthController(auth(false));
    for (let i = 0; i < 10; i++) controller.local({ password: 'bad' }, request('json'), response());
    const res = response();
    controller.local({ password: 'bad' }, request('json'), res);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ message: expect.any(String), retryAfter: expect.any(Number) });
  });

  it('keeps form redirects for success, failure and throttle', () => {
    const success = new AuthController(auth(true));
    const successRes = response();
    success.local({ password: 'ok', next: '/view' }, request('form'), successRes);
    expect(successRes.redirect).toHaveBeenCalledWith(303, '/view');

    const failure = new AuthController(auth(false));
    const failureRes = response();
    failure.local({ password: 'bad' }, request('form'), failureRes);
    expect(failureRes.redirect).toHaveBeenCalledWith(303, expect.stringContaining('/login?error='));
    for (let i = 1; i < 10; i++) failure.local({ password: 'bad' }, request('form'), response());
    const throttleRes = response();
    failure.local({ password: 'bad' }, request('form'), throttleRes);
    expect(throttleRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(throttleRes.redirect).toHaveBeenCalledWith(303, expect.stringContaining('/login?error='));
  });

  it('keeps the redirect when the client sends no Accept header (curl, scripts)', () => {
    const controller = new AuthController(auth(false));
    const res = response();
    controller.local({ password: 'bad' }, request('bare'), res);
    expect(res.redirect).toHaveBeenCalledWith(303, expect.stringContaining('/login?error='));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('POST logout clears the cookie and returns 204', () => {
    const controller = new AuthController(auth(true));
    const res = response();
    controller.logoutJson(res);
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', 'gg_session=; Max-Age=0');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
