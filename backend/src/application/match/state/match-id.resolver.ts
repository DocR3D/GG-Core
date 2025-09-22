import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';

@Injectable()
export class MatchIdResolver {
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  async resolve(serverId: string, provided?: string | null): Promise<string> {
    const mid = (provided || '').trim();
    if (mid && mid !== 'unknown') return mid;

    if (!serverId) return 'unknown';
    const cur = await this.redis.get(redisConst.serverMatch(serverId));
    return (cur && cur !== 'unknown') ? cur : 'unknown';
  }

  async resolveFromFields(fields: Map<string, string>): Promise<{ serverId: string; matchId: string }> {
    const serverId = (fields.get('serverId') || '').trim();
    const provided = (fields.get('matchId') || '').trim();
    const matchId = await this.resolve(serverId, provided);
    return { serverId, matchId };
  }
}
