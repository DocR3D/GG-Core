import { appMode, isDevMode } from './app-mode';

describe('appMode', () => {
  it.each([
    ['dev', 'dev'],
    ['rec', 'rec'],
    ['prod', 'prod'],
    [' DEV ', 'dev'],
    ['Rec', 'rec'],
  ] as const)('reads GG_ENV=%j as %s', (value, mode) => {
    expect(appMode({ GG_ENV: value })).toBe(mode);
  });

  it.each([[undefined], [''], ['  '], ['development'], ['production'], ['staging'], ['1']])(
    'is prod for GG_ENV=%j: a missing or unknown value never opens a development tool',
    (value) => {
      expect(appMode({ GG_ENV: value })).toBe('prod');
    },
  );

  it('does not look at NODE_ENV: it is for Node, not for the mode', () => {
    expect(appMode({ NODE_ENV: 'development' })).toBe('prod');
    expect(appMode({ NODE_ENV: 'production', GG_ENV: 'dev' })).toBe('dev');
  });

  it('reads the real environment by default', () => {
    const before = process.env.GG_ENV;
    try {
      process.env.GG_ENV = 'rec';
      expect(appMode()).toBe('rec');
      delete process.env.GG_ENV;
      expect(appMode()).toBe('prod');
    } finally {
      if (before === undefined) delete process.env.GG_ENV;
      else process.env.GG_ENV = before;
    }
  });
});

describe('isDevMode', () => {
  it('is true for the dev mode only', () => {
    expect(isDevMode({ GG_ENV: 'dev' })).toBe(true);
    expect(isDevMode({ GG_ENV: 'rec' })).toBe(false);
    expect(isDevMode({ GG_ENV: 'prod' })).toBe(false);
    expect(isDevMode({})).toBe(false);
  });
});
