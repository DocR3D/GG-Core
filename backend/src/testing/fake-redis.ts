export interface FakeMulti {
  del(...keys: string[]): FakeMulti;
  set(key: string, value: string, ...args: Array<string | number>): FakeMulti;
  rpush(key: string, ...values: string[]): FakeMulti;
  sadd(key: string, ...members: string[]): FakeMulti;
  hset(key: string, fieldOrObject: string | Record<string, string | number>, value?: string | number): FakeMulti;
  hincrby(key: string, field: string, by: number): FakeMulti;
  exec(): Promise<Array<[null, unknown]>>;
}

/**
 * A small in-memory stand-in for ioredis, for unit tests of the services that keep their state in Redis hashes and
 * strings (pause, banks, flags). It is NOT a mock of one method at a time: the service runs against real data, so a
 * test fails when the state it leaves behind is wrong (which a mocked `hget` cannot show).
 *
 * Supported: hget, hgetall, hset (object or field + value), hsetnx, hdel, get, set (NX), rpush, lrange, lrem, lpos, sadd,
 * sismember, smembers, hincrby, hmget, mget, keys (glob with *), del, exists, multi (del / set / rpush / sadd / hset /
 * hincrby, then exec), expire (ignored).
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

  hincrby(key: string, field: string, by: number): Promise<number> {
    const h = this.hash(key);
    const next = Number(h.get(field) ?? 0) + by;
    h.set(field, String(next));
    return Promise.resolve(next);
  }

  hmget(key: string, ...fields: string[]): Promise<Array<string | null>> {
    return Promise.resolve(fields.map((f) => this.hashes.get(key)?.get(f) ?? null));
  }

  mget(...keys: string[]): Promise<Array<string | null>> {
    return Promise.resolve(keys.map((k) => this.strings.get(k) ?? null));
  }

  /** Only the `*` wildcard, over every kind of key. */
  keys(pattern: string): Promise<string[]> {
    const literal = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`^${literal.join('.*')}$`);
    const all = [...this.strings.keys(), ...this.hashes.keys(), ...this.lists.keys(), ...this.sets.keys()];
    return Promise.resolve(all.filter((k) => re.test(k)));
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

  /** Removes occurrences of `value` (count 0 = all of them); answers how many were removed. */
  lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key);
    if (!list) return Promise.resolve(0);
    const limit = count === 0 ? Infinity : Math.abs(count);
    const kept: string[] = [];
    let removed = 0;
    for (const item of list) {
      if (item === value && removed < limit) removed += 1;
      else kept.push(item);
    }
    this.lists.set(key, kept);
    return Promise.resolve(removed);
  }

  /** Index of the first `value`, `null` when it is not in the list. */
  lpos(key: string, value: string): Promise<number | null> {
    const index = (this.lists.get(key) ?? []).indexOf(value);
    return Promise.resolve(index === -1 ? null : index);
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
      hincrby: (key, field, by) => (queue.push(() => this.hincrby(key, field, by)), tx),
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
