import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { json, urlencoded } from 'express';
import { RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const isDebug = process.env.LOG_LEVEL === 'debug';
  const app = await NestFactory.create(AppModule, {
    logger: isDebug
      ? ['log', 'error', 'warn', 'debug', 'verbose']
      : ['log', 'error', 'warn'],
  });

  // Pour des IP correctes derrière proxy
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  // ✅ 1) TEXTE brut UNIQUEMENT pour /cs2/logs (d’abord)
  app.use('/cs2/logs', bodyParser.text({ type: () => true, limit: '2mb' }));

  // ❗ 2) Parsers globaux - mais seulement sous /api
  app.use('/api', json({ limit: '1mb' }));
  app.use('/api', urlencoded({ extended: true }));

  // 3) Prefix global /api en excluant /cs2/logs (comme tu l’avais)
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'cs2/logs', method: RequestMethod.ALL },
      { path: 'cs2/logs/(.*)', method: RequestMethod.ALL },
    ],
  });


  app.enableCors({ origin: true, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('GG-Core API')
    .setDescription('API de gestion de matchs CS2 — eBot++')
    .setVersion('1.0')
    .addTag('matches', 'Gestion des matchs')
    .addTag('servers', 'Gestion des serveurs CS2')
    .addTag('maps', 'Mappool')
    .addTag('teams', 'Équipes')
    .addTag('cs2-logs', 'Réception des logs CS2 (agent interne)')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(8081, '0.0.0.0');
}
bootstrap();