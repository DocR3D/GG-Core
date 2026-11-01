// src/application/commands/match-commands.service.ts
import { Injectable, Logger, Inject, BadRequestException, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { GameSide } from '../match/state/match-state.service';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';

import { redisConst, REDIS_CHANNELS } from '../match/state/redis.keys';
import * as crypto from 'crypto';
import { PauseMatchService } from '@app/match/pause/pause.service';
import { MatchPhase } from '@domain/phase.types';

type Actor = { name: string; steamId?: string; teamSide: GameSide; channel?: 'say' | 'say_team' };
/** Who asked for the action: a player in the chat, an admin, or GG-Core itself (logged by the agent). */
type AgentSource = { via: 'chat'; player: Actor } | { via: 'admin' } | { via: 'system' };

type AgentActionBase = { id: string; ts: number; type: 'action'; serverId: string; source?: AgentSource };
type AgentAction = AgentActionBase &
  (
    | { action: 'pause'; payload: { matchId: string } }
    | { action: 'unpause'; payload: { matchId: string; teamSide?: GameSide } }
    | { action: 'say'; payload: { text: string } }
    | { action: 'exec_cfg'; payload: { matchId: string; name: string; vars?: Record<string, string> } }
    | { action: 'rcon'; payload: { text: string } }
    | { action: 'kick_all'; payload: { text: string } }
    | { action: 'restart'; payload: { matchId: string; delay?: number } }
    | { action: 'changelevel'; payload: { map: string } }
  );

function uuid() {
  return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
}

interface InitOpts {
  phase?: MatchPhase;
  map?: string;
  seriesBestOf?: 1 | 3 | 5;
  reset?: boolean;
}

/** The actions sent to a server's agent (RCON on its side), and the Redis init of a match started from the chat. */
@Injectable()
export class MatchCommandsService {
  private readonly logger = new Logger(MatchCommandsService.name);

  constructor(
    @Inject(forwardRef(() => MatchPhaseService))
    private readonly mps: MatchPhaseService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(REDIS_PUB) private readonly pub: Redis,
    @Inject(forwardRef(() => PauseMatchService)) private readonly pauseMatchService: PauseMatchService,
  ) {}

  // --------- Helpers

  private async publishToAgent(serverId: string, msg: AgentAction) {
    await this.pub.publish(REDIS_CHANNELS.agentActions(serverId), JSON.stringify(msg));
    this.logger.log(`[to-agent/${serverId}] ${msg.action}`);
  }

  private async resolveServerAndMatch(params: { serverId?: string | null; matchId?: string | null }): Promise<{ serverId: string; matchId: string }> {
    let { serverId, matchId } = params;

    if (!serverId && matchId) {
      serverId = await this.redis.get(redisConst.matchServer(matchId));
      if (!serverId) throw new BadRequestException('serverId manquant et introuvable via matchId');
    }
    if (serverId && !matchId) {
      matchId = await this.redis.get(redisConst.serverMatch(serverId));
      if (!matchId) throw new BadRequestException(`matchId introuvable pour serverId=${serverId}`);
    }
    if (!serverId || !matchId) throw new BadRequestException('serverId et/ou matchId manquant');
    return { serverId, matchId };
  }

  // --------- Actions

  async pause(opts: { serverId?: string; matchId?: string }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    // only the order to the agent: the pause state follows the server's log
    await this.publishToAgent(serverId, { id: uuid(), ts: Date.now(), type: 'action', serverId, action: 'pause', payload: { matchId } });
    return { ok: true };
  }

  async unpause(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.publishToAgent(serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'unpause',
      payload: { matchId, teamSide: opts.actor?.teamSide },
      source: opts.actor ? { via: 'chat', player: opts.actor } : { via: 'admin' },
    });
    // the pause ends on GG-Core's side too (state and messages); the phase is left as it is
    await this.pauseMatchService.resume(matchId);
    return { ok: true };
  }

  async say(serverId: string, message: string) {
    if (!serverId) throw new BadRequestException('serverId requis');
    await this.publishToAgent(serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'say',
      payload: { text: message },
      source: { via: 'admin' },
    });
  }

  async exec(opts: { serverId?: string; matchId?: string; cfgName: string; vars?: Record<string, string> }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.publishToAgent(serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'exec_cfg',
      payload: { matchId, name: opts.cfgName, ...(opts.vars ? { vars: opts.vars } : {}) },
      source: { via: 'admin' },
    });
    return { ok: true };
  }

  async rcon(opts: { serverId?: string; matchId?: string; command: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    await this.publishToAgent(opts.serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'rcon',
      payload: { text: opts.command },
      source: { via: 'admin' },
    });
    return { ok: true };
  }

  /** Kicks every human player (the agent reads `status` then sends kickid: CS2 has no kickall). */
  async kickAll(opts: { serverId: string; message: string }) {
    await this.publishToAgent(opts.serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'kick_all',
      payload: { text: opts.message },
      source: { via: 'system' },
    });
    return { ok: true };
  }

  async restart(opts: { serverId?: string; matchId?: string; delay?: number }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.publishToAgent(serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId,
      action: 'restart',
      payload: { matchId, delay: opts.delay ?? 3 },
      source: { via: 'admin' },
    });
    return { ok: true };
  }

  /** !restart and the rules call it by this name. */
  async restartGame(opts: { serverId?: string; matchId?: string; delay?: number }) {
    return this.restart(opts);
  }

  async changeLevel(opts: { serverId: string; map: string }) {
    if (!opts.serverId || !opts.map) throw new BadRequestException('serverId et map requis');
    await this.publishToAgent(opts.serverId, {
      id: uuid(),
      ts: Date.now(),
      type: 'action',
      serverId: opts.serverId,
      action: 'changelevel',
      payload: { map: opts.map },
      source: { via: 'admin' },
    });
    return { ok: true };
  }

  async swapSides(opts: { matchId: string }): Promise<void> {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.rcon({ serverId, matchId, command: 'mp_swapteams' });
  }

  /**
   * Redis state of a match started from the chat (!init), outside a tournament.
   *  - serverId (required), matchId (generated when absent or "unknown")
   *  - mapName (default de_inferno), homeName / awayName (default Home_<slug> / Away_<slug>)
   * Without opts.reset, the values already there are kept (HSETNX / SETNX).
   */
  async ensureInitMatch(serverId: string, matchId?: string, mapName?: string, homeName?: string, awayName?: string, opts: InitOpts = {}) {
    const sid = String(serverId || '').trim();
    if (!sid) throw new BadRequestException('serverId requis');

    // default sides: home = CT, away = T
    const wantHome: GameSide = 'CT';
    const wantAway: GameSide = 'T';

    let mid = String(matchId || '').trim();
    if (!mid || mid === 'unknown') {
      const seed = `${sid}-${Date.now()}`;
      mid = `m-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)}`;
    }

    const slug = mid.slice(2, 6);
    const teams = {
      home: { id: `th-${slug}`, name: (homeName ?? `Home_${slug}`).trim() },
      away: { id: `ta-${slug}`, name: (awayName ?? `Away_${slug}`).trim() },
    };
    const map_name = (mapName ?? opts.map ?? 'de_inferno').trim();

    const now = Date.now();
    const pipe = this.redis.multi();
    const hset = opts.reset
      ? (k: string, f: string, v: string | number) => pipe.hset(k, f, v)
      : (k: string, f: string, v: string | number) => pipe.hsetnx(k, f, v);
    const set = opts.reset ? (k: string, v: string) => pipe.set(k, v) : (k: string, v: string) => pipe.setnx(k, v);

    // server <-> match links: always overwritten
    pipe.set(redisConst.serverMatch(sid), mid);
    pipe.set(redisConst.matchServer(mid), sid);

    hset(redisConst.sides(mid), 'home', wantHome);
    hset(redisConst.sides(mid), 'away', wantAway);

    hset(redisConst.score(mid), 'ct', 0);
    hset(redisConst.score(mid), 't', 0);
    hset(redisConst.score(mid), 'round', 1);
    hset(redisConst.score(mid), 'phase', 'freeze');

    hset(redisConst.timeouts(mid), 'homeTac', 4);
    hset(redisConst.timeouts(mid), 'awayTac', 4);
    hset(redisConst.timeouts(mid), 'homeTech', 0);
    hset(redisConst.timeouts(mid), 'awayTech', 0);

    hset(redisConst.teams(mid), 'home_id', teams.home.id);
    hset(redisConst.teams(mid), 'home_name', teams.home.name);
    hset(redisConst.teams(mid), 'away_id', teams.away.id);
    hset(redisConst.teams(mid), 'away_name', teams.away.name);

    hset(redisConst.map(mid), 'name', map_name);
    hset(redisConst.map(mid), 'set_at', String(now));

    hset(redisConst.clock(mid), 'phaseEndsAt', 0);
    hset(redisConst.clock(mid), 'pauseEndsAt', 0);
    hset(redisConst.clock(mid), 'roundFreezeMs', 15000);
    hset(redisConst.clock(mid), 'tacTimeoutMs', 30000);
    hset(redisConst.clock(mid), 'techTimeoutMs', 0);
    hset(redisConst.clock(mid), 'createdAt', now);

    hset(redisConst.ready(mid), 'home', 0);
    hset(redisConst.ready(mid), 'away', 0);

    set(redisConst.seq(mid), '0');

    await pipe.exec();

    await this.pauseMatchService.initTacBanks(mid);

    this.logger.log(
      `[init] server=${sid} match=${mid} sides=${wantHome}/${wantAway} map=${map_name} phase=${MatchPhase.WARMUP_MAIN} reset=${!!opts.reset}` +
        (opts.seriesBestOf ? ` bo${opts.seriesBestOf}` : ''),
    );

    // straight into warmup
    await this.mps.startPhaseCountdown(mid, MatchPhase.WARMUP_MAIN, 30, sid);

    return { matchId: mid, map: map_name, home: teams.home, away: teams.away };
  }
}
