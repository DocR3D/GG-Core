// src/adapters/http/auth/auth.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService, Session } from '@app/auth/auth.service';

/**
 * Access rules (V1):
 * - public: reads (GET / HEAD) outside the Sandbox - /view pages, /api reads -, login pages, health;
 * - own authentication: agent log ingestion (/cs2/logs, log token) and WebSockets (/ws, JWT guard);
 * - admin only: everything that changes something (POST / PUT / PATCH / DELETE) and the Sandbox tools.
 * Browsers are sent to /login; API calls get 401 (not logged in) or 403 (logged in, not admin).
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  use(req: Request & { ggSession?: Session | null }, res: Response, next: NextFunction) {
    const session = this.auth.sessionFromBearer(req.headers.authorization) ?? this.auth.sessionFromCookie(req.headers.cookie);
    req.ggSession = session;
    if (this.auth.disabled || isPublic(req.method, req.path) || session?.role === 'admin') return next();

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
  return read && !sandbox;
}
