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
      timeoutsHash,
      teamsRaw,                     // ← string JSON
      econTeam,
      playersMoney,
      playersEquip,
    ] = await Promise.all([
      this.sidesScore.getSides(matchId),
      this.redis.hgetall(redisConst.score(matchId)),
      this.redis.hgetall(redisConst.timeouts(matchId)),
      this.redis.get(redisConst.teams(matchId)),         // ← GET (string)
      this.redis.hgetall(redisConst.economyTeam(matchId)),
      this.redis.hgetall(redisConst.moneyHash(matchId)),
      this.redis.hgetall(redisConst.equipHash(matchId)),
    ]);

    const teams: TeamsDoc = safeParseTeams(teamsRaw);

    const ctId =
      (teams.ct_id ?? null) ??
      (sides ? (sides.home === 'CT' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

    const tId =
      (teams.t_id ?? null) ??
      (sides ? (sides.home === 'T' ? (teams.home_id ?? null) : (teams.away_id ?? null)) : null);

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

    // banques agrégées
    const sum = (arr: string[]) => arr.reduce((acc, id) => acc + (players[id]?.money || 0), 0);
    const [homeIds, awayIds] = await Promise.all([
      this.redis.lrange(redisConst.lineupHome(matchId), 0, -1),
      this.redis.lrange(redisConst.lineupAway(matchId), 0, -1),
    ]);

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
        homeTac: toInt(timeoutsHash?.homeTac),
        awayTac: toInt(timeoutsHash?.awayTac),
        homeTech: toInt(timeoutsHash?.homeTech),
        awayTech: toInt(timeoutsHash?.awayTech),
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
