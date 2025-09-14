// src/adapters/redis/redis-safe.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from './redis.tokens';

@Injectable()
export class RedisSafeService {
  private readonly logger = new Logger(RedisSafeService.name);
  constructor(@Inject(REDIS_CMD) private readonly r: Redis) {}

  async ensureHash(key: string) {
    const t = await this.r.type(key);
    if (t !== 'hash' && t !== 'none') await this.r.del(key);
  }
  async ensureString(key: string) {
    const t = await this.r.type(key);
    if (t !== 'string' && t !== 'none') await this.r.del(key);
  }

  async hgetall(key: string) {
    try { return await this.r.hgetall(key); }
    catch (e:any) { await this.logType('hgetall', key, e); throw e; }
  }
  async hset(key: string, obj: Record<string, any>) {
    try { return await this.r.hset(key, obj); }
    catch (e:any) { await this.logType('hset', key, e); throw e; }
  }
  async get(key: string) {
    try { return await this.r.get(key); }
    catch (e:any) { await this.logType('get', key, e); throw e; }
  }
  async set(key: string, val: string) {
    try { return await this.r.set(key, val); }
    catch (e:any) { await this.logType('set', key, e); throw e; }
  }

  private async logType(op: string, key: string, e: any) {
    const t = await this.r.type(key).catch(()=> 'err');
    this.logger.error(`[redis:${op}] key=${key} type=${t} err=${e?.message}`);
  }
}
