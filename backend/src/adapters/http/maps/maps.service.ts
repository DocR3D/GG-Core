// src/adapters/http/maps/maps.service.ts
import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';

export type MapEntry = { id: string; name: string };

const MAP_POOL_KEY = 'mappool';
const CONFIG_PATH = join(process.cwd(), 'config', 'maps.json');

@Injectable()
export class MapsService implements OnModuleInit {
  private readonly logger = new Logger(MapsService.name);

  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  private loadConfig(): MapEntry[] {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as MapEntry[];
  }

  private async seed(): Promise<void> {
    const maps = this.loadConfig();
    await this.redis.del(MAP_POOL_KEY);
    const pipeline = this.redis.pipeline();
    for (const map of maps) {
      pipeline.hset(MAP_POOL_KEY, map.id, map.name);
    }
    await pipeline.exec();
    this.logger.log(`Map pool chargée : ${maps.length} maps depuis ${CONFIG_PATH}`);
  }

  async findAll(): Promise<MapEntry[]> {
    const raw = await this.redis.hgetall(MAP_POOL_KEY);
    return Object.entries(raw).map(([id, name]) => ({ id, name }));
  }

  async add(id: string, name: string): Promise<MapEntry> {
    await this.redis.hset(MAP_POOL_KEY, id, name);
    return { id, name };
  }

  async remove(id: string): Promise<void> {
    await this.redis.hdel(MAP_POOL_KEY, id);
  }
}
