import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it('defaults safely to loopback, never uniquelocal', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback');
    expect(parseTrustProxy('  ')).toBe('loopback');
    expect(parseTrustProxy(undefined)).not.toBe('uniquelocal');
  });

  it('parses a comma-separated list', () => {
    expect(parseTrustProxy('127.0.0.1, 172.20.0.5/32, linklocal')).toEqual(['127.0.0.1', '172.20.0.5/32', 'linklocal']);
  });

  it('accepts a numeric hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
  });
});
