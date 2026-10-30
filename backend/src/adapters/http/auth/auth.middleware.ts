// src/adapters/http/auth/auth.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService, Session } from '@app/auth/auth.service';

/**
 * Access rules (V1):
 * - public: reads (GET / HEAD) outside the Sandbox and the veto admin page - /view pages, /api reads -, login pages, health;
 * - own authentication: agent log ingestion (/cs2/logs, log token) and WebSockets (/ws, JWT guard);
 * - any logged-in user (captains): the veto actions (POST /veto/:matchId/rps|start|step) - the veto service
 *   checks who is captain of what;
 * - admin only: everything else that changes something (POST / PUT / PATCH / DELETE) and the Sandbox tools.
 * Browsers are sent to /login; API calls get 401 (not logged in) or 403 (logged in, not admin).
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  use(req: Request & { ggSession?: Session | null }, res: Response, next: NextFunction) {
    const session = this.auth.sessionFromBearer(req.headers.authorization) ?? this.auth.sessionFromCookie(req.headers.cookie);
    req.ggSession = session;
    if (this.auth.disabled || isPublic(req.method, req.path) || session?.role === 'admin') return next();
    if (session && isCaptainAction(req.method, req.path)) return next();

    const isPage = (req.method === 'GET' || req.method === 'HEAD') && !!req.accepts('html') && !req.path.startsWith('/api');
    if (isPage) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    res.status(session ? 403 : 401).json({
      statusCode: session ? 403 : 401,
      message: session ? 'admin role required' : 'authentication required (Sign in through Steam on /login, or Authorization: Bearer <admin token>)',
    });
  }
}

export function isPublic(method: string, path: string): boolean {
  if (path === '/login' || path.startsWith('/auth/') || path === '/api/health') return true;
  if (path === '/cs2/logs' || path.startsWith('/cs2/logs/')) return true; // agent → backend, log token
  if (path === '/ws' || path.startsWith('/ws/')) return true; // Socket.IO, its own JWT guard
  const read = method === 'GET' || method === 'HEAD';
  const sandbox = path === '/sandbox' || path.startsWith('/sandbox/');
  const vetoAdmin = /^\/veto\/[^/]+\/admin$/.test(path);
  return read && !sandbox && !vetoAdmin;
}

/** Veto actions a captain (player role) may send; undo / reset stay admin only. */
export function isCaptainAction(method: string, path: string): boolean {
  return method === 'POST' && /^\/veto\/[^/]+\/(rps|start|step)$/.test(path);
}
