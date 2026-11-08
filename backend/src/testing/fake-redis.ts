export interface FakeMulti {
  del(...keys: string[]): FakeMulti;
  set(key: string, value: string, ...args: Array<string | number>): FakeMulti;
  rpush(key: string, ...values: string[]): FakeMulti;
  sadd(key: string, ...members: string[]): FakeMulti;
  hset(key: string, fieldOrObject: string | Record<string, string | number>, value?: string | number): FakeMulti;
  exec(): Promise<Array<[null, unknown]>>;
}

/**
 * A small in-memory stand-in for ioredis, for unit tests of the services that keep their state in Redis hashes and
 * strings (pause, banks, flags). It is NOT a mock of one method at a time: the service runs against real data, so a
 * test fails when the state it leaves behind is wrong (which a mocked `hget` cannot show).
 *
 * Supported: hget, hgetall, hset (object or field + value), hsetnx, hdel, get, set (NX), rpush, lrange, sadd,
 * sismember, smembers, del, exists, multi (del / set / rpush / sadd / hset, then exec), expire (ignored).
 */
export class FakeRedis {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly sets = new Map<string, Set<string>>();

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

  rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return Promise.resolve(list.length);
  }

  /** Same bounds as Redis: `stop` -1 means "to the end". */
  lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return Promise.resolve(list.slice(start, stop === -1 ? undefined : stop + 1));
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) added += 1;
      set.add(m);
    }
    this.sets.set(key, set);
    return Promise.resolve(added);
  }

  sismember(key: string, member: string): Promise<number> {
    return Promise.resolve(this.sets.get(key)?.has(member) ? 1 : 0);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) removed += 1;
      if (this.hashes.delete(k)) removed += 1;
      if (this.lists.delete(k)) removed += 1;
      if (this.sets.delete(k)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  exists(...keys: string[]): Promise<number> {
    return Promise.resolve(
      keys.filter((k) => this.strings.has(k) || this.hashes.has(k) || this.lists.has(k) || this.sets.has(k)).length,
    );
  }

  /** MULTI / EXEC: the chained commands are queued, then run in order by `exec()` (no isolation needed in a test). */
  multi(): FakeMulti {
    const queue: Array<() => Promise<unknown>> = [];
    const tx: FakeMulti = {
      del: (...keys) => (queue.push(() => this.del(...keys)), tx),
      set: (key, value, ...args) => (queue.push(() => this.set(key, value, ...args)), tx),
      rpush: (key, ...values) => (queue.push(() => this.rpush(key, ...values)), tx),
      sadd: (key, ...members) => (queue.push(() => this.sadd(key, ...members)), tx),
      hset: (key, fieldOrObject, value) => (queue.push(() => this.hset(key, fieldOrObject, value)), tx),
      exec: async () => {
        const results: Array<[null, unknown]> = [];
        for (const op of queue) results.push([null, await op()]);
        return results;
      },
    };
    return tx;
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }
}
