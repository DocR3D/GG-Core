import { MatchCommandsService } from '@app/commands/match-commands.service';
// application/shared/periodic/periodic-messenger.service.ts
import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { PeriodicScheduler } from './periodic-scheduler.service';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { ModuleRef } from '@nestjs/core';

export type ComputeResult = { text: string } | { stop: true };
export type ComputeFn = () => Promise<ComputeResult>;

export interface MessageSpec {
  id: string;
  intervalMs: number;
  serverId: string;
  compute: ComputeFn;
  lockKey?: string;
  lockTtlSec?: number; // utilisé comme "ttl de sécurité" par tick
}

@Injectable()
export class PeriodicMessenger implements OnModuleInit {
  private readonly logger = new Logger(PeriodicMessenger.name);
  private commands!: MatchCommandsService;   // 👈 lazy

  constructor(
    private readonly scheduler: PeriodicScheduler,
    private readonly moduleRef: ModuleRef,   // 👈 injection moduleRef
    @Inject(REDIS_CMD) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    this.commands = this.moduleRef.get(MatchCommandsService, { strict: false });
  }

  schedule(spec: MessageSpec) {
    const { id, intervalMs, serverId, compute, lockKey } = spec;

    // TTL de lock = ~ moitié de l'intervalle, min 5s (évite collisions si tick lent)
    const lockTtlSec = Math.max(5, Math.floor(intervalMs / 1000 / 2));

    this.logger.log(`[schedule] id=${id} intervalMs=${intervalMs} serverId=${serverId} lockKey=${lockKey ?? '-'}`);

    this.scheduler.startEvery(id, intervalMs, async () => {
      // 1) Acquire lock (par tick)
      if (lockKey) {
        let ok: any;
        try {
          ok = await (this.redis as any).set(lockKey, String(Date.now()), 'NX', 'EX', lockTtlSec);
        } catch (e) {
          this.logger.error(`[lock] id=${id} SET NX EX failed: ${(e as Error)?.message}`);
          return;
        }
        if (ok !== 'OK') {
          this.logger.debug(`[lock] id=${id} busy -> skip tick`);
          return;
        }
        this.logger.debug(`[lock] id=${id} acquired ttl=${lockTtlSec}s`);
      }

      try {
        // 2) Compute
        const res = await compute();
        if ('stop' in res) {
          this.logger.log(`[compute] id=${id} -> stop requested`);
          this.scheduler.stop(id);
          // on libère immédiatement le lock
          if (lockKey) await this.redis.del(lockKey).catch(() => {});
          return;
        }

        // 3) Say
        this.logger.debug(`[say] id=${id} -> "${res.text}"`);
        await this.commands.say( serverId,  res.text);
        this.logger.debug(`[say] id=${id} OK`);
      } catch (e) {
        this.logger.error(`[tick] id=${id} error: ${(e as Error)?.message}`, e as any);
      } finally {
        // 4) Release lock pour laisser le prochain tick repartir
        if (lockKey) {
          try {
            await this.redis.del(lockKey);
            this.logger.debug(`[lock] id=${id} released`);
          } catch (e) {
            this.logger.warn(`[lock] id=${id} release failed: ${(e as Error)?.message}`);
          }
        }
      }
    });
  }

  cancel(id: string, lockKey?: string) {
    this.logger.log(`[cancel] id=${id} lockKey=${lockKey ?? '-'}`);
    this.scheduler.stop(id);
    if (lockKey) this.redis.del(lockKey).catch(() => {});
  }
}
// petit helper commun
export const fmtMmSs = (totalSec: number) => {
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};