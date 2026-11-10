import { isDevMode } from './dev-mode';

describe('isDevMode', () => {
  it('is true for NODE_ENV=development only', () => {
    expect(isDevMode({ NODE_ENV: 'development' })).toBe(true);
  });

  it.each([['production'], ['test'], ['Development'], ['dev'], ['']])('is false for NODE_ENV=%j: development has to be asked for', (value) => {
    expect(isDevMode({ NODE_ENV: value })).toBe(false);
  });

  it('is false when NODE_ENV is not set at all', () => {
    expect(isDevMode({})).toBe(false);
  });

  it('reads the real environment by default', () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(isDevMode()).toBe(true);
      process.env.NODE_ENV = 'production';
      expect(isDevMode()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });
});
