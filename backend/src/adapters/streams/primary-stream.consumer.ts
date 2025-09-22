import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from '@app/match/state/redis.keys';

type OnMessage = (fields: Map<string,string>) => Promise<void>;

@Injectable()
export class PrimaryConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(PrimaryConsumer.name);
  private abort?: AbortController;

  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  async ensureGroups(serverIds: string[], group = 'backend') {
    for (const sid of serverIds) {
      const key = redisConst.eventsPrimary(sid);
      try {
        await this.redis.xgroup('CREATE', key, group, '$', 'MKSTREAM');
      } catch (e: any) {
        if (!String(e?.message || e).includes('BUSYGROUP')) throw e;
      }
    }
  }

  run(serverIds: string[], signal: AbortSignal, onMessage: OnMessage, group = 'backend') {
    const consumer = `nest-${process.pid}`;
    const streams  = serverIds.map(redisConst.eventsPrimary);
    this.logger.log(`Streams: ${streams.join(', ')}`);
    (async () => {
      while (!signal.aborted) {
        try {
          const res = await this.redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', 300, 'BLOCK', 2000,
            'STREAMS', ...streams, ...streams.map(() => '>')
          );
          if (!res) continue;

          const acks: Array<[string,string]> = [];
          for (const [stream, entries] of res as any[]) {
            for (const entry of entries as any[]) {
              const id  = entry[0] as string;
              const arr = entry[1] as string[];

              const fields = new Map<string,string>();
              for (let i = 0; i < arr.length; i += 2) fields.set(arr[i], arr[i+1]);

              try { await onMessage(fields); }
              catch (e) { this.logger.warn(`onMessage error: ${String(e)}`); }
              finally { acks.push([stream, id]); }
            }
          }
          if (acks.length) {
            const pipe = this.redis.pipeline();
            for (const [stream, id] of acks) pipe.xack(stream, group, id);
            await pipe.exec();
          }
        } catch (e) {
          if (!signal.aborted) {
            this.logger.error(`loop failure: ${String(e)}`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    })();
  }

  start(serverIds: string[], onMessage: OnMessage, group = 'backend') {
    this.abort = new AbortController();
    this.run(serverIds, this.abort.signal, onMessage, group);
  }

  onModuleDestroy() {
    this.abort?.abort();
  }
}
