// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true }));
  app.use(
  '/cs2/logs',
  bodyParser.text({
    // traite TOUT ce qui arrive sur /cs2/logs comme du texte brut
    type: () => true,
    limit: '2mb',
  }),
);
  await app.listen(8081);
}
bootstrap();
