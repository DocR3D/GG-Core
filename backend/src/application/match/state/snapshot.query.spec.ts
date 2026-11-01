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
          return Promise.resolve({ '76561198000000001': '4500', '76561198000000002': '1800' });
        }
        if (key.includes(':equip')) {
          return Promise.resolve({ '76561198000000001': '3200', '76561198000000002': '4200' });
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
        if (key.includes(':player_stats')) {
          return Promise.resolve({
            '76561198000000001': JSON.stringify({ steamId: '76561198000000001', name: 'ZywOo', kills: 14, deaths: 8, assists: 3, headshots: 7, score: 31 }),
            '76561198000000002': JSON.stringify({ steamId: '76561198000000002', name: 'EliGE', kills: 12, deaths: 9, assists: 2, headshots: 6, score: 26 }),
          });
        }
        if (key.includes(':players')) {
          return Promise.resolve({
            '76561198000000001': JSON.stringify({ steamId: '76561198000000001', name: 'ZywOo', logical: 'home' }),
            '76561198000000002': JSON.stringify({ steamId: '76561198000000002', name: 'EliGE', logical: 'away' }),
          });
        }
        return Promise.resolve({});
      }),
      lrange: jest.fn().mockImplementation((key: string) => {
        if (key.includes(':lineup:home')) {
          return Promise.resolve(['76561198000000001']);
        }
        if (key.includes(':lineup:away')) {
          return Promise.resolve(['76561198000000002']);
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

    it('devrait inclure un scoreboard complet avec statistiques de combat par équipe et hsPercent', async () => {
      const snapshot = await query.getSnapshot('m-test-1');

      expect(snapshot.scoreboard).toBeDefined();
      expect(snapshot.scoreboard.ct).toHaveLength(1);
      expect(snapshot.scoreboard.t).toHaveLength(1);
      expect(snapshot.scoreboard.home).toHaveLength(1);
      expect(snapshot.scoreboard.away).toHaveLength(1);
      expect(snapshot.scoreboard.home[0].name).toBe('ZywOo');
      expect(snapshot.scoreboard.away[0].name).toBe('EliGE');

      // CT player (ZywOo)
      const ctPlayer = snapshot.scoreboard.ct[0];
      expect(ctPlayer.name).toBe('ZywOo');
      expect(ctPlayer.side).toBe('CT');
      expect(ctPlayer.kills).toBe(14);
      expect(ctPlayer.deaths).toBe(8);
      expect(ctPlayer.assists).toBe(3);
      expect(ctPlayer.headshots).toBe(7);
      expect(ctPlayer.hsPercent).toBe(50); // 7/14 = 50%
      expect(ctPlayer.score).toBe(31);
      expect(ctPlayer.money).toBe(4500);
      expect(ctPlayer.equip).toBe(3200);

      // T player (EliGE)
      const tPlayer = snapshot.scoreboard.t[0];
      expect(tPlayer.name).toBe('EliGE');
      expect(tPlayer.side).toBe('T');
      expect(tPlayer.kills).toBe(12);
      expect(tPlayer.deaths).toBe(9);
      expect(tPlayer.assists).toBe(2);
      expect(tPlayer.headshots).toBe(6);
      expect(tPlayer.hsPercent).toBe(50); // 6/12 = 50%
      expect(tPlayer.score).toBe(26);
      expect(tPlayer.money).toBe(1800);
      expect(tPlayer.equip).toBe(4200);
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

    it('devrait maintenir le joueur dans scoreboard.home même lorsque sides s\'inverse à la mi-temps ({ home: "T", away: "CT" })', async () => {
      mockSidesScore.getSides.mockResolvedValue({ home: 'T', away: 'CT' });

      const snapshot = await query.getSnapshot('m-test-1');

      // Home player ZywOo reste dans home, mais son side courant est devenu T !
      expect(snapshot.scoreboard.home).toHaveLength(1);
      expect(snapshot.scoreboard.home[0].name).toBe('ZywOo');
      expect(snapshot.scoreboard.home[0].side).toBe('T');
      expect(snapshot.scoreboard.home[0].logical).toBe('home');

      // Away player EliGE reste dans away, mais son side courant est devenu CT !
      expect(snapshot.scoreboard.away).toHaveLength(1);
      expect(snapshot.scoreboard.away[0].name).toBe('EliGE');
      expect(snapshot.scoreboard.away[0].side).toBe('CT');
      expect(snapshot.scoreboard.away[0].logical).toBe('away');

      // Et dans les listes CT/T :
      expect(snapshot.scoreboard.t[0].name).toBe('ZywOo');
      expect(snapshot.scoreboard.ct[0].name).toBe('EliGE');
    });

    it('devrait gérer un joueur sans statistiques (0 kill, 0 death) avec hsPercent: 0 et score: 0 sans NaN', async () => {
      mockRedis.hgetall.mockImplementation((key: string) => {
        if (key.includes(':teams')) {
          return Promise.resolve({ home_name: 'Team Vitality', away_name: 'Team Liquid' });
        }
        if (key.includes(':player_stats')) {
          return Promise.resolve({
            '76561198000000003': JSON.stringify({ kills: 0, deaths: 0, assists: 0, headshots: 0, score: 0 }),
          });
        }
        if (key.includes(':players')) {
          return Promise.resolve({
            '76561198000000003': JSON.stringify({ name: 'Newbie', logical: 'home' }),
          });
        }
        return Promise.resolve({});
      });
      mockRedis.lrange.mockImplementation((key: string) => {
        if (key.includes(':lineup:home')) return Promise.resolve(['76561198000000003']);
        return Promise.resolve([]);
      });

      const snapshot = await query.getSnapshot('m-test-zero');

      expect(snapshot.scoreboard.home).toHaveLength(1);
      const p = snapshot.scoreboard.home[0];
      expect(p.kills).toBe(0);
      expect(p.deaths).toBe(0);
      expect(p.hsPercent).toBe(0);
      expect(Number.isNaN(p.hsPercent)).toBe(false);
      expect(p.score).toBe(0);
    });

    it('devrait trier par score décroissant puis frags décroissants puis moins de morts', async () => {
      mockRedis.hgetall.mockImplementation((key: string) => {
        if (key.includes(':teams')) {
          return Promise.resolve({ home_name: 'Team Vitality', away_name: 'Team Liquid' });
        }
        if (key.includes(':player_stats')) {
          return Promise.resolve({
            'p1': JSON.stringify({ kills: 5, deaths: 3, score: 12 }),
            'p2': JSON.stringify({ kills: 6, deaths: 2, score: 12 }), // même score, mais plus de kills
            'p3': JSON.stringify({ kills: 10, deaths: 5, score: 25 }), // meilleur score
          });
        }
        if (key.includes(':players')) {
          return Promise.resolve({
            'p1': JSON.stringify({ name: 'Player_1', logical: 'home' }),
            'p2': JSON.stringify({ name: 'Player_2', logical: 'home' }),
            'p3': JSON.stringify({ name: 'Player_3', logical: 'home' }),
          });
        }
        return Promise.resolve({});
      });
      mockRedis.lrange.mockImplementation((key: string) => {
        if (key.includes(':lineup:home')) return Promise.resolve(['p1', 'p2', 'p3']);
        return Promise.resolve([]);
      });

      const snapshot = await query.getSnapshot('m-test-sort');

      expect(snapshot.scoreboard.home.map(p => p.name)).toEqual(['Player_3', 'Player_2', 'Player_1']);
    });

    it('devrait inclure les streaks et bonus économiques à la racine du snapshot', async () => {
      mockRedis.hgetall.mockImplementation((key: string) => {
        if (key.includes(':economy:team')) {
          return Promise.resolve({
            round: '6',
            home_loss_streak: '0',
            away_loss_streak: '3',
            home_loss_bonus: '1400',
            away_loss_bonus: '2900',
            home_win_streak: '4',
            away_win_streak: '0',
          });
        }
        return Promise.resolve({});
      });

      const snapshot = await query.getSnapshot('m-test-streaks');

      expect(snapshot.streaks).toBeDefined();
      expect(snapshot.streaks.home.win).toBe(4);
      expect(snapshot.streaks.home.loss).toBe(0);
      expect(snapshot.streaks.away.win).toBe(0);
      expect(snapshot.streaks.away.loss).toBe(3);
      expect(snapshot.streaks.away.lossBonus).toBe(2900);
    });
  });
});
