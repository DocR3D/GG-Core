import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';
import { Phase } from '@domain/phase.types';
import { MatchSettings, MatchReview, DEFAULT_MATCH_SETTINGS } from '@domain/match-settings.types';
import { GameSide, normalizeSide, CS2_SIDE_TERRORIST } from '@domain/side.types';

export type { GameSide };
export type Logical = 'home' | 'away';
export type CoreSide = { home: GameSide; away: GameSide };
export type AgentState = {
  online: boolean;
  rconConnected?: boolean;
  rconError?: string;
  lastLogAt?: string | null;
  lastBadTokenAt?: string;
};

@Injectable()
export class SidesScoreService {
  private readonly log = new Logger(SidesScoreService.name);
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Server ↔ Match binding
  // ─────────────────────────────────────────────────────────────────────────────
  private serverMatchKey(serverId: string): string {
    // compat: certains projets avaient serverMatchid
    // @ts-ignore
    if (typeof (redisConst as any).serverMatch === 'function') return (redisConst as any).serverMatch(serverId);
    // @ts-ignore
    if (typeof (redisConst as any).serverMatchid === 'function') return (redisConst as any).serverMatchid(serverId);
    throw new BadRequestException('redisConst.serverMatch(.serverMatchid) manquant');
  }

  async setServerMatch(serverId: string, matchId: string, ttlSec?: number) {
    const key = this.serverMatchKey(serverId);
    if (ttlSec && ttlSec > 0) {
      await this.redis.set(key, matchId, 'EX', ttlSec);
      await this.redis.set(redisConst.matchServer(matchId), serverId, 'EX', ttlSec);
    } else {
      await this.redis.set(key, matchId);
      await this.redis.set(redisConst.matchServer(matchId), serverId);
    }
  }

  /** Removes the server → match binding (the match itself is left untouched). */
  async unbindServer(serverId: string) {
    await this.redis.del(this.serverMatchKey(serverId));
  }

  /**
   * What the agent of a server last reported (heartbeat every ~3 s): RCON reachable with its password, last
   * logs received from CS2, last logs refused for a bad token. `online: false` = no agent running for it.
   */
  async getAgentState(serverId: string): Promise<AgentState> {
    const raw = await this.redis.get(redisConst.agentState(serverId));
    if (!raw) return { online: false };
    try {
      const hb = JSON.parse(raw);
      return {
        online: true,
        rconConnected: !!hb.rcon?.connected,
        rconError: hb.rcon?.error || undefined,
        lastLogAt: hb.logs?.lastAt ? new Date(hb.logs.lastAt * 1000).toISOString() : null,
        lastBadTokenAt: hb.logs?.lastBadTokenAt ? new Date(hb.logs.lastBadTokenAt * 1000).toISOString() : undefined,
      };
    } catch {
      return { online: true };
    }
  }

  async setDbMatchMapId(matchId: string, matchMapId: string) {
    await this.redis.set(redisConst.dbMatchMap(matchId), matchMapId);
  }

  async getDbMatchMapId(matchId: string): Promise<string | null> {
    return (await this.redis.get(redisConst.dbMatchMap(matchId))) ?? null;
  }

  async getMatchIdFromServerId(serverId: string): Promise<string | undefined> {
    const key = this.serverMatchKey(serverId);
    return (await this.redis.get(key)) as string | undefined;
  }

  async getServerIdFromMatchId(matchId: string): Promise<string | undefined> {
    const direct = await this.redis.get(redisConst.matchServer(matchId));
    if (direct) return direct;

    // Exemple : tu récupères les agents actifs
    const agentsKeys = await this.redis.keys('server:*:currentMatch');
    for (const key of agentsKeys) {
      const sid = key.split(':')[1]; // server:<sid>:currentMatch
      const mid = await this.redis.get(key);
      if (mid === matchId) return sid;
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sides (source de vérité) - Hash {home:'CT'|'T', away:'CT'|'T'}
  // Migration depuis legacy String JSON si besoin.
  // ─────────────────────────────────────────────────────────────────────────────
  async getSides(matchId: string): Promise<CoreSide | null> {
    const key = redisConst.sides(matchId);
    const data = await this.redis.hgetall(key);
    if (!data || !isSide(data.home) || !isSide(data.away)) return null;
    return { home: data.home, away: data.away };
  }

  async setSides(matchId: string, sides: CoreSide) {
    if (!isSide(sides.home) || !isSide(sides.away)) {
      throw new BadRequestException('Sides invalides (doit être "CT" ou "T")');
    }
    const key = redisConst.sides(matchId);
    await this.redis.hset(key, { home: sides.home, away: sides.away });
  }

  async swapSides(matchId: string): Promise<boolean> {
    const s = await this.getSides(matchId);
    if (!s) return false;
    await this.setSides(matchId, { home: s.away, away: s.home });

    // Inverser les scores CT et T en cohérence avec le changement de camp
    const score = await this.getScore(matchId);
    await this.redis.hset(redisConst.score(matchId), {
      ct: String(score.t),
      t: String(score.ct),
    });

    // Inverser ct_name et t_name dans teams
    const teams = await this.redis.hgetall(redisConst.teams(matchId));
    if (teams && (teams.ct_name || teams.t_name)) {
      await this.redis.hset(redisConst.teams(matchId), {
        ct_name: teams.t_name || 'CT',
        t_name: teams.ct_name || 'T',
        ct_id: teams.t_id || '',
        t_id: teams.ct_id || '',
      });
    }
    return true;
  }

  async sideToLogical(matchId: string, side: GameSide): Promise<Logical | null> {
    const s = (await this.getSides(matchId)) ?? { home: 'CT', away: 'T' };
    const norm = normalizeSide(side);
    if (norm === s.home) return 'home';
    if (norm === s.away) return 'away';
    return null;
  }

  async logicalToSide(matchId: string, logical: Logical): Promise<GameSide | null> {
    const s = (await this.getSides(matchId)) ?? { home: 'CT', away: 'T' };
    if (logical === 'home') return s.home;
    if (logical === 'away') return s.away;
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Score & phase
  // ─────────────────────────────────────────────────────────────────────────────
  async initScore(matchId: string) {
    await this.redis.hset(redisConst.score(matchId), {
      round: '0',
      home: '0',
      away: '0',
      ct: '0',
      t: '0',
    });
  }

  async setPhase(matchId: string, phase: Phase) {
    await this.redis.set(redisConst.phase(matchId), phase);
  }

  async incRound(matchId: string): Promise<number> {
    return await this.redis.hincrby(redisConst.score(matchId), 'round', 1);
  }

  async addPoint(matchId: string, winner: GameSide): Promise<void> {
    const norm = normalizeSide(winner);
    const logical = await this.sideToLogical(matchId, norm);
    const multi = this.redis.multi();

    if (logical === 'home') multi.hincrby(redisConst.score(matchId), 'home', 1);
    if (logical === 'away') multi.hincrby(redisConst.score(matchId), 'away', 1);

    if (norm === 'CT') multi.hincrby(redisConst.score(matchId), 'ct', 1);
    if (norm === 'T') multi.hincrby(redisConst.score(matchId), 't', 1);

    multi.hincrby(redisConst.score(matchId), 'round', 1);
    await multi.exec();
  }

  async reconcileScore(matchId: string, ct: number, t: number): Promise<void> {
    const sides = await this.getSides(matchId);
    const homeScore = sides?.home === 'CT' ? ct : t;
    const awayScore = sides?.away === 'CT' ? ct : t;
    const round = ct + t;

    await this.redis.hset(redisConst.score(matchId), {
      ct: String(ct),
      t: String(t),
      home: String(homeScore),
      away: String(awayScore),
      round: String(round),
    });
  }

  async getPhase(matchId: string): Promise<Phase | null> {
    return (await this.redis.get(redisConst.phase(matchId))) as Phase | null;
  }

  async getRound(matchId: string): Promise<number> {
    const v = await this.redis.hget(redisConst.score(matchId), 'round');
    return v ? parseInt(v, 10) : 0;
  }

  async getScore(matchId: string) {
    const [rawScore, phase] = await Promise.all([
      this.redis.hgetall(redisConst.score(matchId)),
      this.redis.get(redisConst.phase(matchId)),
    ]);

    return {
      round: rawScore.round ? parseInt(rawScore.round, 10) : 0,
      ct: rawScore.ct ? parseInt(rawScore.ct, 10) : 0,
      t: rawScore.t ? parseInt(rawScore.t, 10) : 0,
      home: rawScore.home ? parseInt(rawScore.home, 10) : 0,
      away: rawScore.away ? parseInt(rawScore.away, 10) : 0,
      phase: (phase as Phase) ?? 'warmup',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Anti-eBot Bug Guards & State Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  async getLastScoredRound(matchId: string): Promise<number> {
    const val = await this.redis.get(redisConst.lastScoredRound(matchId));
    return val ? parseInt(val, 10) : 0;
  }

  async setLastScoredRound(matchId: string, round: number): Promise<void> {
    await this.redis.set(redisConst.lastScoredRound(matchId), String(round));
  }

  async isHalftimePlayed(matchId: string): Promise<boolean> {
    const val = await this.redis.get(redisConst.halftimePlayed(matchId));
    return val === 'true';
  }

  async setHalftimePlayed(matchId: string, played: boolean): Promise<void> {
    await this.redis.set(redisConst.halftimePlayed(matchId), played ? 'true' : 'false');
  }

  async getOvertimeCount(matchId: string): Promise<number> {
    const val = await this.redis.get(redisConst.overtimeCount(matchId));
    return val ? parseInt(val, 10) : 0;
  }

  async setOvertimeCount(matchId: string, count: number): Promise<void> {
    await this.redis.set(redisConst.overtimeCount(matchId), String(count));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings (Warmup toggles, Overtime config, Postgame action)
  // ─────────────────────────────────────────────────────────────────────────────

  async getSettings(matchId: string): Promise<Required<MatchSettings>> {
    const raw = await this.redis.hgetall(redisConst.settings(matchId));
    if (!raw || Object.keys(raw).length === 0) {
      return { ...DEFAULT_MATCH_SETTINGS };
    }
    return {
      warmupAfterKnife: raw.warmupAfterKnife === 'true',
      warmupAtHalftime: raw.warmupAtHalftime === 'true',
      warmupAtOvertime: raw.warmupAtOvertime === 'true',
      postgameAction: (raw.postgameAction as any) || DEFAULT_MATCH_SETTINGS.postgameAction,
      postgameResetDelaySec: raw.postgameResetDelaySec
        ? Number(raw.postgameResetDelaySec)
        : DEFAULT_MATCH_SETTINGS.postgameResetDelaySec,
      postgameKickDelaySec: raw.postgameKickDelaySec !== undefined
        ? Number(raw.postgameKickDelaySec)
        : DEFAULT_MATCH_SETTINGS.postgameKickDelaySec,
      mrFormat: raw.mrFormat ? Number(raw.mrFormat) : DEFAULT_MATCH_SETTINGS.mrFormat,
      overtimeMrFormat: raw.overtimeMrFormat ? Number(raw.overtimeMrFormat) : DEFAULT_MATCH_SETTINGS.overtimeMrFormat,
      overtimeEnabled: raw.overtimeEnabled !== 'false',
      knifeEnabled: raw.knifeEnabled !== 'false',
      tacticalPauseBankSec: raw.tacticalPauseBankSec
        ? Number(raw.tacticalPauseBankSec)
        : DEFAULT_MATCH_SETTINGS.tacticalPauseBankSec,
      fixedSides: raw.fixedSides === 'true',
    };
  }

  async getReview(matchId: string): Promise<MatchReview | null> {
    const raw = await this.redis.get(redisConst.review(matchId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MatchReview;
    } catch {
      return null;
    }
  }

  async setReview(matchId: string, review: MatchReview | null): Promise<void> {
    if (review) await this.redis.set(redisConst.review(matchId), JSON.stringify(review));
    else await this.redis.del(redisConst.review(matchId));
  }

  async setSettings(matchId: string, settings: Partial<MatchSettings>): Promise<void> {
    const fields: Record<string, string> = {};
    if (settings.warmupAfterKnife !== undefined) fields.warmupAfterKnife = String(settings.warmupAfterKnife);
    if (settings.warmupAtHalftime !== undefined) fields.warmupAtHalftime = String(settings.warmupAtHalftime);
    if (settings.warmupAtOvertime !== undefined) fields.warmupAtOvertime = String(settings.warmupAtOvertime);
    if (settings.postgameAction !== undefined) fields.postgameAction = settings.postgameAction;
    if (settings.postgameResetDelaySec !== undefined) fields.postgameResetDelaySec = String(settings.postgameResetDelaySec);
    if (settings.postgameKickDelaySec !== undefined) fields.postgameKickDelaySec = String(settings.postgameKickDelaySec);
    if (settings.mrFormat !== undefined) fields.mrFormat = String(settings.mrFormat);
    if (settings.overtimeMrFormat !== undefined) fields.overtimeMrFormat = String(settings.overtimeMrFormat);
    if (settings.overtimeEnabled !== undefined) fields.overtimeEnabled = String(settings.overtimeEnabled);
    if (settings.knifeEnabled !== undefined) fields.knifeEnabled = String(settings.knifeEnabled);
    if (settings.tacticalPauseBankSec !== undefined) fields.tacticalPauseBankSec = String(settings.tacticalPauseBankSec);
    if (settings.fixedSides !== undefined) fields.fixedSides = String(settings.fixedSides);

    if (Object.keys(fields).length > 0) {
      await this.redis.hset(redisConst.settings(matchId), fields);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Knife
  // ─────────────────────────────────────────────────────────────────────────────
  async applyKnifeResult(matchId: string, winnerSide: 'CT' | 'T') {
    const sidesKey = redisConst.sides(matchId);
    const [homeSide, awaySide] = await this.redis.hmget(sidesKey, 'home', 'away');

    const winnerLogical: 'home' | 'away' =
      winnerSide === homeSide ? 'home'
      : winnerSide === awaySide ? 'away'
      : (() => { throw new Error(`[KnifeRule] Incohérence sides winnerSide=${winnerSide} home=${homeSide} away=${awaySide}`) })();

    const kSide    = redisConst.knifeWinnerSide(matchId);
    const kLogical = redisConst.knifeWinnerLogical(matchId);
    const kChoice  = redisConst.knifeChoice(matchId);

    await this.redis
      .multi()
      .set(kSide, winnerSide)
      .set(kLogical, winnerLogical)
      .set(kChoice, 'pending')
      .exec();
  }

  async getKnifeWinner(matchId: string): Promise<{
    side: GameSide | null;
    logical: Logical | null;
    team: { id: string | null; name: string | null } | null;
  }> {
    // Récupère side et logical stockés
    const [sideRaw, logicalRaw] = await this.redis.mget(
      redisConst.knifeWinnerSide(matchId),
      redisConst.knifeWinnerLogical(matchId),
    );
    const side = (sideRaw as GameSide) ?? null;
    let logical = (logicalRaw as Logical) ?? null;

    // Récupère les équipes
    const teams = await this.redis.hgetall(redisConst.teams(matchId));
    const home = { id: teams.home_id ?? null, name: teams.home_name ?? null };
    const away = { id: teams.away_id ?? null, name: teams.away_name ?? null };

    // Si logical n’est pas stocké → on peut le déduire via sides
    if (!logical && side) {
      const [homeSide, awaySide] = await this.redis.hmget(
        redisConst.sides(matchId),
        'home',
        'away',
      );
      if (side === homeSide) logical = 'home';
      else if (side === awaySide) logical = 'away';
    }

    // Associe logical -> team
    let team: { id: string | null; name: string | null } | null = null;
    if (logical === 'home') team = home;
    else if (logical === 'away') team = away;

    return { side, logical, team };
  }
}

// ───────────── helpers ─────────────
function isSide(s: any): s is GameSide {
  return s === 'CT' || s === 'T';
}
