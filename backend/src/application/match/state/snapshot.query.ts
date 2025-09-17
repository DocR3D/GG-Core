import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis-keys';
import { SidesScoreService, Phase } from './sides-score.service';

type TeamsDoc = {
  ct_id?: string | null;
  t_id?: string | null;
  home_id?: string | null;
  away_id?: string | null;
  ct_name?: string | null;
  t_name?: string | null;
  home_name?: string | null;
  away_name?: string | null;
};

@Injectable()
export class SnapshotQuery {
  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly sidesScore: SidesScoreService,
  ) {}

  async getSnapshot(matchId: string) {
    const [
      sides,
      scoreHash,
      timeoutsHash, // (laisse-le si tu l'utilises ailleurs; sinon pourra être retiré plus tard)
      teamsRaw,
      econTeam,
      playersMoney,
      playersEquip,
      pauseHash,
      homeIds,
      awayIds,
    ] = await Promise.all([
      this.sidesScore.getSides(matchId),
      this.redis.hgetall(redisConst.score(matchId)),
      this.redis.hgetall(redisConst.timeouts(matchId)),
      this.redis.get(redisConst.teams(matchId)),
      this.redis.hgetall(redisConst.economyTeam(matchId)),
      this.redis.hgetall(redisConst.moneyHash(matchId)),
      this.redis.hgetall(redisConst.equipHash(matchId)),
      this.redis.hgetall(redisConst.pause(matchId)),
      this.redis.lrange(redisConst.lineupHome(matchId), 0, -1),
      this.redis.lrange(redisConst.lineupAway(matchId), 0, -1),
    ]);

    const teams: TeamsDoc = safeParseTeams(teamsRaw);

    const ctId =
      (teams.ct_id ?? null) ??
      (sides ? (sides.home === 'CT' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

    const tId =
      (teams.t_id ?? null) ??
      (sides ? (sides.home === 'T' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

    // Players $ / equip
    const players: Record<string, { money: number; equip: number }> = {};
    const ids = new Set([
      ...Object.keys(playersMoney || {}),
      ...Object.keys(playersEquip || {}),
    ]);
    for (const id of ids) {
      players[id] = {
        money: toInt(playersMoney?.[id]),
        equip: toInt(playersEquip?.[id]),
      };
    }

    // Banks agrégées
    const sum = (arr: string[]) => arr.reduce((acc, id) => acc + (players[id]?.money || 0), 0);
    const homeBank = sum(homeIds);
    const awayBank = sum(awayIds);

    // ————————————
    // Pause & banques tactiques (nouveau modèle)
    // ————————————
    const pauseState = (pauseHash?.state as 'paused' | 'none') || 'none';
    const pauseReason = (pauseHash?.reason as 'tactical' | 'technical' | 'admin' | undefined) || undefined;
    const pauseTeam = (pauseHash?.team as 'home' | 'away' | 'system' | undefined) || undefined;
    const startedAtMs = toInt(pauseHash?.started_at) || 0;

    // Banques tactiques “persistées”
    const tacHomeSec = toInt(pauseHash?.tac_bank_home) || 0;
    const tacAwaySec = toInt(pauseHash?.tac_bank_away) || 0;

    // Pendant une pause TACTIQUE, on montre aussi une vue "effective" (banque - temps écoulé)
    const now = Date.now();
    const elapsedSec = (pauseState === 'paused' && pauseReason === 'tactical' && startedAtMs)
      ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
      : 0;

    let effectiveHomeTacSec = tacHomeSec;
    let effectiveAwayTacSec = tacAwaySec;
    if (pauseState === 'paused' && pauseReason === 'tactical') {
      if (pauseTeam === 'home') effectiveHomeTacSec = Math.max(0, tacHomeSec - elapsedSec);
      if (pauseTeam === 'away') effectiveAwayTacSec = Math.max(0, tacAwaySec - elapsedSec);
    }

    return {
      matchId,
      sides,
      score: {
        t: toInt(scoreHash?.t),
        ct: toInt(scoreHash?.ct),
        round: toInt(scoreHash?.round) || 1,
        phase: (scoreHash?.phase as Phase) ?? 'freeze',
      },

      // ⚠️ Section "timeouts" devient une banque en secondes (tactiques).
      // Garde l'ancien timeoutsHash si tu l’exposes encore côté UI ; sinon, tu peux le retirer plus tard.
      timeouts: {
        // banques “persistées” (valeur de référence)
        homeTacSec: tacHomeSec,
        awayTacSec: tacAwaySec,
        // vue “live” pendant une pause tactique (utilisable pour countdown UI)
        effective: {
          homeTacSec: effectiveHomeTacSec,
          awayTacSec: effectiveAwayTacSec,
          elapsedSec, // utile au front
        },
        // champs techniques hérités (optionnels / legacy) — à déprécier
        homeTech: toInt(timeoutsHash?.homeTech),
        awayTech: toInt(timeoutsHash?.awayTech),
      },

      // Nouvel objet "pause" clair pour le front
      pause: {
        state: pauseState,                 // 'paused' | 'none'
        reason: pauseReason,               // 'tactical' | 'technical' | 'admin' | undefined
        team: pauseTeam,                   // 'home' | 'away' | 'system' | undefined
        startedAt: startedAtMs || null,    // ts ms ou null
      },

      teams: {
        ct_id: ctId,
        t_id: tId,
        home_id: teams.home_id ?? null,
        away_id: teams.away_id ?? null,
        ct_name: teams.ct_name ?? 'CT',
        t_name: teams.t_name ?? 'T',
        home_name: teams.home_name ?? null,
        away_name: teams.away_name ?? null,
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
}


function toInt(v?: string | null): number {
  return v == null ? 0 : Number.parseInt(v, 10) || 0;
}

function safeParseTeams(raw: string | null): TeamsDoc {
  if (!raw) {
    return {
      ct_id: null, t_id: null,
      home_id: null, away_id: null,
      ct_name: null, t_name: null,
      home_name: null, away_name: null,
    };
  }
  try {
    const obj = JSON.parse(raw) as TeamsDoc;
    return obj ?? {
      ct_id: null, t_id: null,
      home_id: null, away_id: null,
      ct_name: null, t_name: null,
      home_name: null, away_name: null,
    };
  } catch {
    return {
      ct_id: null, t_id: null,
      home_id: null, away_id: null,
      ct_name: null, t_name: null,
      home_name: null, away_name: null,
    };
  }
}
