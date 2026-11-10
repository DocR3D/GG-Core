/**
 * The API documentation page: mounted in the dev and rec modes (never in prod), and then reserved for admins. The tests run it behind the
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
  it.each(['dev', 'rec'])('is open in the %s mode', (GG_ENV) => {
    expect(docsEnabled({ GG_ENV })).toBe(true);
  });

  it('is closed in prod, and when the mode is missing or unknown (that is prod)', () => {
    for (const GG_ENV of ['prod', undefined, '', 'staging']) expect(docsEnabled({ GG_ENV })).toBe(false);
  });

  it('nothing opens it in prod, not even GG_API_DOCS=1', () => {
    expect(docsEnabled({ GG_ENV: 'prod', GG_API_DOCS: '1' })).toBe(false);
    expect(docsEnabled({ GG_API_DOCS: '1' })).toBe(false);
  });

  it.each(['dev', 'rec'])('GG_API_DOCS=0 closes it in the %s mode', (GG_ENV) => {
    expect(docsEnabled({ GG_ENV, GG_API_DOCS: '0' })).toBe(false);
    expect(docsEnabled({ GG_ENV, GG_API_DOCS: '1' })).toBe(true);
  });
});

describe('API documentation page', () => {
  it('in prod: nothing is mounted, the routes do not exist, not even for an admin', async () => {
    const { app, base, mounted } = await boot({ GG_ENV: 'prod' });
    expect(mounted).toBe(false);
    expect((await get(base, '/api/docs', { authorization: 'Bearer adm' })).status).toBe(404);
    expect((await get(base, '/api/docs-json', { authorization: 'Bearer adm' })).status).toBe(404);
    await app.close();
  });

  it('in dev: 401 without login, 200 for an admin (page and document), other public reads unchanged', async () => {
    const { app, base, mounted } = await boot({ GG_ENV: 'dev' });
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
