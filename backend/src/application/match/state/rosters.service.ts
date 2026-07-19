import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';
import { SidesScoreService } from './sides-score.service';

export type Logical = 'home' | 'away';

export type PlayerInfo = {
  steamId: string;
  name?: string;
  logical: Logical;   // équipe logique stable (home/away)
  joinedTs?: number;
};

type TeamsDoc = {
  home_id?: string | null;
  away_id?: string | null;
  home_name?: string | null;
  away_name?: string | null;
};

@Injectable()
export class TeamsRosterService {
  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly sidesScore: SidesScoreService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Teams (string JSON) - noms/ids pour UI
  // ─────────────────────────────────────────────────────────────────────────────
  async setTeams(
    matchId: string,
    ids: Partial<TeamsDoc>,
  ) {
    const key = redisConst.teams(matchId);

    // Lit le hash existant (migration transparente si ancienne clé String)
    let prev: TeamsDoc = {};
    try {
      prev = ((await this.redis.hgetall(key)) as TeamsDoc) ?? {};
    } catch {
      // Ancienne clé String → migre vers Hash
      const raw = await this.redis.get(key);
      prev = safeParseTeams(raw);
      await this.redis.del(key);
    }

    const next: TeamsDoc = { ...prev, ...ids };
    const entries = Object.entries(next).filter(([, v]) => v != null) as [string, string][];
    if (entries.length > 0) {
      await this.redis.hset(key, Object.fromEntries(entries));
    }
  }

  async getScoreWithTeams(matchId: string) {
    const [[tStr, ctStr], teamsHash, sides] = await Promise.all([
      this.redis.hmget(redisConst.score(matchId), 't', 'ct'),
      this.redis.hgetall(redisConst.teams(matchId)),
      this.sidesScore.getSides(matchId),
    ]);

    const team: TeamsDoc = (teamsHash as TeamsDoc) ?? {};
    const homeIsCt = sides?.home === 'CT';
    const homeSide = sides?.home ?? 'CT';
    const awaySide = sides?.away ?? 'T';

    return {
      matchId,
      homeIsct: homeIsCt,
      score: {
        home: homeIsCt ? toInt(ctStr) : toInt(tStr),
        away: homeIsCt ? toInt(tStr)  : toInt(ctStr),
      },
      teams: {
        home: { id: team.home_id ?? null, name: team.home_name ?? null, side: homeSide },
        away: { id: team.away_id ?? null, name: team.away_name ?? null, side: awaySide },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Roster + économies joueurs
  // ─────────────────────────────────────────────────────────────────────────────
  async upsertPlayer(matchId: string, p: PlayerInfo) {
    const keyPlayers = redisConst.playersHash(matchId);
    const now = Date.now();

    const existing = await this.redis.hget(keyPlayers, p.steamId);
    const merged: PlayerInfo = existing
      ? { ...(JSON.parse(existing) as PlayerInfo), ...p }
      : { ...p, joinedTs: p.joinedTs ?? now };

    await this.redis.hset(keyPlayers, p.steamId, JSON.stringify(merged));

    const listHome = redisConst.lineupHome(matchId);
    const listAway = redisConst.lineupAway(matchId);

    // Retire de l’autre lineup si besoin
    await this.redis.lrem(merged.logical === 'home' ? listAway : listHome, 0, p.steamId);

    // Ajoute à la fin si absent
    const target = merged.logical === 'home' ? listHome : listAway;
    const pos = await this.redis.lpos(target, p.steamId);
    if (pos == null) await this.redis.rpush(target, p.steamId);
  }

  async movePlayerLogical(matchId: string, steamId: string, logical: Logical) {
    const keyPlayers = redisConst.playersHash(matchId);
    const j = await this.redis.hget(keyPlayers, steamId);
    if (!j) return false;

    const p = JSON.parse(j) as PlayerInfo;
    if (p.logical === logical) return true;

    p.logical = logical;
    await this.redis.hset(keyPlayers, steamId, JSON.stringify(p));

    const listHome = redisConst.lineupHome(matchId);
    const listAway = redisConst.lineupAway(matchId);

    await this.redis.lrem(listHome, 0, steamId);
    await this.redis.lrem(listAway, 0, steamId);

    const target = logical === 'home' ? listHome : listAway;
    const pos = await this.redis.lpos(target, steamId);
    if (pos == null) await this.redis.rpush(target, steamId);
    return true;
  }

  async removePlayer(matchId: string, steamId: string) {
    await this.redis.hdel(redisConst.playersHash(matchId), steamId);
    await this.redis.lrem(redisConst.lineupHome(matchId), 0, steamId);
    await this.redis.lrem(redisConst.lineupAway(matchId), 0, steamId);
  }

  async getPlayers(matchId: string): Promise<{ home: PlayerInfo[]; away: PlayerInfo[] }> {
    const [map, homeIds, awayIds] = await Promise.all([
      this.redis.hgetall(redisConst.playersHash(matchId)),
      this.redis.lrange(redisConst.lineupHome(matchId), 0, -1),
      this.redis.lrange(redisConst.lineupAway(matchId), 0, -1),
    ]);

    const parse = (id: string) => {
      const j = map?.[id];
      if (!j) return null;
      try { return JSON.parse(j) as PlayerInfo; } catch { return null; }
    };

    return {
      home: homeIds.map(parse).filter(Boolean) as PlayerInfo[],
      away: awayIds.map(parse).filter(Boolean) as PlayerInfo[],
    };
  }

  async addRdyPlayer(matchId: string, steamId: string): Promise<number> {
    return this.redis.sadd(redisConst.rdyPlayers(matchId), steamId);
  }
  async getRdyCount(matchId: string): Promise<number> {
    return this.redis.scard(redisConst.rdyPlayers(matchId));
  }
  async clearRdyPlayers(matchId: string): Promise<void> {
    await this.redis.del(redisConst.rdyPlayers(matchId));
  }

  async setPlayerMoney(matchId: string, steamId: string, money: number) {
    await this.redis.hset(redisConst.moneyHash(matchId), steamId, String(money));
  }

  async setPlayerEquipValue(matchId: string, steamId: string, value: number) {
    await this.redis.hset(redisConst.equipHash(matchId), steamId, String(value));
  }

  async getPlayersEconomy(matchId: string): Promise<Record<string,{money:number; equip:number}>> {
    const [m, e] = await Promise.all([
      this.redis.hgetall(redisConst.moneyHash(matchId)),
      this.redis.hgetall(redisConst.equipHash(matchId)),
    ]);
    const out: Record<string,{money:number; equip:number}> = {};
    const ids = new Set([...Object.keys(m||{}), ...Object.keys(e||{})]);
    for (const id of ids) out[id] = { money: toInt(m?.[id]), equip: toInt(e?.[id]) };
    return out;
  }
}

function toInt(v?: string | null): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}

function safeParseTeams(raw: string | null): TeamsDoc {
  if (!raw) return {};
  try { return (JSON.parse(raw) as TeamsDoc) ?? {}; }
  catch { return {}; }
}
