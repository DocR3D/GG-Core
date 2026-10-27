import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { json, urlencoded } from 'express';
import { RequestMethod } from '@nestjs/common';

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

  // 3) Prefix global /api en excluant /cs2/logs et /sandbox
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'cs2/logs', method: RequestMethod.ALL },
      { path: 'cs2/logs/(.*)', method: RequestMethod.ALL },
      { path: 'sandbox', method: RequestMethod.ALL },
      { path: 'sandbox/(.*)', method: RequestMethod.ALL },
    ],
  });

  // app.enableCors({ origin: true, credentials: true });
  await app.listen(8081);
}
bootstrap();
