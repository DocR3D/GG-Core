// src/application/match/state/economy.service.spec.ts
import { EconomyService } from './economy.service';
import type { SidesScoreService } from './sides-score.service';
import type { TeamsRosterService } from './rosters.service';

describe('EconomyService', () => {
  let service: EconomyService;
  let mockRedis: any;
  let mockSidesScore: any;
  let mockTeamsRoster: any;
  const MATCH_ID = 'm-test-econ';

  beforeEach(() => {
    const memoryHash: Record<string, string> = {};

    mockRedis = {
      hset: jest.fn().mockImplementation((key: string, data: Record<string, string>) => {
        Object.assign(memoryHash, data);
        return Promise.resolve(Object.keys(data).length);
      }),
      hgetall: jest.fn().mockImplementation(() => Promise.resolve({ ...memoryHash })),
      hincrby: jest.fn().mockImplementation((key: string, field: string, incr: number) => {
        const val = parseInt(memoryHash[field] || '0', 10) + incr;
        memoryHash[field] = String(val);
        return Promise.resolve(val);
      }),
    };

    mockSidesScore = {
      getRound: jest.fn().mockResolvedValue(1),
      sideToLogical: jest.fn().mockImplementation((_mid: string, side: string) => {
        return side === 'CT' ? 'home' : 'away';
      }),
      addPoint: jest.fn().mockResolvedValue(undefined),
    };

    mockTeamsRoster = {
      setPlayerMoney: jest.fn().mockResolvedValue(undefined),
      setPlayerEquipValue: jest.fn().mockResolvedValue(undefined),
    };

    service = new EconomyService(
      mockRedis,
      mockSidesScore as unknown as SidesScoreService,
      mockTeamsRoster as unknown as TeamsRosterService,
    );
  });

  it('devrait initialiser l\'économie avec tous les streaks à zéro', async () => {
    await service.initEconomy(MATCH_ID);
    const meta = await service.getTeamEconomyMeta(MATCH_ID);

    expect(meta.home_win_streak).toBe(0);
    expect(meta.away_win_streak).toBe(0);
    expect(meta.home_loss_streak).toBe(0);
    expect(meta.away_loss_streak).toBe(0);
    expect(meta.home_loss_bonus).toBe(0);
    expect(meta.away_loss_bonus).toBe(0);
  });

  it('devrait incrémenter le win_streak du vainqueur et le loss_streak du perdant', async () => {
    await service.initEconomy(MATCH_ID);

    // Round 1 : Home (CT) gagne
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');
    let meta = await service.getTeamEconomyMeta(MATCH_ID);

    expect(meta.home_win_streak).toBe(1);
    expect(meta.away_win_streak).toBe(0);
    expect(meta.home_loss_streak).toBe(0);
    expect(meta.away_loss_streak).toBe(1);
    expect(meta.away_loss_bonus).toBe(1400); // 1 défaite = palier 1 ($1,400)

    // Round 2 : Home (CT) gagne encore (série de 2)
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');
    meta = await service.getTeamEconomyMeta(MATCH_ID);

    expect(meta.home_win_streak).toBe(2);
    expect(meta.away_win_streak).toBe(0);
    expect(meta.away_loss_streak).toBe(2);
    expect(meta.away_loss_bonus).toBe(1900); // 2 défaites = palier 2 ($1,900)
  });

  it('devrait réinitialiser le win_streak du perdant à 0 et décrémenter son loss_streak de 1 lors d\'une victoire', async () => {
    await service.initEconomy(MATCH_ID);

    // Home gagne 2 rounds d'affilée
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');

    // Round 3 : Away (T) gagne
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'T');
    const meta = await service.getTeamEconomyMeta(MATCH_ID);

    // Away : première victoire -> win_streak = 1, loss_streak passe de 2 à 1
    expect(meta.away_win_streak).toBe(1);
    expect(meta.away_loss_streak).toBe(1);
    expect(meta.away_loss_bonus).toBe(1400);

    // Home : subit sa 1ère défaite -> win_streak retombe immédiatement à 0, loss_streak = 1
    expect(meta.home_win_streak).toBe(0);
    expect(meta.home_loss_streak).toBe(1);
    expect(meta.home_loss_bonus).toBe(1400);
  });

  it('devrait plafonner le loss_streak à 5 ($3,400) selon le barème Valve CS2', async () => {
    await service.initEconomy(MATCH_ID);

    // 6 victoires d'affilée de Home
    for (let i = 0; i < 6; i++) {
      await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');
    }

    const meta = await service.getTeamEconomyMeta(MATCH_ID);
    expect(meta.home_win_streak).toBe(6);
    expect(meta.away_loss_streak).toBe(5); // Plafonné à 5 crans
    expect(meta.away_loss_bonus).toBe(3400); // Plafond économique Valve CS2 ($3,400)
  });

  it('devrait remettre à zéro les streaks lors de resetStreaks', async () => {
    await service.initEconomy(MATCH_ID);
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');
    await service.updateEconomyOnRoundEnd(MATCH_ID, 'CT');

    await service.resetStreaks(MATCH_ID);
    const meta = await service.getTeamEconomyMeta(MATCH_ID);

    expect(meta.home_win_streak).toBe(0);
    expect(meta.away_win_streak).toBe(0);
    expect(meta.home_loss_streak).toBe(0);
    expect(meta.away_loss_streak).toBe(0);
  });
});
