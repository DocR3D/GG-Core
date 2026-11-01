// message.service.ts
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { MessageMode, SaySpec, SayUnit } from '../messages/messages.types';
import { MatchCommandsService } from '@app/commands/match-commands.service';

/**
 * Repeated chat messages of a phase (say:{matchId}:phase:{phase}): started when the phase is applied, stopped when it
 * changes. The pause messages have their own service (PeriodicMessenger).
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger('MessageService');

  private groups = new Map<string, Set<NodeJS.Timeout>>();

  constructor(
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly cmds: MatchCommandsService,
  ) {}

  private prefix(matchId: string) {
    return `say:${matchId}:phase:`;
  }

  private clear(gid: string) {
    const set = this.groups.get(gid);
    if (!set) return 0;
    for (const t of set) clearInterval(t);
    this.groups.delete(gid);
    return set.size;
  }

  /** Stops the messages of one phase. */
  public stop(matchId: string, phase: string) {
    const gid = `${this.prefix(matchId)}${phase}`;
    this.logger.debug(`[STOP] group=${gid} cleared=${this.clear(gid)}`);
  }

  /** Stops the messages of every phase of the match. */
  public stopPhaseGroups(matchId: string) {
    let total = 0;
    for (const gid of Array.from(this.groups.keys())) {
      if (gid.startsWith(this.prefix(matchId))) total += this.clear(gid);
    }
    return total;
  }

  public startPhase(matchId: string, phase: string, serverId: string, spec: SaySpec) {
    const gid = `${this.prefix(matchId)}${phase}`;
    this.clear(gid); // no duplicate timers for this phase
    this.logger.debug(`[START PHASE] group=${gid}`);
    const units: SayUnit[] = Array.isArray(spec) ? spec : [spec];
    for (const u of units) this.planUnit(gid, serverId, u);
  }

  private every(gid: string, serverId: string, intervalMs: number, nextText: () => string, mode: string) {
    const timer = setInterval(() => {
      this.cmds.say(serverId, nextText()).catch((e) => this.logger.warn(`[${mode}] ${gid} ${String((e as Error).message)}`));
    }, Math.max(1000, intervalMs));
    let set = this.groups.get(gid);
    if (!set) this.groups.set(gid, (set = new Set<NodeJS.Timeout>()));
    set.add(timer);
  }

  private planUnit(gid: string, serverId: string, u: SayUnit) {
    if (u.mode === MessageMode.Chain) {
      for (const item of u.items) this.every(gid, serverId, item.intervalMs, () => item.text, 'CHAIN');
      return;
    }
    if (!u.items.length) return;
    if (u.mode === MessageMode.Rotate) {
      let idx = 0;
      this.every(gid, serverId, u.intervalMs, () => u.items[idx++ % u.items.length], 'ROTATE');
      return;
    }
    if (u.mode === MessageMode.Random) {
      this.every(gid, serverId, u.intervalMs, () => u.items[Math.floor(Math.random() * u.items.length)], 'RANDOM');
    }
  }
}
