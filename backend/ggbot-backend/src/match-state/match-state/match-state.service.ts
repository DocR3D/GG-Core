import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

export type Sides = { home: 'CT'|'T'; away: 'CT'|'T' };

@Injectable()
export class MatchStateService {
  
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1, enableOfflineQueue: false,
  });

  async setServerMatch(serverId: string, matchId: string) {
    await this.redis.set(`server:${serverId}:matchId`, matchId);
  }
  async getServerMatch(serverId: string): Promise<string|null> {
    return (await this.redis.get(`server:${serverId}:matchId`)) as string|null;
  }

  async setSides(matchId: string, sides: Sides) {
    await this.redis.set(`match:${matchId}:sides`, JSON.stringify(sides));
  }
  async getSides(matchId: string): Promise<Sides|null> {
    const s = await this.redis.get(`match:${matchId}:sides`);
    return s ? JSON.parse(s) as Sides : null;
  }

  async initTimeouts(matchId: string, homeTac = 4, awayTac = 4) {
    await this.redis.hset(`match:${matchId}:timeouts`, {
      home_tac: String(homeTac),
      away_tac: String(awayTac),
      home_tech: '0',
      away_tech: '0',
    });
  }
  async initScore(matchId: string) {
    const key = `match:${matchId}:score`;
    await this.redis.hset(
      key,
      't', '0',
      'ct', '0',
      'round', '1',
      'phase', 'freeze'
    );
  }

  async setPhase(matchId: string, phase: 'freeze'|'live'|'intermission'|'ended') {
  await this.redis.hset(`match:${matchId}:score`, { phase });
}
async incRound(matchId: string) {
  await this.redis.hincrby(`match:${matchId}:score`, 'round', 1);
}
async addPoint(matchId: string, winner: 'T'|'CT') {
  const field = winner === 'T' ? 't' : 'ct';
  await this.redis.hincrby(`match:${matchId}:score`, field, 1);
}

async getScore(matchId: string): Promise<{ t: number; ct: number }> {
  const key = `match:${matchId}:score`;
  const [t, ct] = await this.redis.hmget(key, 't', 'ct'); // (string|null)[]
  const toInt = (v: string | null) => (v === null ? 0 : Number.parseInt(v, 10) || 0);
  return { t: toInt(t), ct: toInt(ct) };
}


  // Lua: décrémenter si > 0 (atomique)
  private static decrIfPositive = `
    local key = KEYS[1]
    local field = ARGV[1]
    local cur = redis.call('HGET', key, field)
    if not cur then return -1 end
    cur = tonumber(cur)
    if cur <= 0 then return 0 end
    redis.call('HINCRBY', key, field, -1)
    return cur - 1
  `;
  async decrTac(matchId: string, logicalTeam: 'home'|'away'): Promise<number> {
    const key = `match:${matchId}:timeouts`;
    const field = `${logicalTeam}_tac`;
    const remain = await this.redis.eval(MatchStateService.decrIfPositive, 1, key, field);
    return Number(remain); // -1=absent, 0=aucun restant, >0=nouvelle valeur
  }
}
