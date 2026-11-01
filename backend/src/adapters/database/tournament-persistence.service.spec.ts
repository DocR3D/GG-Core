import { Test, TestingModule } from '@nestjs/testing';
import { TournamentPersistenceService } from './tournament-persistence.service';
import { PrismaService } from './prisma.service';

describe('TournamentPersistenceService', () => {
  let service: TournamentPersistenceService;
  let prisma: {
    player: {
      upsert: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    playerMapStats: {
      upsert: jest.Mock;
      aggregate: jest.Mock;
      findMany: jest.Mock;
    };
    eventPrimary: {
      create: jest.Mock;
    };
    match: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    matchMap: {
      findUnique: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
    matchVeto: {
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      player: {
        upsert: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      playerMapStats: {
        upsert: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      eventPrimary: {
        create: jest.fn(),
      },
      match: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      matchMap: {
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      matchVeto: {
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentPersistenceService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<TournamentPersistenceService>(TournamentPersistenceService);
  });

  describe('resolvePlayer', () => {
    it('should upsert player when steamId is provided (Online / Authenticated)', async () => {
      const mockPlayer = {
        id: 'p-1',
        steamId: '76561198000000001',
        username: 'ZywOo',
        seatNumber: 'A1',
      };
      prisma.player.upsert.mockResolvedValue(mockPlayer);

      const result = await service.resolvePlayer({
        steamId: '76561198000000001',
        username: 'ZywOo',
        seatNumber: 'A1',
      });

      expect(prisma.player.upsert).toHaveBeenCalledWith({
        where: { steamId: '76561198000000001' },
        update: { username: 'ZywOo', seatNumber: 'A1' },
        create: {
          steamId: '76561198000000001',
          username: 'ZywOo',
          seatNumber: 'A1',
        },
      });
      expect(result).toEqual(mockPlayer);
    });

    it('should find or create offline player by username when steamId is null (LAN Offline Mode)', async () => {
      prisma.player.findFirst.mockResolvedValue(null);
      const mockCreated = {
        id: 'p-offline-1',
        steamId: null,
        username: 'Garitos',
        seatNumber: 'B12',
      };
      prisma.player.create.mockResolvedValue(mockCreated);

      const result = await service.resolvePlayer({
        steamId: null,
        username: 'Garitos',
        seatNumber: 'B12',
      });

      expect(prisma.player.findFirst).toHaveBeenCalledWith({
        where: { steamId: null, username: 'Garitos' },
      });
      expect(prisma.player.create).toHaveBeenCalledWith({
        data: {
          steamId: null,
          username: 'Garitos',
          seatNumber: 'B12',
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should update seatNumber when offline player exists with different seat', async () => {
      const existing = {
        id: 'p-offline-1',
        steamId: null,
        username: 'Garitos',
        seatNumber: 'OldSeat',
      };
      prisma.player.findFirst.mockResolvedValue(existing);
      prisma.player.update.mockResolvedValue({
        ...existing,
        seatNumber: 'NewSeat',
      });

      const result = await service.resolvePlayer({
        username: 'Garitos',
        seatNumber: 'NewSeat',
      });

      expect(prisma.player.update).toHaveBeenCalledWith({
        where: { id: 'p-offline-1' },
        data: { seatNumber: 'NewSeat' },
      });
      expect(result.seatNumber).toBe('NewSeat');
    });
  });

  describe('recordPlayerKill', () => {
    it('should increment kills, headshots and damage on headshot', async () => {
      prisma.playerMapStats.upsert.mockResolvedValue({ id: 'stat-1' });

      await service.recordPlayerKill({
        matchMapId: 'map-1',
        playerId: 'p-1',
        teamId: 'team-1',
        isHeadshot: true,
        damageDealt: 105,
      });

      expect(prisma.playerMapStats.upsert).toHaveBeenCalledWith({
        where: {
          matchMapId_playerId: {
            matchMapId: 'map-1',
            playerId: 'p-1',
          },
        },
        update: {
          kills: { increment: 1 },
          headshots: { increment: 1 },
          damageDealt: { increment: 105 },
        },
        create: {
          matchMapId: 'map-1',
          playerId: 'p-1',
          teamId: 'team-1',
          kills: 1,
          headshots: 1,
          damageDealt: 105,
        },
      });
    });

    it('should not increment headshots on body kill', async () => {
      prisma.playerMapStats.upsert.mockResolvedValue({ id: 'stat-2' });

      await service.recordPlayerKill({
        matchMapId: 'map-1',
        playerId: 'p-2',
        teamId: 'team-2',
        isHeadshot: false,
        damageDealt: 80,
      });

      expect(prisma.playerMapStats.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            kills: { increment: 1 },
            damageDealt: { increment: 80 },
          },
        }),
      );
    });
  });

  describe('recordGameResult', () => {
    const MAP_UUID = '11111111-1111-4111-8111-111111111111';
    const TEAM_UUID = '22222222-2222-4222-8222-222222222222';

    it('écrit le résultat générique du game : score, vainqueur, source, statut, auteur', async () => {
      prisma.matchMap.findUnique.mockResolvedValue({ id: MAP_UUID, matchId: 'x', match: { format: 'BO3' } });
      await service.recordGameResult({
        matchMapId: MAP_UUID, scoreHome: 13, scoreAway: 11, winnerTeamId: TEAM_UUID,
        source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
      });
      expect(prisma.matchMap.update).toHaveBeenCalledWith({
        where: { id: MAP_UUID },
        data: expect.objectContaining({
          scoreHome: 13, scoreAway: 11, winnerId: TEAM_UUID, status: 'FINISHED',
          resultSource: 'AUTOMATIC', resultStatus: 'CONFIRMED', reportedBy: 'cs2',
        }),
      });
    });

    it('nul : vainqueur null', async () => {
      prisma.matchMap.findUnique.mockResolvedValue({ id: MAP_UUID, matchId: 'x', match: { format: 'BO1' } });
      await service.recordGameResult({
        matchMapId: MAP_UUID, scoreHome: 15, scoreAway: 15, winnerTeamId: null,
        source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
      });
      expect(prisma.matchMap.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ winnerId: null }),
      }));
    });

    it('ne fait rien pour un match non rattaché au modèle relationnel (identifiant temps réel)', async () => {
      expect(await service.recordGameResult({
        matchMapId: 'm-sandbox-1', scoreHome: 1, scoreAway: 0, winnerTeamId: null,
        source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
      })).toBeNull();
      expect(prisma.matchMap.update).not.toHaveBeenCalled();
    });
  });

  describe('séries et saisie admin', () => {
    const MATCH = '33333333-3333-4333-8333-333333333333';
    const HOME = '44444444-4444-4444-8444-444444444444';
    const AWAY = '55555555-5555-4555-8555-555555555555';
    const game = (winnerId: string | null, status = 'CONFIRMED') => ({ winnerId, resultStatus: status });
    const series = (format: string, maps: any[], status = 'LIVE', advantageHome = 0) =>
      ({ id: MATCH, format, status, teamHomeId: HOME, teamAwayId: AWAY, advantageHome, advantageAway: 0, maps });

    it('BO3 à 1-0 : met à jour le score de la série sans terminer le match', async () => {
      prisma.match.findUnique.mockResolvedValue(series('BO3', [game(HOME)]));
      const advance = jest.spyOn(service, 'advanceBracketMatch');
      await expect(service.updateSeries(MATCH)).resolves.toEqual({ scoreHome: 1, scoreAway: 0, winnerId: null });
      expect(prisma.match.update).toHaveBeenCalledWith({ where: { id: MATCH }, data: { scoreHome: 1, scoreAway: 0 } });
      expect(advance).not.toHaveBeenCalled();
    });

    it('BO3 à 2-1 : termine la série et fait avancer l’arbre (les games non confirmés ne comptent pas)', async () => {
      prisma.match.findUnique.mockResolvedValue(
        series('BO3', [game(HOME), game(AWAY), game(AWAY, 'DISPUTED'), game(HOME)]),
      );
      const advance = jest.spyOn(service, 'advanceBracketMatch').mockResolvedValue({} as any);
      await expect(service.updateSeries(MATCH)).resolves.toEqual({ scoreHome: 2, scoreAway: 1, winnerId: HOME });
      expect(advance).toHaveBeenCalledWith(MATCH, HOME);
    });

    it("grande finale BO3 avec une map d'avance : une seule map gagnée suffit au finaliste du bracket supérieur", async () => {
      prisma.match.findUnique.mockResolvedValue(series('BO3', [game(HOME)], 'LIVE', 1));
      const advance = jest.spyOn(service, 'advanceBracketMatch').mockResolvedValue({} as any);
      await expect(service.updateSeries(MATCH)).resolves.toEqual({ scoreHome: 2, scoreAway: 0, winnerId: HOME });
      expect(advance).toHaveBeenCalledWith(MATCH, HOME);
    });

    it('ne refait jamais avancer une série déjà terminée', async () => {
      prisma.match.findUnique.mockResolvedValue(series('BO1', [game(AWAY)], 'FINISHED'));
      const advance = jest.spyOn(service, 'advanceBracketMatch');
      await service.updateSeries(MATCH);
      expect(advance).not.toHaveBeenCalled();
    });

    it('saisie admin : écrit le game en MANUAL / CONFIRMED avec le vainqueur déduit du score', async () => {
      prisma.match.findUnique.mockResolvedValue(series('BO3', []));
      jest.spyOn(service, 'updateSeries').mockResolvedValue({ scoreHome: 0, scoreAway: 1, winnerId: null });
      await service.recordManualGameResult({ matchId: MATCH, mapOrder: 1, scoreHome: 9, scoreAway: 13, mapName: 'de_nuke', reportedBy: 'admin' });
      expect(prisma.matchMap.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { matchId_mapOrder: { matchId: MATCH, mapOrder: 1 } },
        create: expect.objectContaining({ mapName: 'de_nuke', winnerId: AWAY, resultSource: 'MANUAL', resultStatus: 'CONFIRMED', reportedBy: 'admin' }),
      }));
    });

    it.each([
      ['série terminée', series('BO1', [], 'FINISHED'), { mapOrder: 1 }, 'finished'],
      ['game hors format (4ᵉ game d’un BO3)', series('BO3', []), { mapOrder: 4 }, 'invalid'],
      ['score négatif', series('BO3', []), { mapOrder: 1, scoreHome: -1 }, 'invalid'],
      ['équipes inconnues', { ...series('BO3', []), teamAwayId: null }, { mapOrder: 1 }, 'teams_missing'],
    ])('refuse la saisie : %s', async (_label, match, override, code) => {
      prisma.match.findUnique.mockResolvedValue(match);
      await expect(service.recordManualGameResult({
        matchId: MATCH, scoreHome: 13, scoreAway: 5, reportedBy: 'admin', mapOrder: 1, ...(override as any),
      })).rejects.toMatchObject({ code });
      expect(prisma.matchMap.upsert).not.toHaveBeenCalled();
    });

    describe('nuls', () => {
      const draw = { matchId: MATCH, mapOrder: 1, scoreHome: 12, scoreAway: 12, reportedBy: 'admin' };

      it.each([
        ['bracket du haut', { stageId: 'st', bracketType: 'UPPER' }],
        ['bracket du bas', { stageId: 'st', bracketType: 'LOWER' }],
        ['grande finale', { stageId: 'st', bracketType: 'FINAL' }],
        ['ancien arbre sans phase (relié au match suivant)', { stageId: null, bracketType: 'UPPER', nextMatchId: 'n' }],
        ['match bonus de classement', { stageId: null, bracketType: 'UPPER', placement: 7 }],
      ])('refuse un nul saisi pour un match qui doit avoir un vainqueur : %s', async (_l, over) => {
        prisma.match.findUnique.mockResolvedValue({ ...series('BO1', []), ...over });
        await expect(service.recordManualGameResult(draw)).rejects.toMatchObject({ code: 'invalid' });
        expect(prisma.matchMap.upsert).not.toHaveBeenCalled();
      });

      it.each([
        ['match de poule', { stageId: 'st', bracketType: 'ROUND_ROBIN' }],
        ['match bonus « fun » (bracketType UPPER par défaut, hors phase)', { stageId: null, bracketType: 'UPPER', placement: null }],
      ])('accepte un nul : %s', async (_l, over) => {
        prisma.match.findUnique.mockResolvedValue({ ...series('BO1', []), ...over });
        jest.spyOn(service, 'updateSeries').mockResolvedValue({ scoreHome: 0, scoreAway: 0, winnerId: null });
        await service.recordManualGameResult(draw);
        expect(prisma.matchMap.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ winnerId: null }) }));
      });

      it.each([
        ['BO1 de poule nul', 'BO1', [game(null)], true],
        ['BO3 de poule à 1-1 puis un game nul', 'BO3', [game(HOME), game(AWAY), game(null)], true],
        ['BO3 de poule à 1-0 puis un game nul (il reste un game)', 'BO3', [game(HOME), game(null)], false],
      ])('série de poule : %s → terminée sur un nul = %s', async (_l, format, maps, finished) => {
        prisma.match.findUnique.mockResolvedValue({ ...series(format, maps), stageId: 'st', bracketType: 'ROUND_ROBIN', placement: null });
        await service.updateSeries(MATCH);
        const data = prisma.match.update.mock.calls[0][0].data;
        expect(data.status === 'FINISHED' && data.winnerId === null).toBe(finished);
      });

      it('un game nul ne termine jamais une série d’arbre', async () => {
        prisma.match.findUnique.mockResolvedValue({ ...series('BO1', [game(null)]), stageId: 'st', bracketType: 'UPPER', placement: null });
        await service.updateSeries(MATCH);
        expect(prisma.match.update.mock.calls[0][0].data.status).not.toBe('FINISHED');
      });

      it('nul arrivé automatiquement sur un match d’arbre : enregistré CONTESTÉ, pas confirmé', async () => {
        const MAP = '66666666-6666-4666-8666-666666666666';
        prisma.matchMap.findUnique.mockResolvedValue({
          id: MAP, matchId: MATCH,
          match: { format: 'BO1', bracketType: 'LOWER', placement: null, stageId: 'st', nextMatchId: 'n', loserNextMatchId: null },
        });
        await service.recordGameResult({
          matchMapId: MAP, scoreHome: 15, scoreAway: 15, winnerTeamId: null, source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
        });
        expect(prisma.matchMap.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resultStatus: 'DISPUTED' }) }));
      });
    });
  });

  describe('recordEventLog', () => {
    it('should write raw event sourcing record to EventPrimary with BigInt timestamp', async () => {
      prisma.eventPrimary.create.mockResolvedValue({ id: BigInt(1001) });

      const mapUuid = '11111111-1111-4111-8111-111111111111';
      const timestamp = 1700000000000;
      await service.recordEventLog(mapUuid, 'bomb_planted', { site: 'A' }, timestamp, {
        matchId: 'm-final',
        serverId: 'srv-a',
      });

      expect(prisma.eventPrimary.create).toHaveBeenCalledWith({
        data: {
          matchMapId: mapUuid,
          matchId: 'm-final',
          serverId: 'srv-a',
          timestamp: BigInt(timestamp),
          type: 'bomb_planted',
          payload: { site: 'A' },
        },
      });
    });

    it('should never send a non-UUID matchMapId to the UUID column (real-time ids like "m-sandbox-1")', async () => {
      prisma.eventPrimary.create.mockResolvedValue({ id: BigInt(1002) });

      await service.recordEventLog('m-sandbox-1', 'round_start', {}, 1, { matchId: 'm-sandbox-1' });

      expect(prisma.eventPrimary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ matchMapId: null, matchId: 'm-sandbox-1' }),
      });
    });
  });

  describe('getTournamentHeadshots', () => {
    it('should return aggregated headshot count for the tournament', async () => {
      prisma.playerMapStats.aggregate.mockResolvedValue({
        _sum: { headshots: 245 },
      });

      const total = await service.getTournamentHeadshots('tourney-lan-19');

      expect(prisma.playerMapStats.aggregate).toHaveBeenCalledWith({
        where: {
          matchMap: {
            match: {
              tournamentId: 'tourney-lan-19',
            },
          },
        },
        _sum: { headshots: true },
      });
      expect(total).toBe(245);
    });

    it('should return 0 when no stats exist', async () => {
      prisma.playerMapStats.aggregate.mockResolvedValue({
        _sum: { headshots: null },
      });

      const total = await service.getTournamentHeadshots('tourney-empty');
      expect(total).toBe(0);
    });
  });

  describe('getTournamentLeaderboard', () => {
    it('should calculate KD ratio, HS percentage and sort leaderboard by kills', async () => {
      prisma.playerMapStats.findMany.mockResolvedValue([
        {
          playerId: 'p-1',
          kills: 20,
          deaths: 10,
          headshots: 12,
          damageDealt: 2100,
          player: { username: 'ZywOo', steamId: '765611001' },
        },
        {
          playerId: 'p-1',
          kills: 25,
          deaths: 10,
          headshots: 15,
          damageDealt: 2400,
          player: { username: 'ZywOo', steamId: '765611001' },
        },
        {
          playerId: 'p-2',
          kills: 30,
          deaths: 20,
          headshots: 10,
          damageDealt: 3000,
          player: { username: 's1mple', steamId: '765611002' },
        },
      ]);

      const leaderboard = await service.getTournamentLeaderboard('tourney-1');

      expect(leaderboard).toHaveLength(2);
      // ZywOo: total 45 kills, 20 deaths, 27 headshots
      // s1mple: total 30 kills, 20 deaths, 10 headshots
      expect(leaderboard[0].username).toBe('ZywOo');
      expect(leaderboard[0].kills).toBe(45);
      expect(leaderboard[0].deaths).toBe(20);
      expect(leaderboard[0].kdRatio).toBe(2.25);
      expect(leaderboard[0].headshotPercent).toBe(60.0);

      expect(leaderboard[1].username).toBe('s1mple');
      expect(leaderboard[1].kills).toBe(30);
      expect(leaderboard[1].kdRatio).toBe(1.5);
    });
  });

  describe('resolveBracketMatchId', () => {
    const MAP_UUID = '11111111-1111-4111-8111-111111111111';
    const MATCH_UUID = '44444444-4444-4444-8444-444444444444';

    it('returns null without querying the DB for real-time ids that are not UUIDs', async () => {
      await expect(service.resolveBracketMatchId('m-sandbox-1', null)).resolves.toBeNull();
      expect(prisma.matchMap.findUnique).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).not.toHaveBeenCalled();
    });

    it('returns the parent Match of a linked BO1 map', async () => {
      prisma.matchMap.findUnique.mockResolvedValue({ id: MAP_UUID, matchId: MATCH_UUID, match: { format: 'BO1' } });
      await expect(service.resolveBracketMatchId('m-final', MAP_UUID)).resolves.toBe(MATCH_UUID);
    });

    it('does not advance the bracket at the end of a single map of a BO3 series', async () => {
      prisma.matchMap.findUnique.mockResolvedValue({ id: MAP_UUID, matchId: MATCH_UUID, match: { format: 'BO3' } });
      await expect(service.resolveBracketMatchId('m-final', MAP_UUID)).resolves.toBeNull();
    });

    it('keeps supporting a real-time matchId that is directly a Match UUID', async () => {
      prisma.matchMap.findUnique.mockResolvedValue(null);
      prisma.match.findUnique.mockResolvedValue({ id: MATCH_UUID });
      await expect(service.resolveBracketMatchId(MATCH_UUID, null)).resolves.toBe(MATCH_UUID);
    });
  });

  describe('advanceBracketMatch', () => {
    it('should advance winner to nextMatch and loser to loserNextMatch (Double Elimination)', async () => {
      const match = {
        id: 'match-semi-1',
        teamHomeId: 'team-navi',
        teamAwayId: 'team-vitality',
        nextMatchId: 'match-grand-final',
        nextMatch: {
          id: 'match-grand-final',
          teamHomeId: null,
          teamAwayId: null,
        },
        loserNextMatchId: 'match-lower-final',
        loserNextMatch: {
          id: 'match-lower-final',
          teamHomeId: 'team-faze',
          teamAwayId: null,
        },
      };

      prisma.match.findUnique.mockResolvedValue(match);
      prisma.match.update.mockResolvedValue({
        ...match,
        status: 'FINISHED',
        winnerId: 'team-vitality',
      });

      const result = await service.advanceBracketMatch('match-semi-1', 'team-vitality');

      // 1. Current match finished with winner
      expect(prisma.match.update).toHaveBeenCalledWith({
        where: { id: 'match-semi-1' },
        data: { status: 'FINISHED', winnerId: 'team-vitality' },
      });

      // 2. Winner (Vitality) advances to next match (teamHomeId is empty)
      expect(prisma.match.update).toHaveBeenCalledWith({
        where: { id: 'match-grand-final' },
        data: { teamHomeId: 'team-vitality' },
      });

      // 3. Loser (NaVi) advances to loser next match (teamHomeId already taken by FaZe -> slots into teamAwayId)
      expect(prisma.match.update).toHaveBeenCalledWith({
        where: { id: 'match-lower-final' },
        data: { teamAwayId: 'team-navi' },
      });

      expect(result.nextMatchId).toBe('match-grand-final');
      expect(result.loserNextMatchId).toBe('match-lower-final');
    });

    it('should throw an error if match does not exist', async () => {
      prisma.match.findUnique.mockResolvedValue(null);

      await expect(
        service.advanceBracketMatch('match-unknown', 'team-1'),
      ).rejects.toThrow('Match match-unknown not found');
    });
  });

  describe('recordVetoStep', () => {
    it('should upsert veto step with map name and action', async () => {
      prisma.matchVeto.upsert.mockResolvedValue({ id: 'veto-1' });

      await service.recordVetoStep({
        matchId: 'match-1',
        stepOrder: 1,
        teamId: 'team-vitality',
        action: 'BAN',
        mapName: 'de_anubis',
      });

      expect(prisma.matchVeto.upsert).toHaveBeenCalledWith({
        where: {
          matchId_stepOrder: {
            matchId: 'match-1',
            stepOrder: 1,
          },
        },
        update: {
          teamId: 'team-vitality',
          action: 'BAN',
          mapName: 'de_anubis',
          sidePick: null,
          status: 'COMPLETED',
        },
        create: {
          matchId: 'match-1',
          stepOrder: 1,
          teamId: 'team-vitality',
          action: 'BAN',
          mapName: 'de_anubis',
          sidePick: null,
          status: 'COMPLETED',
        },
      });
    });
  });
});
