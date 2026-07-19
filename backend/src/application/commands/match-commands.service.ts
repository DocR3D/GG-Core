// src/application/commands/match-commands.service.ts
import { Injectable, Logger, Inject, BadRequestException, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { GameSide, Logical, MatchStateService } from '../match/state/match-state.service';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';
import { redisConst } from '../match/state/redis.keys';
import * as crypto from 'crypto';
import { PauseMatchService } from '@app/match/pause/pause.service';
import { MatchPhase } from '@domain/phase.types';
import { AgentClientService } from '@app/servers/agent-client.service';

type Actor = { name: string; steamId?: string; teamSide: GameSide; channel?: 'say' | 'say_team' };
type Phase = 'warmup' | 'knife'| 'knife_decision' | 'live' | 'halftime' | 'overtime' | 'postgame';

type NextPhaseContext = {
  knifeEnabled?: boolean;
  halftimePlayed?: boolean;
  needOvertime?: boolean;
};

const DEFAULT_CTX: Required<NextPhaseContext> = {
  knifeEnabled: true,
  halftimePlayed: false,
  needOvertime: false,
};

// Raccourcis vers les builders de clés
const matchSidesKey = redisConst.sides;
const matchScoreKey = redisConst.score;
const matchTosKey   = redisConst.timeouts;
const matchTeamsKey = redisConst.teams;
const matchClockKey = redisConst.clock;
const matchReadyKey = redisConst.ready;
const matchSeqKey   = redisConst.seq;

interface InitOpts {
  phase?: MatchPhase;
  map?: string;
  seriesBestOf?: 1 | 3 | 5;
  reset?: boolean;
  // Série
  seriesId?: string;
  mapNumber?: number;
  isDecidingMap?: boolean;
  overtimeEnabled?: boolean;
  homeSide?: 'CT' | 'T';   // override du côté home (défaut CT)
}

@Injectable()
export class MatchCommandsService {
  runPostgame(matchId: string, serverId: string | undefined) {}
  runOvertime(matchId: string, serverId: string | undefined) {}
  runHalftime(matchId: string, serverId: string | undefined) {}
  runLive(matchId: string, serverId: string | undefined) {}

  private readonly logger = new Logger(MatchCommandsService.name);

  constructor(
    private readonly ms: MatchStateService,
    @Inject(forwardRef(() => MatchPhaseService))
    private readonly mps: MatchPhaseService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly agentClient: AgentClientService,
    private readonly pauseMatchService: PauseMatchService,
  ) {}

  // ─── Résolution serveur + match ───────────────────────────────────────────

  private async resolveServerAndMatch(params: { serverId?: string | null; matchId?: string | null })
    : Promise<{ serverId: string; matchId: string }> {
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

  // ─── Actions → agent Go ──────────────────────────────────────────────────

  async pause(opts: { serverId?: string; matchId?: string }) {
    const { serverId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.pause(serverId);
    return { ok: true };
  }

  async unpause(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.unpause(serverId);
    await this.pauseMatchService.resume(matchId);
    return { ok: true };
  }

  async say(serverId: string, message: string) {
    if (!serverId) throw new BadRequestException('serverId requis');
    await this.agentClient.say(serverId, message);
  }

  async sayTeam(opts: { serverId: string; team: GameSide; message: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    await this.agentClient.sayTeam(opts.serverId, opts.team, opts.message);
  }

  async exec(opts: { serverId?: string; matchId?: string; cfgName: string; vars?: Record<string, string> }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.exec(serverId, opts.cfgName, opts.vars, matchId);
    return { ok: true };
  }

  async rcon(opts: { serverId?: string; matchId?: string; command: string }) {
    if (!opts.serverId) throw new BadRequestException('serverId requis');
    await this.agentClient.rcon(opts.serverId, opts.command);
    return { ok: true };
  }

  async restart(opts: { serverId?: string; matchId?: string; delay?: number }) {
    const { serverId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.restart(serverId, opts.delay ?? 3);
    return { ok: true };
  }

  async changeLevel(opts: { serverId: string; map: string }) {
    if (!opts.serverId || !opts.map) throw new BadRequestException('serverId et map requis');
    await this.agentClient.changelevel(opts.serverId, opts.map);
    return { ok: true };
  }

  async initMatch(opts: { serverId: string; matchId: string; map: string }) {
    if (!opts.serverId || !opts.matchId || !opts.map) throw new BadRequestException('serverId, matchId et map requis');
    await this.agentClient.initMatch(opts.serverId, opts.matchId, opts.map);
    return { ok: true };
  }

  // ─── État Redis ───────────────────────────────────────────────────────────

  async bindServerToMatch(serverId: string, matchId: string) {
    const sid = String(serverId || '').trim();
    const mid = String(matchId || '').trim();
    if (!sid || !mid || mid === 'unknown') {
      throw new BadRequestException('serverId et matchId requis (matchId ≠ "unknown")');
    }
    await this.redis.set(redisConst.serverMatch(sid), mid);
    await this.redis.set(redisConst.matchServer(mid), sid);
    this.logger.log(`[bind] server=${sid} -> match=${mid}`);
    return { ok: true, serverId: sid, matchId: mid };
  }

  async ensureInitMatch(
    serverId: string,
    matchId?: string,
    mapName?: string,
    homeName?: string,
    awayName?: string,
    opts: InitOpts = {},
  ) {
    const sid = String(serverId || '').trim();
    if (!sid) throw new BadRequestException('serverId requis');

    const wantHome: GameSide = opts.homeSide ?? 'CT';
    const wantAway: GameSide = wantHome === 'CT' ? 'T' : 'CT';

    let mid = String(matchId || '').trim();
    if (!mid || mid === 'unknown') {
      const seed = `${sid}-${Date.now()}`;
      mid = `m-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 10)}`;
    }

    const slug = mid.slice(2, 6);
    const home_name = (homeName ?? `Home_${slug}`).trim();
    const away_name = (awayName ?? `Away_${slug}`).trim();
    const teams = {
      home: { id: `th-${slug}`, name: home_name },
      away: { id: `ta-${slug}`, name: away_name },
    };
    const map_name = (mapName ?? opts.map ?? 'de_inferno').trim();
    const now = Date.now();
    const pipe = this.redis.multi();

    const hset = opts.reset
      ? (k: string, f: string, v: any) => pipe.hset(k, f, v)
      : (k: string, f: string, v: any) => pipe.hsetnx(k, f, v);
    const set = opts.reset
      ? (k: string, v: any) => pipe.set(k, v)
      : (k: string, v: any) => pipe.setnx(k, v);

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

    // Écrire la config de série dans matchConfig (champs supplémentaires)
    if (
      opts.seriesId !== undefined ||
      opts.mapNumber !== undefined ||
      opts.isDecidingMap !== undefined ||
      opts.overtimeEnabled !== undefined
    ) {
      const cfgFields: string[] = [];
      if (opts.seriesId      !== undefined) cfgFields.push('seriesId',      opts.seriesId);
      if (opts.mapNumber     !== undefined) cfgFields.push('mapNumber',     String(opts.mapNumber));
      if (opts.isDecidingMap !== undefined) cfgFields.push('isDecidingMap', opts.isDecidingMap ? '1' : '0');
      if (opts.overtimeEnabled !== undefined) cfgFields.push('overtimeEnabled', opts.overtimeEnabled ? '1' : '0');
      if (cfgFields.length) await this.redis.hset(redisConst.matchConfig(mid), ...cfgFields);
    }

    this.logger.log(
      `[init] server=${sid} match=${mid} sides=${wantHome}/${wantAway} map=${map_name} phase=${MatchPhase.WARMUP_MAIN} reset=${!!opts.reset}` +
      (opts.seriesBestOf ? ` bo${opts.seriesBestOf}` : '') +
      (opts.seriesId ? ` series=${opts.seriesId} map#${opts.mapNumber ?? 1} deciding=${opts.isDecidingMap}` : ''),
    );

    this.mps.startPhaseCountdown(mid, MatchPhase.WARMUP_MAIN, 30, sid);

    return { matchId: mid, map: map_name, home: teams.home, away: teams.away };
  }

  // ─── Alias chat / orchestrateur ──────────────────────────────────────────

  async startLive(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.unpause({ serverId, matchId, actor: opts.actor });
    return { ok: true };
  }

  async restartGame(opts: { serverId?: string; matchId?: string; delay?: number; actor?: Actor }) {
    return this.restart(opts);
  }

  async setReady(opts: { serverId?: string; matchId?: string; actor: Actor; ready: boolean }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    const logical = await this.ms.sideToLogical(matchId, opts.actor.teamSide);
    if (!logical) throw new BadRequestException('Impossible de résoudre la logique (home/away)');

    const key = matchReadyKey(matchId);
    const field = logical === 'home' ? 'home' : 'away';

    const oldVal = await this.redis.hget(key, field);
    const oldReady = oldVal === '1';
    const oldStatus = oldVal == null ? 'unset' : (oldReady ? 'ready' : 'not ready');

    await this.redis.hset(key, field, opts.ready ? 1 : 0);
    const newStatus = opts.ready ? 'ready' : 'not ready';

    await this.say(serverId, `[status] ${opts.actor.name}: ${oldStatus} → ${newStatus}`);
    if (!opts.ready) {
      await this.mps.cancelPhaseCountdown(matchId, 'team_unready');
    }

    const values = await this.redis.hgetall(matchReadyKey(matchId));
    if (values.home === '1' && values.away === '1') {
      const current = await this.redis.get(redisConst.phase(matchId));
      const next = resolveNextPhase(current as Phase);
      await this.mps.startPhaseCountdown(matchId, next, 5, serverId);
    }

    return { ok: true };
  }

  async stopMatch(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.ms.setPhase(matchId, 'postgame');
    await this.say(serverId, '[match] stopped by admin');
    return { ok: true };
  }

  async swapSides(opts: { matchId: string }): Promise<void> {
    const { serverId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.rcon(serverId, 'mp_swapteams');
  }
}

/**
 * Détermine la phase suivante (pure function).
 */
export function resolveNextPhase(
  current: Phase | null | undefined,
  ctx?: NextPhaseContext,
): MatchPhase {
  const C = { ...DEFAULT_CTX, ...(ctx || {}) };

  if (!current) {
    return C.knifeEnabled ? MatchPhase.KNIFE_LIVE : MatchPhase.LIVE_MAIN;
  }

  switch (current) {
    case 'knife':
      return MatchPhase.KNIFE_CHOICE;
    case 'knife_decision':
      return MatchPhase.LIVE_MAIN;
    case 'postgame':
    default:
      return MatchPhase.KNIFE_CHOICE;
  }
}
