import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_PUB } from '@adapters/redis/redis.tokens';

@Injectable()
export class BusPublisher {
  constructor(@Inject(REDIS_PUB) private readonly pub: Redis) {}

  async publish(channel: string, payload: unknown): Promise<number> {
    return this.pub.publish(channel, JSON.stringify(payload));
  }
}
