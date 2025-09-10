import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';

@Injectable()
export class SeqService {
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  /** Incrémente et retourne la séquence globale du match */
  async next(matchId: string): Promise<number> {
    return this.redis.incr(`match:${matchId}:seq`);
  }

  /** Lis la valeur courante (0 si absente) */
  async current(matchId: string): Promise<number> {
    const v = await this.redis.get(`match:${matchId}:seq`);
    return v ? Number(v) : 0;
  }

  /** Remet la séquence du match à zéro (optionnel) */
  async reset(matchId: string): Promise<void> {
    await this.redis.del(`match:${matchId}:seq`);
  }
}
