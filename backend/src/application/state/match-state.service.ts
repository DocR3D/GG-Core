import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis-keys';

export type GameSide = 'CT' | 'T';
export type Logical = 'home' | 'away';
export type Phase = 'freeze' | 'live' | 'intermission' | 'paused' | 'timeout' | 'ended' | 'knife' | 'tech_timeout';
export type CoreSide = { home: GameSide; away: GameSide };

export type PlayerInfo = {
  steamId: string;
  name?: string;
  logical: Logical;   // équipe logique stable (home/away)
  joinedTs?: number;
};

export type TeamEconomyMeta = {
  round: number;
  home_loss_streak: number;
  away_loss_streak: number;
  home_loss_bonus: number;
  away_loss_bonus: number;
};

// table de progression du bonus
const LOSS_BONUS_TABLE = [1400, 1900, 2400, 2900, 3400];

@Injectable()
export class MatchStateService {
  private readonly log = new Logger(MatchStateService.name);
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Server ↔ Match binding
  // ─────────────────────────────────────────────────────────────────────────────
  async setServerMatch(serverId: string, matchId: string, ttlSec?: number) {
    const key = redisConst.serverMatchid(serverId);
    if (ttlSec && ttlSec > 0) {
      await this.redis.set(key, matchId, 'EX', ttlSec);
    } else {
      await this.redis.set(key, matchId);
    }
  }
  async getServerMatch(serverId: string): Promise<string | null> {
    return (await this.redis.get(redisConst.serverMatchid(serverId))) as string | null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sides (source de vérité)
  // Stockage cible: HASH {home:'CT'|'T', away:'CT'|'T'}
  // Compat: on migre depuis l’ancien SET JSON si détecté.
  // ─────────────────────────────────────────────────────────────────────────────
  async setSides(matchId: string, sides: CoreSide) {
    await this.redis.hset(redisConst.sides(matchId), { home: sides.home, away: sides.away });
  }

  async getSides(matchId: string): Promise<CoreSide | null> {
    const key = redisConst.sides(matchId);

    // 1) Essaye HASH (nouveau format)
    const h = await this.redis.hgetall(key);
    if (h && (h.home || h.away)) {
      if (isSide(h.home) && isSide(h.away)) return { home: h.home, away: h.away };
      this.log.warn(`Invalid sides hash for ${matchId}: ${JSON.stringify(h)}`);
      return null;
    }

    // 2) Back-compat: ancien format SET JSON ; migre si présent
    const json = await this.redis.get(key);
    if (json) {
      try {
        const obj = JSON.parse(json) as CoreSide;
        if (isSide(obj?.home) && isSide(obj?.away)) {
          // migre vers HASH puis supprime l’ancien JSON (pas obligatoire)
          await this.redis.hset(key, { home: obj.home, away: obj.away });
          await this.redis.del(key); // supprime la string (évite ambiguïté)
          return obj;
        }
      } catch (e) {
        this.log.warn(`Failed to parse legacy sides for ${matchId}: ${e}`);
      }
    }

    return null;
  }

  async swapSides(matchId: string): Promise<boolean> {
    const key = redisConst.sides(matchId);
    const h = await this.redis.hgetall(key);
    if (!h?.home || !h?.away) return false;
    await this.redis.hset(key, { home: h.away, away: h.home });
    return true;
  }

  async sideToLogical(matchId: string, side: GameSide): Promise<Logical | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    if (side === s.home) return 'home';
    if (side === s.away) return 'away';
    return null;
  }

  async logicalToSide(matchId: string, logical: Logical): Promise<GameSide | null> {
    const s = await this.getSides(matchId);
    if (!s) return null;
    return logical === 'home' ? s.home : s.away;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Score & phase (hash unique: 't','ct','round','phase')
  // ─────────────────────────────────────────────────────────────────────────────
  async initScore(matchId: string) {
    const key = redisConst.score(matchId);
    await this.redis.hset(key, 't', '0', 'ct', '0', 'round', '1', 'phase', 'freeze');
  }

  async setPhase(matchId: string, phase: Phase) {
    await this.redis.hset(redisConst.score(matchId), { phase });
  }

  async incRound(matchId: string) {
    await this.redis.hincrby(redisConst.score(matchId), 'round', 1);
  }

  async addPoint(matchId: string, winner: GameSide) {
    const field = winner === 'T' ? 't' : 'ct';
    await this.redis.hincrby(redisConst.score(matchId), field, 1);
  }

  async getPhase(matchId: string): Promise<Phase | null> {
    const p = await this.redis.hget(redisConst.score(matchId), 'phase');
    return (p as Phase) ?? null;
  }

  async getRound(matchId: string): Promise<number> {
    const r = await this.redis.hget(redisConst.score(matchId), 'round');
    return toInt(r);
  }

  async getScore(matchId: string): Promise<{ t: number; ct: number }> {
    const key = redisConst.score(matchId);
    const [t, ct] = await this.redis.hmget(key, 't', 'ct');
    return { t: toInt(t), ct: toInt(ct) };
  }
  async roundEnd(
    matchId: string,
    winnerSide: 'CT' | 'T',
    playerEconomy?: { steamId: string; money: number; equip: number }[],
  ) {
  // 1. Score
  await this.addPoint(matchId, winnerSide);
  // 2. Loss streak / bonus
  await this.updateEconomyOnRoundEnd(matchId, winnerSide);
  // 3. Argent / stuff joueurs
  if (playerEconomy) 
    for (const p of playerEconomy) {
      await this.setPlayerMoney(matchId, p.steamId, p.money);
      await this.setPlayerEquipValue(matchId, p.steamId, p.equip);
    }
  return { ok: true };
}


  // ─────────────────────────────────────────────────────────────────────────────
  // Timeouts / pauses (logical-based: home/away)
  // ─────────────────────────────────────────────────────────────────────────────
async initTimeouts(
  matchId: string,
  homeTac = 4,
  awayTac = 4,
  homeTech = 0,
  awayTech = 0,
  opts: { force?: boolean } = {},
): Promise<void> {
  const key = redisConst.timeouts(matchId);
  const t = await this.redis.type(key);

  // Si force, on repart d'une feuille blanche
  if (opts.force) {
    if (t !== 'none') await this.redis.del(key);
  } else {
    // Si la clé n'existe pas, on l'initialise; si elle existe, on ne touche pas
    if (t !== 'none') {
      return;
    }
  }

  // Écrit en HASH (camelCase)
  await this.redis.hset(key, {
    homeTac: String(homeTac),
    awayTac: String(awayTac),
    homeTech: String(homeTech),
    awayTech: String(awayTech),
  });
}
  

  private static readonly DEC_IF_POS_LUA = `
    local key = KEYS[1]
    local field = ARGV[1]
    local cur = redis.call('HGET', key, field)
    if not cur then return -1 end
    cur = tonumber(cur)
    if cur <= 0 then return 0 end
    redis.call('HINCRBY', key, field, -1)
    return cur - 1
  `;

  /** Décrémente un timeout tactique de la logical team. Retour: -1 absent, 0 épuisé, >0 nouveau solde */
  async decrTac(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}Tac`;
    const remain = await this.redis.eval(MatchStateService.DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  /** Décrémente un timeout technique de la logical team. */
  async decrTech(matchId: string, logicalTeam: Logical): Promise<number> {
    const key = redisConst.timeouts(matchId);
    const field = `${logicalTeam}Tech`;
    const remain = await this.redis.eval(MatchStateService.DEC_IF_POS_LUA, 1, key, field);
    return Number(remain);
  }

  async getTimeouts(matchId: string): Promise<{ homeTac: number; awayTac: number; homeTech: number; awayTech: number }> {
    const res = await this.redis.hgetall(redisConst.timeouts(matchId));
    return {
      homeTac: toInt(res?.homeTac),
      awayTac: toInt(res?.awayTac),
      homeTech: toInt(res?.homeTech),
      awayTech: toInt(res?.awayTech),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Teams (optionnel) — noms/ids pour UI
  // ─────────────────────────────────────────────────────────────────────────────
  async setTeams(matchId: string, ids: { home_id?: string; away_id?: string; ct_id?: string; t_id?: string; home_name?: string; away_name?: string; ct_name?: string; t_name?: string }) {
    // stocke seulement ce qu’on te donne (utile pour mises à jour partielles)
    const key = redisConst.teams(matchId);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(ids)) {
      if (v != null) fields[k] = String(v);
    }
    if (Object.keys(fields).length) await this.redis.hset(key, fields);
  }





  async getScoreWithTeams(matchId: string) {
    const [t, ct] = await this.redis.hmget(redisConst.score(matchId), 't', 'ct');
    const team = await this.redis.hgetall(redisConst.teams(matchId));
    const sides = await this.getSides(matchId);
    const derivedCtId = team?.ct_id ?? (sides ? (sides.home === 'CT' ? team?.home_id : team?.away_id) : null);
    const derivedTId  = team?.t_id  ?? (sides ? (sides.home === 'T'  ? team?.home_id : team?.away_id) : null);

    return {
      matchId,
      score: { t: toInt(t), ct: toInt(ct) },
      teams: {
        ct:   { id: derivedCtId, name: team.ct_name ?? 'CT' },
        t:    { id: derivedTId,  name: team.t_name ?? 'T'  },
        home: team.home_name ? { id: team.home_id ?? null, name: team.home_name } : undefined,
        away: team.away_name ? { id: team.away_id ?? null, name: team.away_name } : undefined,
      },
    };
  }

  async initEconomy(matchId: string) {
  await this.redis.hset(redisConst.economyTeam(matchId), {
    round: '1',
    home_loss_streak: '0',
    away_loss_streak: '0',
    home_loss_bonus: '0',
    away_loss_bonus: '0',
  });
}

async getTeamEconomyMeta(matchId: string): Promise<TeamEconomyMeta> {
  const h = await this.redis.hgetall(redisConst.economyTeam(matchId));
  return {
    round: toInt(h?.round) || (await this.getRound(matchId)),
    home_loss_streak: toInt(h?.home_loss_streak),
    away_loss_streak: toInt(h?.away_loss_streak),
    home_loss_bonus: toInt(h?.home_loss_bonus),
    away_loss_bonus: toInt(h?.away_loss_bonus),
  };
}

async setTeamLossStreak(matchId: string, logical: 'home'|'away', streak: number) {
  const sField = logical === 'home' ? 'home_loss_streak' : 'away_loss_streak';
  const bField = logical === 'home' ? 'home_loss_bonus'  : 'away_loss_bonus';
  const bonus = lossBonusFromStreak(streak);

  await this.redis.hset(redisConst.economyTeam(matchId), {
    [sField]: String(streak),
    [bField]: String(bonus),
  });
}

  async updateEconomyOnRoundEnd(matchId: string, winnerSide: 'CT'|'T') {
    const winnerLogical = await this.sideToLogical(matchId, winnerSide);
    if (!winnerLogical) return false;
    const loserLogical = winnerLogical === 'home' ? 'away' : 'home';

    const econ = await this.getTeamEconomyMeta(matchId);

    const winnerStreak = Math.max(
      (winnerLogical === 'home' ? econ.home_loss_streak : econ.away_loss_streak) - 1,
      0,
    );
    const loserStreak =
      (loserLogical === 'home' ? econ.home_loss_streak : econ.away_loss_streak) + 1;

    await this.setTeamLossStreak(matchId, winnerLogical, winnerStreak);
    await this.setTeamLossStreak(matchId, loserLogical, loserStreak);

    await this.redis.hincrby(redisConst.economyTeam(matchId), 'round', 1);
    return true;
}

  

  // ─────────────────────────────────────────────────────────────────────────────
  // Snapshot global (pratique pour debug/UI admin)
  // ─────────────────────────────────────────────────────────────────────────────
  async getSnapshot(matchId: string) {
  const [sides, scoreHash, timeouts, teams, econTeam, playersMoney, playersEquip] = await Promise.all([
    this.getSides(matchId),
    this.redis.hgetall(redisConst.score(matchId)),
    this.redis.hgetall(redisConst.timeouts(matchId)),
    this.redis.hgetall(redisConst.teams(matchId)),
    this.redis.hgetall(redisConst.economyTeam(matchId)),
    this.redis.hgetall(redisConst.moneyHash(matchId)),
    this.redis.hgetall(redisConst.equipHash(matchId)),
  ]);
 const ctId =
  (teams?.ct_id ?? null) ??
  (sides
    ? (sides.home === 'CT' ? (teams?.home_id ?? null) : (teams?.away_id ?? null))
    : null);

const tId =
  (teams?.t_id ?? null) ??
  (sides
    ? (sides.home === 'T' ? (teams?.home_id ?? null) : (teams?.away_id ?? null))
    : null);
  const players: Record<string,{money:number; equip:number}> = {};
  const ids = new Set([...Object.keys(playersMoney||{}), ...Object.keys(playersEquip||{})]);
  for (const id of ids) players[id] = { money: toInt(playersMoney?.[id]), equip: toInt(playersEquip?.[id]) };

  // calc banque agrégée à la volée
  const sum = (ids: string[]) => ids.reduce((acc,id)=>acc+(players[id]?.money||0),0);
  const homeIds = await this.redis.lrange(redisConst.lineupHome(matchId),0,-1);
  const awayIds = await this.redis.lrange(redisConst.lineupAway(matchId),0,-1);

  const homeBank = sum(homeIds);
  const awayBank = sum(awayIds);

  return {
    matchId,
    sides,
    score: {
      t: toInt(scoreHash?.t),
      ct: toInt(scoreHash?.ct),
      round: toInt(scoreHash?.round) || 1,
      phase: (scoreHash?.phase as Phase) ?? 'freeze',
    },
    timeouts: {
      homeTac: toInt(timeouts?.homeTac),
      awayTac: toInt(timeouts?.awayTac),
      homeTech: toInt(timeouts?.homeTech),
      awayTech: toInt(timeouts?.awayTech),
    },
    teams: {
      ct_id: ctId,
      t_id:  tId,
      home_id: teams?.home_id ?? null,
      away_id: teams?.away_id ?? null,
      ct_name: teams?.ct_name ?? 'CT',
      t_name: teams?.t_name ?? 'T',
      home_name: teams?.home_name ?? null,
      away_name: teams?.away_name ?? null,
    },
    economy: {
      round: toInt(econTeam?.round) || toInt(scoreHash?.round) || 1,
      home_loss_streak: toInt(econTeam?.home_loss_streak),
      away_loss_streak: toInt(econTeam?.away_loss_streak),
      home_loss_bonus: toInt(econTeam?.home_loss_bonus),
      away_loss_bonus: toInt(econTeam?.away_loss_bonus),
      home_bank: homeBank,
      away_bank: awayBank,
      players,
    },
  };
}


  async upsertPlayer(matchId: string, p: PlayerInfo) {
  const keyPlayers = redisConst.playersHash(matchId);
  const now = Date.now();

  // Fusion si déjà existant
  const existing = await this.redis.hget(keyPlayers, p.steamId);
  const merged: PlayerInfo = existing
    ? { ...(JSON.parse(existing) as PlayerInfo), ...p }
    : { ...p, joinedTs: p.joinedTs ?? now };

  await this.redis.hset(keyPlayers, p.steamId, JSON.stringify(merged));

  // Maintien des lineups (uniques, ordonnées)
  const listHome = redisConst.lineupHome(matchId);
  const listAway = redisConst.lineupAway(matchId);

  // Retire de l'autre lineup si besoin
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

  // Nettoie des deux côtés, puis réinsère côté cible si absent
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

function lossBonusFromStreak(streak: number): number {
  if (streak <= 0) return 0;
    const idx = Math.min(streak, LOSS_BONUS_TABLE.length) - 1;
    return LOSS_BONUS_TABLE[idx];
}

// ───────────── helpers ─────────────
function isSide(s: any): s is GameSide {
  return s === 'CT' || s === 'T';
}
function toInt(v: string | null | undefined): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}
