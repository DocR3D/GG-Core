// adapters/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { REDIS_CMD, REDIS_PUB, REDIS_SUB } from './redis.tokens';

function makeClient(opts: Partial<RedisOptions> = {}): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    ...opts,
  });
}

@Global()
@Module({
  providers: [
    // 1) Client principal
    {
      provide: REDIS_CMD,
      useFactory: (): Redis => makeClient(),
    },
    // 2) PUB
    {
      provide: REDIS_PUB,
      inject: [REDIS_CMD],
      useFactory: (cmd: Redis): Redis =>
        cmd.duplicate({ enableOfflineQueue: true, lazyConnect: false }),
    },
    // 3) SUB
    {
      provide: REDIS_SUB,
      inject: [REDIS_CMD],
      useFactory: (cmd: Redis): Redis =>
        cmd.duplicate({ enableOfflineQueue: true, lazyConnect: false }),
    },
  ],
  exports: [REDIS_CMD, REDIS_PUB, REDIS_SUB],
})
export class RedisModule {}
