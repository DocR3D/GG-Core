// src/application/match/state/snapshot.query.spec.ts
import { SnapshotQuery } from './snapshot.query';
import { redisConst } from './redis.keys';
import { MatchPhase, RoundPhase } from '@domain/phase.types';
import type { SidesScoreService } from './sides-score.service';

describe('SnapshotQuery', () => {
  let query: SnapshotQuery;
  let mockRedis: any;
  let mockSidesScore: any;

  beforeEach(() => {
    mockRedis = {
      hgetall: jest.fn().mockImplementation((key: string) => {
        if (key.includes(':score')) {
          return Promise.resolve({ ct: '6', t: '5', round: '11', phase: 'freeze' });
        }
        if (key.includes(':timeouts')) {
          return Promise.resolve({});
        }
        if (key.includes(':economy:team')) {
          return Promise.resolve({ round: '11', home_loss_streak: '2', away_loss_streak: '0' });
        }
        if (key.includes(':money')) {
          return Promise.resolve({ '76561198000000001': '4500' });
        }
        if (key.includes(':equip')) {
          return Promise.resolve({ '76561198000000001': '3200' });
        }
        if (key.includes(':pause')) {
          return Promise.resolve({ state: 'none' });
        }
        if (key.includes(':teams')) {
          return Promise.resolve({
            ct_name: 'Team Vitality',
            t_name: 'Team Liquid',
            home_name: 'Team Vitality',
            away_name: 'Team Liquid',
          });
        }
        return Promise.resolve({});
      }),
      lrange: jest.fn().mockImplementation((key: string) => {
        if (key.includes(':lineup:home')) {
          return Promise.resolve(['76561198000000001']);
        }
        return Promise.resolve([]);
      }),
      get: jest.fn().mockImplementation((key: string) => {
        if (key.includes(':phase') && !key.includes(':roundPhase')) {
          return Promise.resolve(MatchPhase.LIVE_MAIN);
        }
        if (key.includes(':roundPhase')) {
          return Promise.resolve(RoundPhase.LIVE);
        }
        return Promise.resolve(null);
      }),
      type: jest.fn().mockResolvedValue('hash'),
    };

    mockSidesScore = {
      getSides: jest.fn().mockResolvedValue({ home: 'CT', away: 'T' }),
    };

    query = new SnapshotQuery(mockRedis, mockSidesScore as SidesScoreService);
  });

  it('devrait être défini', () => {
    expect(query).toBeDefined();
  });

  describe('getSnapshot', () => {
    it('devrait inclure la phase globale du match et roundPhase à la racine du snapshot', async () => {
      const snapshot = await query.getSnapshot('m-test-1');

      // 1. Vérification que la clé Redis match:{id}:phase est bien interrogée
      expect(mockRedis.get).toHaveBeenCalledWith(redisConst.phase('m-test-1'));
      expect(mockRedis.get).toHaveBeenCalledWith(redisConst.roundPhase('m-test-1'));

      // 2. Vérification que la phase n'est JAMAIS undefined
      expect(snapshot.phase).toBeDefined();
      expect(snapshot.phase).toBe(MatchPhase.LIVE_MAIN);

      // 3. Vérification du roundPhase
      expect(snapshot.roundPhase).toBeDefined();
      expect(snapshot.roundPhase).toBe(RoundPhase.LIVE);

      // 4. Vérification de la cohérence des scores et équipes
      expect(snapshot.score.ct).toBe(6);
      expect(snapshot.score.t).toBe(5);
      expect(snapshot.score.round).toBe(11);
      expect(snapshot.teams.home_name).toBe('Team Vitality');
      expect(snapshot.teams.away_name).toBe('Team Liquid');
    });

    it('devrait utiliser MatchPhase.WARMUP_MAIN comme repli si la clé match:{id}:phase est absente de Redis', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes(':phase') && !key.includes(':roundPhase')) {
          return Promise.resolve(null); // Clé Redis non initialisée
        }
        return Promise.resolve(null);
      });

      const snapshot = await query.getSnapshot('m-test-empty');

      expect(snapshot.phase).toBeDefined();
      expect(snapshot.phase).toBe(MatchPhase.WARMUP_MAIN);
    });

    it('devrait mapper correctement les prolongations (MatchPhase.OVERTIME)', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes(':phase') && !key.includes(':roundPhase')) {
          return Promise.resolve(MatchPhase.OVERTIME);
        }
        return Promise.resolve(null);
      });

      const snapshot = await query.getSnapshot('m-test-ot');

      expect(snapshot.phase).toBe(MatchPhase.OVERTIME);
    });
  });
});
