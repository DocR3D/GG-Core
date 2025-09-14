// adapters/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { REDIS_CMD, REDIS_PUB, REDIS_SUB } from './redis.tokens';
import { RedisSafeService } from './redis.service';

function makeClient(opts: Partial<RedisOptions> = {}): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // pas de file offline pour le client "cmd"
    ...opts,
  });
}

@Global()
@Module({
  providers: [
    // 1) Client principal (CMD)
    {
      provide: REDIS_CMD,
      useFactory: (): Redis => makeClient(),
    },
    // 2) Client PUB (duplication dédiée)
    {
      provide: REDIS_PUB,
      inject: [REDIS_CMD],
      useFactory: (cmd: Redis): Redis =>
        cmd.duplicate({ enableOfflineQueue: true, lazyConnect: false }),
    },
    // 3) Client SUB (duplication dédiée)
    {
      provide: REDIS_SUB,
      inject: [REDIS_CMD],
      useFactory: (cmd: Redis): Redis =>
        cmd.duplicate({ enableOfflineQueue: true, lazyConnect: false }),
    },
    // 4) Service sécurisé (wrappers + ensure*)
    RedisSafeService,
  ],
  exports: [REDIS_CMD, REDIS_PUB, REDIS_SUB, RedisSafeService],
})
export class RedisModule {}
