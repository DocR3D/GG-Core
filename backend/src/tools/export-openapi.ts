/**
 * Writes the OpenAPI document of the application to a file, without starting a server: `npm run openapi:export [file]`
 * (default `openapi.json` in the current folder). It runs from `dist/` after `nest build`, because the @nestjs/swagger
 * compiler plugin (nest-cli.json) only acts at build time: it is what reads the types and comments of the DTO classes.
 * Redis is replaced by a stub and PostgreSQL is not connected (that happens on module init, which is not run here).
 */
import { Test } from '@nestjs/testing';
import { writeFileSync } from 'fs';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { applyGlobalPrefix } from '../global-prefix';
import { buildOpenApiDocument } from '../adapters/http/docs/api-docs';
import { REDIS_CMD, REDIS_PUB, REDIS_SUB } from '../adapters/redis/redis.tokens';
import { redisStub } from '../testing/redis-stub';

export async function exportOpenApi(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS_CMD).useValue(redisStub())
    .overrideProvider(REDIS_PUB).useValue(redisStub())
    .overrideProvider(REDIS_SUB).useValue(redisStub())
    .compile();
  const app = moduleRef.createNestApplication();
  applyGlobalPrefix(app);
  const document = buildOpenApiDocument(app);
  await app.close();
  return document;
}

if (require.main === module) {
  const file = process.argv[2] ?? 'openapi.json';
  exportOpenApi().then(
    (document) => {
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
      console.log(`OpenAPI document written to ${file} (${Object.keys(document.paths).length} paths)`);
      process.exit(0);
    },
    (error: unknown) => {
      console.error('OpenAPI export failed', error);
      process.exit(1);
    },
  );
}
