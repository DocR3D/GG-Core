import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { json, urlencoded } from 'express';
import { RequestMethod } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Parsers "globaux" pour l'API JSON classique
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true }));

  // Parser TEXTE brut uniquement pour /cs2/logs (logs CS2)
  app.use(
    '/cs2/logs',
    bodyParser.text({
      // traite TOUT ce qui arrive sur /cs2/logs comme du texte brut
      type: () => true,
      limit: '2mb',
    }),
  );

  // ==> Ajoute un prefix global pour TOUTE l’API…
  // … mais EXCLUT explicitement l’endpoint des logs pour le garder sans /api
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'cs2/logs', method: RequestMethod.ALL },
      { path: 'cs2/logs/(.*)', method: RequestMethod.ALL }, // si tu as des sous-routes
    ],
  });

  // (Optionnel) CORS si tu as un front séparé
  // app.enableCors({ origin: true, credentials: true });
  app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
  await app.listen(8081);
}
bootstrap();