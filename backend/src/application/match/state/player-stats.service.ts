import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';

export type PlayerCombatStats = {
  steamId: string;
  name?: string;
  kills: number;
  deaths: number;
  assists: number;
  flashAssists?: number;
  headshots: number;
  plants?: number;
  defuses?: number;
  score: number;
};

@Injectable()
export class PlayerStatsService {
  private readonly logger = new Logger(PlayerStatsService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
  ) {}

  /**
   * Enregistre un kill entre deux joueurs : incrémente kills, headshots, score du killer et deaths de la victime.
   * En cas de teamkill (friendlyfire), le tueur ne gagne rien (ni kill, ni HS, ni point), comme dans CS2 round_stats.
   */
  async recordKill(
    matchId: string,
    killer: { steamId: string; name?: string },
    victim?: { steamId: string; name?: string },
    headshot = false,
    teamkill = false,
  ): Promise<void> {
    const key = redisConst.playerStatsHash(matchId);

    // 1. Killer stats
    if (killer?.steamId) {
      const killerStats = await this.getOrCreatePlayer(matchId, killer.steamId, killer.name);
      // Teamkill : aucun kill ni point pour le tueur (CS2 round_stats ne compte que les kills ennemis,
      // sans pénalité - vérifié sur logs réels GGLan #19). La victime prend bien sa mort (étape 2).
      if (!teamkill) {
        killerStats.kills = (killerStats.kills || 0) + 1;
        if (headshot) {
          killerStats.headshots = (killerStats.headshots || 0) + 1;
        }
        killerStats.score = (killerStats.score || 0) + (headshot ? 3 : 2);
      }
      if (killer.name && (!killerStats.name || killerStats.name.startsWith('Player_'))) {
        killerStats.name = killer.name;
      }
      await this.redis.hset(key, killer.steamId, JSON.stringify(killerStats));
    }

    // 2. Victim stats
    if (victim?.steamId) {
      const victimStats = await this.getOrCreatePlayer(matchId, victim.steamId, victim.name);
      victimStats.deaths = (victimStats.deaths || 0) + 1;
      if (victim.name && (!victimStats.name || victimStats.name.startsWith('Player_'))) {
        victimStats.name = victim.name;
      }
      await this.redis.hset(key, victim.steamId, JSON.stringify(victimStats));
    }
  }

  /**
   * Enregistre une assistance (classique ou flashbang).
   */
  async recordAssist(
    matchId: string,
    assister: { steamId: string; name?: string },
    flashAssist = false,
  ): Promise<void> {
    if (!assister?.steamId) return;
    const key = redisConst.playerStatsHash(matchId);
    const stats = await this.getOrCreatePlayer(matchId, assister.steamId, assister.name);
    stats.assists = (stats.assists || 0) + 1;
    if (flashAssist) {
      stats.flashAssists = (stats.flashAssists || 0) + 1;
    }
    stats.score = (stats.score || 0) + 1;
    if (assister.name && (!stats.name || stats.name.startsWith('Player_'))) {
      stats.name = assister.name;
    }
    await this.redis.hset(key, assister.steamId, JSON.stringify(stats));
  }

  /**
   * Enregistre les points pour la pose de bombe (+2 pts).
   */
  async recordBombPlant(
    matchId: string,
    planter: { steamId: string; name?: string },
  ): Promise<void> {
    if (!planter?.steamId) return;
    const key = redisConst.playerStatsHash(matchId);
    const stats = await this.getOrCreatePlayer(matchId, planter.steamId, planter.name);
    stats.plants = (stats.plants || 0) + 1;
    stats.score = (stats.score || 0) + 2;
    await this.redis.hset(key, planter.steamId, JSON.stringify(stats));
  }

  /**
   * Enregistre les points pour le désamorçage de bombe (+2 pts).
   */
  async recordBombDefuse(
    matchId: string,
    defuser: { steamId: string; name?: string },
  ): Promise<void> {
    if (!defuser?.steamId) return;
    const key = redisConst.playerStatsHash(matchId);
    const stats = await this.getOrCreatePlayer(matchId, defuser.steamId, defuser.name);
    stats.defuses = (stats.defuses || 0) + 1;
    stats.score = (stats.score || 0) + 2;
    await this.redis.hset(key, defuser.steamId, JSON.stringify(stats));
  }

  /**
   * Récupère l'ensemble des statistiques de combat des joueurs pour un match donné.
   */
  async getPlayerStats(matchId: string): Promise<Record<string, PlayerCombatStats>> {
    const raw = await this.redis.hgetall(redisConst.playerStatsHash(matchId));
    const result: Record<string, PlayerCombatStats> = {};
    if (!raw) return result;

    for (const [steamId, jsonStr] of Object.entries(raw)) {
      try {
        result[steamId] = JSON.parse(jsonStr) as PlayerCombatStats;
      } catch {
        // Ignorer entrée corrompue
      }
    }
    return result;
  }

  /**
   * Définit ou surcharge les statistiques d'un joueur (ex: pour presets ou réinitialisations manuelles).
   */
  async setPlayerStats(
    matchId: string,
    steamId: string,
    stats: Partial<PlayerCombatStats>,
  ): Promise<void> {
    const current = await this.getOrCreatePlayer(matchId, steamId, stats.name);
    const updated: PlayerCombatStats = {
      ...current,
      ...stats,
      steamId,
    };
    await this.redis.hset(redisConst.playerStatsHash(matchId), steamId, JSON.stringify(updated));
  }

  /**
   * Réinitialise toutes les statistiques de combat pour ce match.
   */
  async resetPlayerStats(matchId: string): Promise<void> {
    await this.redis.del(redisConst.playerStatsHash(matchId));
    await this.redis.del(redisConst.playerStatsHistory(matchId));
  }

  /**
   * Photographie les stats de tous les joueurs pour `roundsPlayed` rounds joués (appelé au début de chaque round,
   * donc après les frags de fin du round précédent - même instant que le backup de round CS2).
   */
  async snapshotPlayerStats(matchId: string, roundsPlayed: number): Promise<void> {
    const raw = await this.redis.hgetall(redisConst.playerStatsHash(matchId));
    await this.redis.hset(redisConst.playerStatsHistory(matchId), String(roundsPlayed), JSON.stringify(raw ?? {}));
  }

  /**
   * Remet les stats joueurs dans l'état photographié pour `roundsPlayed` rounds joués (backup restore CS2 :
   * les rounds annulés et les morts techniques du respawn disparaissent). Retourne false sans photo.
   */
  async restorePlayerStats(matchId: string, roundsPlayed: number): Promise<boolean> {
    const snap = await this.redis.hget(redisConst.playerStatsHistory(matchId), String(roundsPlayed));
    if (!snap) return false;
    const key = redisConst.playerStatsHash(matchId);
    await this.redis.del(key);
    for (const [steamId, json] of Object.entries(JSON.parse(snap) as Record<string, string>)) {
      await this.redis.hset(key, steamId, json);
    }
    return true;
  }

  private async getOrCreatePlayer(
    matchId: string,
    steamId: string,
    name?: string,
  ): Promise<PlayerCombatStats> {
    const key = redisConst.playerStatsHash(matchId);
    const raw = await this.redis.hget(key, steamId);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PlayerCombatStats;
        if (name && (!parsed.name || parsed.name.startsWith('Player_'))) {
          parsed.name = name;
        }
        return parsed;
      } catch {}
    }
    return {
      steamId,
      name: name || steamId,
      kills: 0,
      deaths: 0,
      assists: 0,
      flashAssists: 0,
      headshots: 0,
      plants: 0,
      defuses: 0,
      score: 0,
    };
  }
}
