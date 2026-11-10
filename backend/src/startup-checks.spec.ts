import { assertStartupAllowed, startupProblems } from './startup-checks';

describe('startupProblems', () => {
  it('has nothing to say in a normal setup, whatever the mode', () => {
    for (const GG_ENV of ['dev', 'rec', 'prod', undefined]) expect(startupProblems({ GG_ENV })).toEqual([]);
  });

  it('lets the authentication be switched off in the dev mode', () => {
    expect(startupProblems({ GG_ENV: 'dev', AUTH_DISABLED: '1' })).toEqual([]);
  });

  it.each(['rec', 'prod', '', 'staging', undefined])('refuses AUTH_DISABLED=1 when the mode is %j, and names the mode', (GG_ENV) => {
    const [problem, ...others] = startupProblems({ GG_ENV, AUTH_DISABLED: '1' });

    expect(others).toEqual([]);
    expect(problem).toContain('AUTH_DISABLED=1');
    expect(problem).toContain(`GG_ENV is "${GG_ENV === 'rec' ? 'rec' : 'prod'}"`);
  });

  it.each(['', '0', 'true'])('does not mind AUTH_DISABLED=%j, which does not switch anything off', (AUTH_DISABLED) => {
    expect(startupProblems({ GG_ENV: 'prod', AUTH_DISABLED })).toEqual([]);
  });
});

describe('assertStartupAllowed', () => {
  it('does nothing when there is no problem', () => {
    expect(() => assertStartupAllowed({ GG_ENV: 'prod' })).not.toThrow();
  });

  it('throws, with the reason, so that the backend does not start', () => {
    expect(() => assertStartupAllowed({ GG_ENV: 'prod', AUTH_DISABLED: '1' })).toThrow(/AUTH_DISABLED=1.*GG_ENV=dev/);
  });

  it('reads the real environment by default', () => {
    const before = { auth: process.env.AUTH_DISABLED, env: process.env.GG_ENV };
    try {
      process.env.AUTH_DISABLED = '1';
      process.env.GG_ENV = 'prod';
      expect(() => assertStartupAllowed()).toThrow();
      process.env.GG_ENV = 'dev';
      expect(() => assertStartupAllowed()).not.toThrow();
    } finally {
      if (before.auth === undefined) delete process.env.AUTH_DISABLED;
      else process.env.AUTH_DISABLED = before.auth;
      if (before.env === undefined) delete process.env.GG_ENV;
      else process.env.GG_ENV = before.env;
    }
  });
});
