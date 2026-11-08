import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

/** Where the documentation is served: the page, and the OpenAPI document it shows. */
export const API_DOCS_PATH = 'api/docs';
export const API_DOCS_JSON_PATH = 'api/docs-json';

/** The documentation exists only when GG_API_DOCS=1 (the dev compose sets it; nothing else does). */
export function docsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GG_API_DOCS === '1';
}

/** The OpenAPI document of the application (same builder for the page and for the export). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('GG-Core API')
    .setDescription('REST API of GG-Core (CS2 match and tournament manager). Admin routes need a session cookie or `Authorization: Bearer <GG_ADMIN_TOKEN>`.')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Serves the Swagger UI on /api/docs and the document on /api/docs-json, when GG_API_DOCS=1. Nothing is registered
 * otherwise: the routes answer 404 for everybody, an admin included. When it is on, the access middleware keeps both
 * for admins only (see isPublic). Call it after the global prefix is set.
 */
export function mountApiDocs(app: INestApplication, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!docsEnabled(env)) return false;
  SwaggerModule.setup(API_DOCS_PATH, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: API_DOCS_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
  });
  return true;
}
