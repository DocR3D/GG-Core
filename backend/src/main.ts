import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { json, urlencoded, static as serveStatic } from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';
import { AuthMiddleware } from './adapters/http/auth/auth.middleware';
import { parseTrustProxy } from './trust-proxy';
import { installAuthBodyParsers } from './adapters/http/auth/auth-body-parsers';
import { mountApiDocs } from './adapters/http/docs/api-docs';
import { applyGlobalPrefix } from './global-prefix';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log','error','warn','debug','verbose'] });

  // Only explicitly trusted proxies may supply the client address used by auth throttling.
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  // ✅ 1) TEXTE brut UNIQUEMENT pour /cs2/logs (d’abord)
  app.use('/cs2/logs', bodyParser.text({ type: () => true, limit: '2mb' }));

  // ❗ 2) Parsers globaux pour /api et /sandbox
  app.use('/api', json({ limit: '1mb' }));
  app.use('/api', urlencoded({ extended: true }));
  app.use('/sandbox', json({ limit: '15mb' }));
  app.use('/sandbox', urlencoded({ extended: true, limit: '15mb' }));
  installAuthBodyParsers(app);
  app.use('/veto', json({ limit: '16kb' }));
  app.use('/veto', urlencoded({ extended: false, limit: '16kb' })); // veto forms

  // Stylesheets and font of the server-rendered pages, served locally: no CDN (LAN-first). Our own CSS is
  // revalidated on every load (no maxAge) so a design change shows up on refresh.
  app.use('/assets', serveStatic(path.join(process.cwd(), 'node_modules/@picocss/pico/css'), { index: false, maxAge: '1d' }));
  app.use('/assets/css', serveStatic(path.join(process.cwd(), 'public/css'), { index: false }));
  app.use('/assets/fonts', serveStatic(path.join(process.cwd(), 'node_modules/@fontsource/poppins/files'), { index: false, maxAge: '30d' }));
  app.use('/uploads', serveStatic(path.join(process.cwd(), 'public/uploads'), { index: false, maxAge: '7d' }));

  // Access rules for EVERY request, at the Express level: a Nest module middleware would only cover the
  // /api-prefixed routes, not /sandbox, /view, /login, /auth (excluded from the prefix below)
  const access = app.get(AuthMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) => access.use(req, res, next));

  serveFront(app.getHttpAdapter().getInstance());

  // 3) Prefix global /api en excluant /cs2/logs et /sandbox (shared with the OpenAPI export)
  applyGlobalPrefix(app);

  // API documentation (Swagger UI), only when GG_API_DOCS=1, admins only: after the prefix, the document lists the real paths
  if (mountApiDocs(app)) console.log('[docs] API documentation on /api/docs (admins only)');

  // CORS REST : origines autorisées via CORS_ORIGIN (liste séparée par des virgules). Le front React est servi par
  // ce même serveur (même origine) : utile seulement pour un client externe.
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  await app.listen(8081);
}
/** Paths answered by the server itself; every other GET of a page goes to the React front. */
const SERVER_PATHS = /^\/(api|auth|login|view|veto|sandbox|assets|cs2|socket\.io|static)(\/|$)/;

/**
 * The React front (frontend/, built by Vite) served from this server: same origin as the API, so the session
 * cookie and Socket.IO work without CORS. Its files are under /static (hashed names, cached for good); any other
 * page address gets index.html, React Router shows the right screen. FRONT_DIST = the built folder (Docker:
 * /front); no build → no front, the server pages still work.
 */
function serveFront(express: Express) {
  const dist = process.env.FRONT_DIST || path.join(process.cwd(), '../frontend/dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    console.warn(`[front] ${index} not found: React front not served (make front)`);
    return;
  }
  express.use('/static', serveStatic(path.join(dist, 'static'), { index: false, maxAge: '1y', immutable: true }));
  express.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || SERVER_PATHS.test(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache'); // a new build shows up on the next load
    res.sendFile(index);
  });
}

bootstrap().catch((e) => {
  console.error('backend failed to start', e);
  process.exit(1);
});
