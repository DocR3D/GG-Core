import type { NextFunction, Request, Response } from 'express';
import { modeGate } from './mode-gate';

function run(mode: 'dev' | 'rec' | 'prod', path: string) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  modeGate(mode)({ path } as Request, res as unknown as Response, next);
  return { res, next };
}

describe('modeGate', () => {
  it.each(['/sandbox', '/sandbox/', '/sandbox/state/m-1', '/sandbox/tournament/prepare', '/sandbox/rcon'])(
    'answers 404 to %s in prod, and lets nothing through',
    (path) => {
      const { res, next } = run('prod', path);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ statusCode: 404, message: 'Not Found' });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(['dev', 'rec'] as const)('leaves the Sandbox open in the %s mode', (mode) => {
    const { res, next } = run(mode, '/sandbox/state/m-1');

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(['/api/health', '/api/tournament/live', '/sandboxes', '/sandbox-tools', '/view', '/', '/api/sandbox'])(
    'does not touch %s in prod: only the Sandbox itself is closed',
    (path) => {
      const { res, next } = run('prod', path);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it('follows the mode of the environment when none is given', () => {
    const before = process.env.GG_ENV;
    try {
      delete process.env.GG_ENV;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      modeGate()({ path: '/sandbox' } as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(404); // no mode is prod
      expect(next).not.toHaveBeenCalled();
    } finally {
      if (before !== undefined) process.env.GG_ENV = before;
    }
  });
});
