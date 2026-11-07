/**
 * A small in-memory stand-in for ioredis, for unit tests of the services that keep their state in Redis hashes and
 * strings (pause, banks, flags). It is NOT a mock of one method at a time: the service runs against real data, so a
 * test fails when the state it leaves behind is wrong (which a mocked `hget` cannot show).
 *
 * Supported: hget, hgetall, hset (object or field + value), hsetnx, hdel, get, set (NX), del, expire (ignored).
 */
export class FakeRedis {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly strings = new Map<string, string>();

  private hash(key: string): Map<string, string> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }

  hget(key: string, field: string): Promise<string | null> {
    return Promise.resolve(this.hashes.get(key)?.get(field) ?? null);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []));
  }

  hset(key: string, fieldOrObject: string | Record<string, string | number>, value?: string | number): Promise<number> {
    const h = this.hash(key);
    const entries: Array<[string, string | number]> =
      typeof fieldOrObject === 'string' ? [[fieldOrObject, value as string | number]] : Object.entries(fieldOrObject);
    let added = 0;
    for (const [f, v] of entries) {
      if (!h.has(f)) added += 1;
      h.set(f, String(v));
    }
    return Promise.resolve(added);
  }

  hsetnx(key: string, field: string, value: string): Promise<number> {
    const h = this.hash(key);
    if (h.has(field)) return Promise.resolve(0);
    h.set(field, value);
    return Promise.resolve(1);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    const h = this.hashes.get(key);
    let removed = 0;
    for (const f of fields) if (h?.delete(f)) removed += 1;
    return Promise.resolve(removed);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    if (args.includes('NX') && this.strings.has(key)) return Promise.resolve(null);
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) removed += 1;
      if (this.hashes.delete(k)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }
}
