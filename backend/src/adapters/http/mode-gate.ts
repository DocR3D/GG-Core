import type { NextFunction, Request, Response } from 'express';
import { appMode, type AppMode } from '@app/shared/app-mode';

/** The Sandbox (replays, injected events, RCON from a page) is a test tool: dev and rec only. */
const SANDBOX = /^\/sandbox(\/|$)/;

/**
 * Closes what the mode does not allow, before anything else sees the request. In prod the Sandbox does not exist: it
 * answers 404 to everybody, an admin included (same as the API documentation when it is closed).
 */
export function modeGate(mode: AppMode = appMode()) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (mode === 'prod' && SANDBOX.test(req.path)) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    next();
  };
}
