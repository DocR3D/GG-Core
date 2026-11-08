/**
 * The API documentation page: mounted only when GG_API_DOCS=1, and then reserved for admins. The tests run it behind the
 * REAL AuthMiddleware (only the AuthService is replaced), so they check the rule of isPublic end to end.
 */
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { AuthMiddleware } from '../auth/auth.middleware';
import type { AuthService, Session } from '@app/auth/auth.service';
import { docsEnabled, mountApiDocs } from './api-docs';

@Controller('api/ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

const admin: Session = { sub: 'admin-token', role: 'admin', name: 'admin (token)', via: 'token' };
const auth = {
  disabled: false,
  sessionFromBearer: (header?: string) => (header === 'Bearer adm' ? admin : null),
  sessionFromCookie: () => null,
} as unknown as AuthService;

async function boot(env: NodeJS.ProcessEnv): Promise<{ app: INestApplication; base: string; mounted: boolean }> {
  const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
  const app = moduleRef.createNestApplication();
  const access = new AuthMiddleware(auth);
  app.use((req: Request, res: Response, next: NextFunction) => access.use(req, res, next)); // before the docs routes, as in main.ts
  const mounted = mountApiDocs(app, env);
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${port}`, mounted };
}

async function get(base: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, type: res.headers.get('content-type') ?? '' };
}

describe('docsEnabled', () => {
  it('is on only for GG_API_DOCS=1', () => {
    expect(docsEnabled({ GG_API_DOCS: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes']) expect(docsEnabled({ GG_API_DOCS: value })).toBe(false);
  });
});

describe('API documentation page', () => {
  it('switched off (the default): nothing is mounted, the routes do not exist, not even for an admin', async () => {
    const { app, base, mounted } = await boot({});
    expect(mounted).toBe(false);
    expect((await get(base, '/api/docs', { authorization: 'Bearer adm' })).status).toBe(404);
    expect((await get(base, '/api/docs-json', { authorization: 'Bearer adm' })).status).toBe(404);
    await app.close();
  });

  it('switched on: 401 without login, 200 for an admin (page and document), other public reads unchanged', async () => {
    const { app, base, mounted } = await boot({ GG_API_DOCS: '1' });
    expect(mounted).toBe(true);
    for (const path of ['/api/docs', '/api/docs-json']) expect((await get(base, path)).status).toBe(401);
    const page = await get(base, '/api/docs', { authorization: 'Bearer adm' });
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    const document = await get(base, '/api/docs-json', { authorization: 'Bearer adm' });
    expect(document.status).toBe(200);
    expect(document.type).toContain('application/json');
    expect((await get(base, '/api/ping')).status).toBe(200);
    await app.close();
  });
});
