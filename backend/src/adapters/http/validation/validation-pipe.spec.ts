import { Body, Controller, INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CreateTeamsDto } from '../tournament/dto/create-teams.dto';
import { createValidationPipe, TolerantValidationPipe, validationMode } from './validation-pipe';

/** The same route as POST /api/tournament/teams, answering what the handler received. */
@Controller('teams')
class TeamsController {
  @Post()
  create(@Body() body: CreateTeamsDto) {
    return { received: body };
  }
}

async function boot(env: NodeJS.ProcessEnv): Promise<{ app: INestApplication; base: string }> {
  const moduleRef = await Test.createTestingModule({ controllers: [TeamsController] }).compile();
  const app = moduleRef.createNestApplication();
  const pipe = createValidationPipe(env);
  if (pipe) app.useGlobalPipes(pipe);
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${port}` };
}

async function post(base: string, body: unknown) {
  const res = await fetch(`${base}/teams`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('validationMode', () => {
  it('follows the mode of the application when nothing is asked: tolerant in dev, strict in rec and prod', () => {
    expect(validationMode({ GG_ENV: 'dev' })).toBe('tolerant');
    expect(validationMode({ GG_ENV: 'rec' })).toBe('strict');
    expect(validationMode({ GG_ENV: 'prod' })).toBe('strict');
    expect(validationMode({})).toBe('strict'); // no mode is prod
  });

  it('follows the mode too for a value it does not know', () => {
    expect(validationMode({ GG_ENV: 'dev', GG_VALIDATION: '' })).toBe('tolerant');
    expect(validationMode({ GG_ENV: 'dev', GG_VALIDATION: 'whatever' })).toBe('tolerant');
    expect(validationMode({ GG_ENV: 'prod', GG_VALIDATION: 'whatever' })).toBe('strict');
  });

  it('is what GG_VALIDATION says, in any mode', () => {
    for (const GG_ENV of ['dev', 'rec', 'prod']) {
      expect(validationMode({ GG_ENV, GG_VALIDATION: 'tolerant' })).toBe('tolerant');
      expect(validationMode({ GG_ENV, GG_VALIDATION: ' STRICT ' })).toBe('strict');
      expect(validationMode({ GG_ENV, GG_VALIDATION: 'off' })).toBe('off');
    }
  });

  it('gives the matching pipe, none when off', () => {
    expect(createValidationPipe({ GG_ENV: 'dev' })).toBeInstanceOf(TolerantValidationPipe);
    expect(createValidationPipe({ GG_VALIDATION: 'off' })).toBeNull();
    expect(createValidationPipe({ GG_VALIDATION: 'strict' })).not.toBeInstanceOf(TolerantValidationPipe);
  });
});

describe('inputs of a described route', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  const invalid: Array<[string, unknown]> = [
    ['an empty list', { names: [] }],
    ['no list', {}],
    ['a number in the list', { names: [1] }],
  ];

  it('tolerant: a valid body goes through and nothing is logged', async () => {
    const { app, base } = await boot({ GG_ENV: 'dev' });
    expect(await post(base, { names: ['Alpha'] })).toEqual({ status: 201, body: { received: { names: ['Alpha'] } } });
    expect(warn).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(invalid)('tolerant: %s goes through unchanged and the broken rule is logged (never the value)', async (_label, body) => {
    const { app, base } = await boot({ GG_ENV: 'dev' });
    const answer = await post(base, body);
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ received: body }); // exactly what was sent, nothing converted or stripped
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[tolerant\] CreateTeamsDto \(body\) would be refused: .*names/);
    await app.close();
  });

  it.each(invalid)('strict: %s is refused with a 400 listing the rules', async (_label, body) => {
    const { app, base } = await boot({ GG_VALIDATION: 'strict' });
    const answer = await post(base, body);
    expect(answer.status).toBe(400);
    expect(Array.isArray(answer.body.message)).toBe(true); // the front already joins such a list (api.ts)
    expect(warn).not.toHaveBeenCalled();
    await app.close();
  });

  it('strict: a valid body still goes through', async () => {
    const { app, base } = await boot({ GG_VALIDATION: 'strict' });
    expect((await post(base, { names: ['Alpha', 'Bravo'] })).status).toBe(201);
    await app.close();
  });

  it('off: nothing is checked', async () => {
    const { app, base } = await boot({ GG_VALIDATION: 'off' });
    expect((await post(base, {})).status).toBe(201);
    expect(warn).not.toHaveBeenCalled();
    await app.close();
  });
});
