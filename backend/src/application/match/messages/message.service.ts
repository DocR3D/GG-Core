// message.service.ts
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

// 🔁 1) Utilise **tes** types comme source unique de vérité
import {
  MessageMode,
  SaySpec as SpecFromTypes, // = SayUnit | SayUnit[]
  SayUnit,                 // une entrée
} from '../messages/messages.types'; // <-- adapte le chemin si besoin
import { MatchCommandsService } from '@app/commands/match-commands.service';

type SaySpec = SpecFromTypes;

@Injectable()
export class MessageService {
  private readonly logger = new Logger('MessageService');

  private groups = new Map<string, Set<NodeJS.Timeout>>();

  constructor(
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly cmds: MatchCommandsService,
  ) {}

  private groupId(matchId: string, phase: string) {
    return `say:${matchId}:${phase}`;
  }

  public stop(matchId: string, phase: string) {
    const gid = this.groupId(matchId, phase);
    const set = this.groups.get(gid);
    let n = 0;
    if (set) {
      for (const t of set) {
        clearInterval(t);
        clearTimeout(t);
        n++;
      }
      this.groups.delete(gid);
    }
    this.logger.debug(`[STOP] group=${gid} cleared=${n}`);
  }

  public stopAll(matchId: string) {
    let total = 0;
    for (const [gid, set] of Array.from(this.groups.entries())) {
      if (gid.startsWith(`say:${matchId}:`)) {
        for (const t of set) {
          clearInterval(t);
          clearTimeout(t);
          total++;
        }
        this.groups.delete(gid);
        this.logger.debug(`[STOP ALL] group=${gid} cleared=${set.size}`);
      }
    }
    this.logger.debug(`[STOP ALL] match=${matchId} total_cleared=${total}`);
  }

  private addTimer(gid: string, timer: NodeJS.Timeout) {
    let set = this.groups.get(gid);
    if (!set) {
      set = new Set<NodeJS.Timeout>();
      this.groups.set(gid, set);
    }
    set.add(timer);
  }

  // 🔁 2) Accepte SaySpec (unit **ou** array) et normalise
  public start(matchId: string, phase: string, serverId: string, spec: SaySpec) {
    const gid = this.groupId(matchId, phase);

    // anti-doublon
    this.stop(matchId, phase);

    const units: SayUnit[] = Array.isArray(spec) ? spec : [spec];

    for (const u of units) {
      this.logger.debug(`[START] group=${gid} mode=${u.mode}`);
      if (u.mode === MessageMode.Chain) {
        for (const item of u.items) {
          const timer = setInterval(async () => {
            try {
              await this.cmds.say( serverId, item.text );
            } catch (e) {
              this.logger.warn(`[CHAIN] say failed group=${gid} err=${(e as Error).message}`);
            }
          }, Math.max(1000, item.intervalMs));
          this.addTimer(gid, timer);
        }
        continue;
      }

      if (u.mode === MessageMode.Rotate) {
        if (!u.items.length) continue;
        let idx = 0;
        const timer = setInterval(async () => {
          const text = u.items[idx % u.items.length];
          idx++;
          try {
            await this.cmds.say( serverId, text );
          } catch (e) {
            this.logger.warn(`[ROTATE] say failed group=${gid} err=${(e as Error).message}`);
          }
        }, Math.max(1000, u.intervalMs));
        this.addTimer(gid, timer);
        continue;
      }

      if (u.mode === MessageMode.Random) {
        if (!u.items.length) continue;
        const timer = setInterval(async () => {
          const text = u.items[Math.floor(Math.random() * u.items.length)];
          try {
            await this.cmds.say(serverId, text);
          } catch (e) {
            this.logger.warn(`[RANDOM] say failed group=${gid} err=${(e as Error).message}`);
          }
        }, Math.max(1000, u.intervalMs));
        this.addTimer(gid, timer);
        continue;
      }
    }
  }

  // --- Préfixes ---
private prefix(matchId: string, kind: 'phase' | 'pause') {
  return `say:${matchId}:${kind}:`;
}

// --- Stop par préfixe ---
private stopByPrefix(prefix: string) {
  let total = 0;
  for (const [gid, set] of Array.from(this.groups.entries())) {
    if (gid.startsWith(prefix)) {
      for (const t of set) { clearInterval(t); clearTimeout(t); total++; }
      this.groups.delete(gid);
      this.logger.debug(`[STOP by prefix] ${prefix} -> cleared=${set.size}`);
    }
  }
  return total;
}

// --- API groupes PHASE ---
public stopPhaseGroups(matchId: string) {
  return this.stopByPrefix(this.prefix(matchId, 'phase'));
}

public startPhase(matchId: string, phase: string, serverId: string, spec: SaySpec) {
  const gid = `${this.prefix(matchId, 'phase')}${phase}`;
  // anti-doublon : on nettoie uniquement ce groupe
  const set = this.groups.get(gid);
  if (set) { for (const t of set) { clearInterval(t); clearTimeout(t); } this.groups.delete(gid); }
  this.logger.debug(`[START PHASE] group=${gid}`);
  const units: SayUnit[] = Array.isArray(spec) ? spec : [spec];
  for (const u of units) this.planUnit(gid, serverId, u);
}

// --- API groupes PAUSE ---
public stopPauseGroups(matchId: string) {
  return this.stopByPrefix(this.prefix(matchId, 'pause'));
}

public startPause(matchId: string, key: string, serverId: string, spec: SaySpec) {
  const gid = `${this.prefix(matchId, 'pause')}${key}`;
  const set = this.groups.get(gid);
  if (set) { for (const t of set) { clearInterval(t); clearTimeout(t); } this.groups.delete(gid); }
  this.logger.debug(`[START PAUSE] group=${gid}`);
  const units: SayUnit[] = Array.isArray(spec) ? spec : [spec];
  for (const u of units) this.planUnit(gid, serverId, u);
}

// --- Planification commune (réutilise ta logique existante) ---
private planUnit(gid: string, serverId: string, u: SayUnit) {
  if (u.mode === MessageMode.Chain) {
    for (const item of u.items) {
      const timer = setInterval(async () => {
        try { await this.cmds.say( serverId, item.text ); }
        catch (e) { this.logger.warn(`[CHAIN] ${gid} ${String((e as Error).message)}`); }
      }, Math.max(1000, item.intervalMs));
      this.addTimer(gid, timer);
    }
    return;
  }
  if (u.mode === MessageMode.Rotate) {
    if (!u.items.length) return;
    let idx = 0;
    const timer = setInterval(async () => {
      const text = u.items[idx % u.items.length]; idx++;
      try { await this.cmds.say( serverId, text ); }
      catch (e) { this.logger.warn(`[ROTATE] ${gid} ${String((e as Error).message)}`); }
    }, Math.max(1000, u.intervalMs));
    this.addTimer(gid, timer);
    return;
  }
  if (u.mode === MessageMode.Random) {
    if (!u.items.length) return;
    const timer = setInterval(async () => {
      const text = u.items[Math.floor(Math.random() * u.items.length)];
      try { await this.cmds.say( serverId, text ); }
      catch (e) { this.logger.warn(`[RANDOM] ${gid} ${String((e as Error).message)}`); }
    }, Math.max(1000, u.intervalMs));
    this.addTimer(gid, timer);
    return;
  }
}

}
