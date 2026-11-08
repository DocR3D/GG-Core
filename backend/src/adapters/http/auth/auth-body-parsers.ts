import { json, urlencoded } from 'express';
import type { RequestHandler } from 'express';

type MiddlewareApp = { use(path: string, handler: RequestHandler): unknown };

/** Keep both the legacy HTML form and the JSON login payload available under /auth. */
export function installAuthBodyParsers(app: MiddlewareApp): void {
  app.use('/auth', urlencoded({ extended: false }));
  app.use('/auth', json({ limit: '16kb' }));
}
