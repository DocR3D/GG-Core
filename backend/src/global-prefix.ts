import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * The global /api prefix and what stays outside it. One definition for the server (main.ts) and for the OpenAPI export:
 * the exported contract must list the paths the server really answers.
 */
export function applyGlobalPrefix(app: INestApplication): void {
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
      // map veto page and its forms
      { path: 'veto/(.*)', method: RequestMethod.ALL },
    ],
  });
}
