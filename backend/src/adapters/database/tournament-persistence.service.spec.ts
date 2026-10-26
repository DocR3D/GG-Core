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

  describe('recordEventLog', () => {
    it('should write raw event sourcing record to EventPrimary with BigInt timestamp', async () => {
      prisma.eventPrimary.create.mockResolvedValue({ id: BigInt(1001) });

      const timestamp = 1700000000000;
      await service.recordEventLog('map-1', 'bomb_planted', { site: 'A' }, timestamp);

      expect(prisma.eventPrimary.create).toHaveBeenCalledWith({
        data: {
          matchMapId: 'map-1',
          timestamp: BigInt(timestamp),
          type: 'bomb_planted',
          payload: { site: 'A' },
        },
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
