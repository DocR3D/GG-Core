import { SidesScoreService } from './sides-score.service';
import { redisConst } from './redis.keys';

describe('SidesScoreService', () => {
  let service: SidesScoreService;
  let mockRedis: any;
  let redisStore: Map<string, any>;

  const MATCH_ID = 'm-sides-test';

  beforeEach(() => {
    redisStore = new Map<string, any>();

    mockRedis = {
      hget: jest.fn(async (key: string, field: string) => {
        const hash = redisStore.get(key) || {};
        return hash[field] ?? null;
      }),
      hgetall: jest.fn(async (key: string) => {
        return redisStore.get(key) || {};
      }),
      hset: jest.fn(async (key: string, data: Record<string, string>) => {
        const existing = redisStore.get(key) || {};
        redisStore.set(key, { ...existing, ...data });
        return 1;
      }),
      get: jest.fn(async (key: string) => {
        return redisStore.get(key) ?? null;
      }),
      set: jest.fn(async (key: string, val: any) => {
        redisStore.set(key, val);
        return 'OK';
      }),
      multi: jest.fn(() => {
        const queue: (() => void)[] = [];
        const multiObj = {
          hincrby: (key: string, field: string, increment: number) => {
            queue.push(() => {
              const hash = redisStore.get(key) || {};
              const cur = parseInt(hash[field] || '0', 10);
              hash[field] = String(cur + increment);
              redisStore.set(key, hash);
            });
            return multiObj;
          },
          exec: async () => {
            for (const fn of queue) fn();
            return [];
          },
        };
        return multiObj;
      }),
    };

    service = new SidesScoreService(mockRedis);
  });

  describe('swapSides', () => {
    it('returns false if match sides are not configured in Redis', async () => {
      const swapped = await service.swapSides(MATCH_ID);
      expect(swapped).toBe(false);
    });

    it('inverts home and away sides AND inverts score.ct and score.t in Redis', async () => {
      // Étape 1 : Initialiser les camps (Home sur CT, Away sur T)
      await service.setSides(MATCH_ID, { home: 'CT', away: 'T' });

      // Initialiser le score à la mi-temps : CT 7 - 5 T (Home 7, Away 5)
      redisStore.set(redisConst.score(MATCH_ID), {
        ct: '7',
        t: '5',
        home: '7',
        away: '5',
        round: '12',
      });

      // Étape 2 : Déclencher le changement de camp
      const swapped = await service.swapSides(MATCH_ID);
      expect(swapped).toBe(true);

      // Vérifier que les camps ont été inversés
      const sides = await service.getSides(MATCH_ID);
      expect(sides).toEqual({ home: 'T', away: 'CT' });

      // Vérifier que les scores CT et T ont été inversés en cohérence
      // Team Away est maintenant CT -> CT doit valoir 5 !
      // Team Home est maintenant T -> T doit valoir 7 !
      const score = await service.getScore(MATCH_ID);
      expect(score.ct).toBe(5);
      expect(score.t).toBe(7);
      expect(score.home).toBe(7);
      expect(score.away).toBe(5);
      expect(score.round).toBe(12);
    });
  });

  describe('reconcileScore', () => {
    it('sets authoritative CT and T scores and maps home/away properly when Home is on T', async () => {
      // Home est sur T, Away est sur CT (après mi-temps)
      await service.setSides(MATCH_ID, { home: 'T', away: 'CT' });

      // Score officiel rapporté par CS2 : CT 12 - 12 T
      await service.reconcileScore(MATCH_ID, 12, 12);

      const score = await service.getScore(MATCH_ID);
      expect(score.ct).toBe(12);
      expect(score.t).toBe(12);
      expect(score.home).toBe(12);
      expect(score.away).toBe(12);
      expect(score.round).toBe(24);
    });
  });

  describe('addPoint', () => {
    it('properly increments winning side and corresponding team logical', async () => {
      await service.setSides(MATCH_ID, { home: 'CT', away: 'T' });
      redisStore.set(redisConst.score(MATCH_ID), {
        ct: '0',
        t: '0',
        home: '0',
        away: '0',
        round: '0',
      });

      // CT marque un point -> Home gagne 1 point, CT gagne 1 point
      await service.addPoint(MATCH_ID, 'CT');

      const s1 = await service.getScore(MATCH_ID);
      expect(s1.ct).toBe(1);
      expect(s1.t).toBe(0);
      expect(s1.home).toBe(1);
      expect(s1.away).toBe(0);
      expect(s1.round).toBe(1);

      // T marque un point -> Away gagne 1 point, T gagne 1 point
      await service.addPoint(MATCH_ID, 'T');

      const s2 = await service.getScore(MATCH_ID);
      expect(s2.ct).toBe(1);
      expect(s2.t).toBe(1);
      expect(s2.home).toBe(1);
      expect(s2.away).toBe(1);
      expect(s2.round).toBe(2);
    });
  });
});
