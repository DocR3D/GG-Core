import { BadRequestException } from '@nestjs/common';
import { MatchRestoreController } from './match-restore.controller';

describe('MatchRestoreController', () => {
  let controller: MatchRestoreController;
  let mockRestoreService: any;

  const MATCH_ID = 'match-rest-1';

  beforeEach(() => {
    mockRestoreService = {
      getRestoreCandidates: jest.fn().mockResolvedValue([
        { round: 5, isCurrent: true, canDirectRestore: true },
      ]),
      getProposal: jest.fn().mockResolvedValue({
        targetRound: 4,
        proposingTeam: 'home',
      }),
      proposeRestore: jest.fn().mockResolvedValue({
        targetRound: 4,
        proposingTeam: 'home',
      }),
      confirmRestore: jest.fn().mockResolvedValue({
        targetRound: 4,
        status: 'accepted',
      }),
      cancelRestore: jest.fn().mockResolvedValue(true),
    };

    controller = new MatchRestoreController(mockRestoreService);
  });

  describe('getCandidates', () => {
    it('returns candidate checkpoints', async () => {
      const res = await controller.getCandidates(MATCH_ID);
      expect(res.candidates).toHaveLength(1);
      expect(mockRestoreService.getRestoreCandidates).toHaveBeenCalledWith(MATCH_ID);
    });
  });

  describe('getProposal', () => {
    it('returns current proposal', async () => {
      const res = await controller.getProposal(MATCH_ID);
      expect(res.proposal?.targetRound).toBe(4);
      expect(mockRestoreService.getProposal).toHaveBeenCalledWith(MATCH_ID);
    });
  });

  describe('propose', () => {
    it('throws BadRequestException if targetRound is missing', async () => {
      const req: any = { ggSession: null };
      await expect(
        controller.propose(MATCH_ID, {} as any, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('submits proposal with session user data', async () => {
      const req: any = {
        ggSession: {
          sub: '76561198000000001',
          name: 'PlayerAdmin',
          via: 'steam',
          role: 'player',
        },
      };

      const res = await controller.propose(
        MATCH_ID,
        { targetRound: 4, team: 'home' },
        req,
      );

      expect(res.success).toBe(true);
      expect(mockRestoreService.proposeRestore).toHaveBeenCalledWith(
        MATCH_ID,
        4,
        expect.objectContaining({
          team: 'home',
          name: 'PlayerAdmin',
          steamId: '76561198000000001',
        }),
      );
    });
  });

  describe('confirm', () => {
    it('confirms proposal as admin or opponent', async () => {
      const req: any = {
        ggSession: {
          sub: 'local-admin',
          name: 'TournamentAdmin',
          via: 'password',
          role: 'admin',
        },
      };

      const res = await controller.confirm(MATCH_ID, {}, req);
      expect(res.success).toBe(true);
      expect(mockRestoreService.confirmRestore).toHaveBeenCalledWith(
        MATCH_ID,
        expect.objectContaining({
          isAdmin: true,
          name: 'TournamentAdmin',
        }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels restore proposal', async () => {
      const req: any = {
        ggSession: {
          sub: '76561198000000002',
          name: 'CaptainAway',
          via: 'steam',
          role: 'player',
        },
      };

      const res = await controller.cancel(
        MATCH_ID,
        { team: 'away', reason: 'Misclick' },
        req,
      );

      expect(res.success).toBe(true);
      expect(mockRestoreService.cancelRestore).toHaveBeenCalledWith(
        MATCH_ID,
        expect.objectContaining({
          team: 'away',
          reason: 'Misclick',
        }),
      );
    });
  });
});
