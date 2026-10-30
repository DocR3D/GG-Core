import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { json, urlencoded, static as serveStatic } from 'express';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { AuthMiddleware } from './adapters/http/auth/auth.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log','error','warn','debug','verbose'] });

  // Pour des IP correctes derrière proxy
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  // ✅ 1) TEXTE brut UNIQUEMENT pour /cs2/logs (d’abord)
  app.use('/cs2/logs', bodyParser.text({ type: () => true, limit: '2mb' }));

  // ❗ 2) Parsers globaux pour /api et /sandbox
  app.use('/api', json({ limit: '1mb' }));
  app.use('/api', urlencoded({ extended: true }));
  app.use('/sandbox', json({ limit: '15mb' }));
  app.use('/sandbox', urlencoded({ extended: true, limit: '15mb' }));
  app.use('/auth', urlencoded({ extended: false })); // login form

  // Stylesheets and font of the server-rendered pages, served locally: no CDN (LAN-first). Our own CSS is
  // revalidated on every load (no maxAge) so a design change shows up on refresh.
  app.use('/assets', serveStatic(path.join(process.cwd(), 'node_modules/@picocss/pico/css'), { index: false, maxAge: '1d' }));
  app.use('/assets/css', serveStatic(path.join(process.cwd(), 'public/css'), { index: false }));
  app.use('/assets/fonts', serveStatic(path.join(process.cwd(), 'node_modules/@fontsource/poppins/files'), { index: false, maxAge: '30d' }));

  // Access rules for EVERY request, at the Express level: a Nest module middleware would only cover the
  // /api-prefixed routes, not /sandbox, /view, /login, /auth (excluded from the prefix below)
  const access = app.get(AuthMiddleware);
  app.use((req: any, res: any, next: any) => access.use(req, res, next));

  // 3) Prefix global /api en excluant /cs2/logs et /sandbox
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'cs2/logs', method: RequestMethod.ALL },
      { path: 'cs2/logs/(.*)', method: RequestMethod.ALL },
      { path: 'sandbox', method: RequestMethod.ALL },
      { path: 'sandbox/(.*)', method: RequestMethod.ALL },
      // login pages
      { path: 'login', method: RequestMethod.ALL },
      { path: 'auth/(.*)', method: RequestMethod.ALL },
      // human pages (plain-text views), /api stays the JSON API
      { path: 'view', method: RequestMethod.ALL },
      { path: 'view/(.*)', method: RequestMethod.ALL },
    ],
  });

  // CORS REST : origines autorisées via CORS_ORIGIN (liste séparée par des virgules), ex. le frontend Next.js
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  await app.listen(8081);
}
bootstrap();
