import { SidesScoreService } from './sides-score.service';
import { redisConst } from './redis.keys';
import { DEFAULT_MATCH_SETTINGS } from '@domain/match-settings.types';

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

  describe('settings', () => {
    it('persiste et relit la banque de pause tactique configurée pour le match', async () => {
      await service.setSettings(MATCH_ID, { tacticalPauseBankSec: 240, postgameResetDelaySec: 45 });
      const settings = await service.getSettings(MATCH_ID);
      expect(settings.tacticalPauseBankSec).toBe(240);
      expect(settings.postgameResetDelaySec).toBe(45);
    });

    it("applique les valeurs par défaut quand rien n'est configuré", async () => {
      const settings = await service.getSettings(MATCH_ID);
      expect(settings.tacticalPauseBankSec).toBe(DEFAULT_MATCH_SETTINGS.tacticalPauseBankSec);
    });
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

    it('inverts ct_name and t_name in teams hash during swapSides', async () => {
      await service.setSides(MATCH_ID, { home: 'CT', away: 'T' });
      redisStore.set(redisConst.teams(MATCH_ID), {
        home_name: 'Vitality',
        away_name: 'Liquid',
        ct_name: 'Vitality',
        t_name: 'Liquid',
      });

      await service.swapSides(MATCH_ID);

      const teams = redisStore.get(redisConst.teams(MATCH_ID));
      expect(teams.ct_name).toBe('Liquid');
      expect(teams.t_name).toBe('Vitality');
      expect(teams.home_name).toBe('Vitality');
      expect(teams.away_name).toBe('Liquid');
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

  describe('sideToLogical & logicalToSide', () => {
    it('utilise le fallback CT=home et T=away si les sides ne sont pas encore initialisés dans Redis', async () => {
      // Aucun sides stocké dans redisStore
      expect(await service.sideToLogical('m-unset', 'CT')).toBe('home');
      expect(await service.sideToLogical('m-unset', 'TERRORIST')).toBe('away');
      expect(await service.logicalToSide('m-unset', 'home')).toBe('CT');
      expect(await service.logicalToSide('m-unset', 'away')).toBe('T');
    });

    it('résout correctement selon les sides configurés', async () => {
      await service.setSides(MATCH_ID, { home: 'T', away: 'CT' });
      expect(await service.sideToLogical(MATCH_ID, 'T')).toBe('home');
      expect(await service.sideToLogical(MATCH_ID, 'CT')).toBe('away');
      expect(await service.logicalToSide(MATCH_ID, 'home')).toBe('T');
      expect(await service.logicalToSide(MATCH_ID, 'away')).toBe('CT');
    });
  });
});
