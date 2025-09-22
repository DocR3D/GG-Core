import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';

export type Logical = 'home' | 'away';

const DEC_IF_POS_LUA = `
  local key = KEYS[1]
  local field = ARGV[1]
  local cur = redis.call('HGET', key, field)
  if not cur then return -1 end
  cur = tonumber(cur)
  if cur <= 0 then return 0 end
  redis.call('HINCRBY', key, field, -1)
  return cur - 1
`;

@Injectable()
export class TimeoutsService {
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  async initTimeouts(
    matchId: string,
    homeTac = 4,
    awayTac = 4,
    homeTech = 0,
    awayTech = 0,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const key = redisConst.timeouts(matchId);
    const t = await this.redis.type(key);

    if (opts.force) {
      if (t !== 'none') await this.redis.del(key);
    } else {
      if (t !== 'none') return; // déjà init, on ne touche pas
    }

    await this.redis.hset(key, {
      homeTac: String(homeTac),
      awayTac: String(awayTac),
      homeTech: String(homeTech),
      awayTech: String(awayTech),
    });
  }

  /** Décrémente un timeout tactique. Retour: -1 absent, 0 épuisé, >0 nouveau solde */
  async decrTac(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}Tac`;
    const remain = await this.redis.eval(DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  /** Décrémente un timeout technique. */
  async decrTech(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}Tech`;
    const remain = await this.redis.eval(DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  async getTimeouts(matchId: string): Promise<{ homeTac: number; awayTac: number; homeTech: number; awayTech: number }> {
    const res = await this.redis.hgetall(redisConst.timeouts(matchId));
    const toInt = (v?: string) => (v ? parseInt(v, 10) : 0);
    return {
      homeTac: toInt(res?.homeTac),
      awayTac: toInt(res?.awayTac),
      homeTech: toInt(res?.homeTech),
      awayTech: toInt(res?.awayTech),
    };
  }
}
