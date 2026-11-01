// shared/periodic/periodic-scheduler.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PeriodicMessage } from './periodic-message.types';

@Injectable()
export class PeriodicScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(PeriodicScheduler.name);
  private timers = new Map<string, NodeJS.Timeout>(); // id -> timer

  start(job: PeriodicMessage) {
    this.stop(job.id); // idempotent
    const run = () => {
      Promise.resolve()
        .then(() => job.tick())
        .catch((e) => this.logger.warn(`periodic job ${job.id} failed: ${String(e)}`))
        .finally(() => {
          // replanifie si toujours enregistré
          if (this.timers.has(job.id)) {
            this.timers.set(job.id, setTimeout(run, job.intervalMs));
          }
        });
    };
    this.timers.set(job.id, setTimeout(run, 0)); // 1er tick immédiat
  }

  stop(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
    startEvery(id: string, intervalMs: number, tick: () => Promise<void> | void) {
        this.start({ id, intervalMs, tick });
    }
}
