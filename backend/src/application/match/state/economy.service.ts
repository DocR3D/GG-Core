import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from './redis.keys';
import { SidesScoreService, GameSide, Logical } from './sides-score.service';
import { TeamsRosterService } from './rosters.service';

export type TeamEconomyMeta = {
  round: number;
  home_loss_streak: number;
  away_loss_streak: number;
  home_loss_bonus: number;
  away_loss_bonus: number;
};

const LOSS_BONUS_TABLE = [1400, 1900, 2400, 2900, 3400];
function lossBonusFromStreak(streak: number): number {
  if (streak <= 0) return 0;
  const idx = Math.min(streak, LOSS_BONUS_TABLE.length) - 1;
  return LOSS_BONUS_TABLE[idx];
}
const toInt = (v?: string | null) => (v == null ? 0 : parseInt(v, 10) || 0);

@Injectable()
export class EconomyService {
  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly sidesScore: SidesScoreService,
    private readonly teamsRoster: TeamsRosterService,
  ) {}

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
      round: toInt(h?.round) || (await this.sidesScore.getRound(matchId)),
      home_loss_streak: toInt(h?.home_loss_streak),
      away_loss_streak: toInt(h?.away_loss_streak),
      home_loss_bonus: toInt(h?.home_loss_bonus),
      away_loss_bonus: toInt(h?.away_loss_bonus),
    };
  }

  async setTeamLossStreak(matchId: string, logical: Logical, streak: number) {
    const sField = logical === 'home' ? 'home_loss_streak' : 'away_loss_streak';
    const bField = logical === 'home' ? 'home_loss_bonus'  : 'away_loss_bonus';
    const bonus = lossBonusFromStreak(streak);
    await this.redis.hset(redisConst.economyTeam(matchId), {
      [sField]: String(streak),
      [bField]: String(bonus),
    });
  }

  async updateEconomyOnRoundEnd(matchId: string, winnerSide: GameSide) {
    const winnerLogical = await this.sidesScore.sideToLogical(matchId, winnerSide);
    if (!winnerLogical) return false;
    const loserLogical: Logical = winnerLogical === 'home' ? 'away' : 'home';

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

  /**
   * Orchestration de fin de round.
   * 1) Score++
   * 2) MAJ loss streak / bonus
   * 3) MAJ économies joueurs (facultatif)
   */
  async roundEnd(
    matchId: string,
    winnerSide: GameSide,
    playerEconomy?: { steamId: string; money: number; equip: number }[],
  ) {
    await this.sidesScore.addPoint(matchId, winnerSide);
    await this.updateEconomyOnRoundEnd(matchId, winnerSide);

    if (playerEconomy && playerEconomy.length) {
      for (const p of playerEconomy) {
        await this.teamsRoster.setPlayerMoney(matchId, p.steamId, p.money);
        await this.teamsRoster.setPlayerEquipValue(matchId, p.steamId, p.equip);
      }
    }
    return { ok: true };
  }
}
