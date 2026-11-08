/**
 * A Redis stand-in for the places that build the whole Nest application without a Redis server (the boot test, the
 * OpenAPI export): every method exists, resolves to undefined, and nothing is ever opened. Not a fake of Redis: for
 * tests that read state back, see FakeRedis.
 */
export function redisStub(): unknown {
  const noop = () => Promise.resolve(undefined);
  return new Proxy(
    {},
    {
      get: (_target, prop) => (prop === 'then' ? undefined : prop === 'duplicate' ? () => redisStub() : noop),
    },
  );
}
