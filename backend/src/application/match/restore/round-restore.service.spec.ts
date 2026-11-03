import { BadRequestException } from '@nestjs/common';
import { RoundRestoreService } from './round-restore.service';
import { CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';

describe('RoundRestoreService', () => {
  let service: RoundRestoreService;
  let mockRedis: any;
  let mockState: any;
  let mockCmds: any;
  let mockEmitter: any;

  const MATCH_ID = 'match-123';
  const SERVER_ID = 'server-cs2-1';

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    mockState = {
      getSnapshot: jest.fn().mockResolvedValue({
        score: { round: 10, ct: 6, t: 3 },
        sides: { home: 'CT', away: 'T' },
      }),
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
    };

    mockCmds = {
      say: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue(undefined),
      unpause: jest.fn().mockResolvedValue(undefined),
      rcon: jest.fn().mockResolvedValue({ success: true }),
    };

    mockEmitter = {
      emitBoth: jest.fn(),
    };

    service = new RoundRestoreService(
      mockRedis,
      mockState,
      mockCmds,
      mockEmitter,
    );
  });

  describe('getRestoreCandidates', () => {
    it('returns empty list if round < 1', async () => {
      mockState.getSnapshot.mockResolvedValueOnce({ score: { round: 0 } });
      const candidates = await service.getRestoreCandidates(MATCH_ID);
      expect(candidates).toEqual([]);
    });

    it('returns up to 5 candidates and marks direct restore for round >= current - 2', async () => {
      // current round is 10: candidates should be 10, 9, 8, 7, 6
      const candidates = await service.getRestoreCandidates(MATCH_ID);
      expect(candidates).toHaveLength(5);
      expect(candidates[0].round).toBe(10);
      expect(candidates[0].isCurrent).toBe(true);
      expect(candidates[0].canDirectRestore).toBe(true);
      expect(candidates[0].backupFile).toBe('backup_round09.txt');

      // Round 8: 10 - 2 => can direct restore
      expect(candidates[2].round).toBe(8);
      expect(candidates[2].canDirectRestore).toBe(true);

      // Round 7: 10 - 3 => requires admin approval
      expect(candidates[3].round).toBe(7);
      expect(candidates[3].canDirectRestore).toBe(false);
      expect(candidates[3].backupFile).toBe('backup_round06.txt');
    });

    it('correctly maps home and away scores based on sides', async () => {
      mockState.getSnapshot.mockResolvedValueOnce({
        score: { round: 5, ct: 4, t: 1 },
        sides: { home: 'T', away: 'CT' },
      });
      const candidates = await service.getRestoreCandidates(MATCH_ID);
      expect(candidates[0].scoreHome).toBe(1);
      expect(candidates[0].scoreAway).toBe(4);
    });
  });

  describe('proposeRestore', () => {
    it('throws BadRequestException if targetRound <= 0 or targetRound > currentRound', async () => {
      await expect(
        service.proposeRestore(MATCH_ID, 0, { team: 'home', name: 'Alice' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.proposeRestore(MATCH_ID, 15, { team: 'home', name: 'Alice' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates proposal, applies technical pause, stores in redis, announces in chat, and emits WS', async () => {
      const proposal = await service.proposeRestore(MATCH_ID, 9, {
        team: 'home',
        name: 'Alice',
        steamId: 'STEAM_ALICE',
      });

      expect(proposal.targetRound).toBe(9);
      expect(proposal.backupFile).toBe('backup_round08.txt');
      expect(proposal.proposingTeam).toBe('home');
      expect(proposal.requiresAdmin).toBe(false); // 9 >= 10 - 2

      expect(mockCmds.pause).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        matchId: MATCH_ID,
      });
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockCmds.say).toHaveBeenCalled();
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        MATCH_ID,
        'restore:proposed',
        expect.objectContaining({ targetRound: 9 }),
      );
    });

    it('flags requiresAdmin when restoring beyond N-2', async () => {
      const proposal = await service.proposeRestore(MATCH_ID, 6, {
        team: 'away',
        name: 'Bob',
      });

      expect(proposal.requiresAdmin).toBe(true); // 6 < 10 - 2
      expect(mockCmds.say).toHaveBeenCalledWith(
        SERVER_ID,
        expect.stringContaining('arbitrage'),
      );
    });
  });

  describe('confirmRestore', () => {
    it('throws BadRequestException if no proposal exists in redis', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      await expect(
        service.confirmRestore(MATCH_ID, { team: 'away', name: 'Bob' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if proposing team tries to confirm their own proposal', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
          proposingTeam: 'home',
          requiresAdmin: false,
        }),
      );

      await expect(
        service.confirmRestore(MATCH_ID, { team: 'home', name: 'Alice' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes direct restore when opponent confirms (targetRound >= N-2)', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
          proposingTeam: 'home',
          requiresAdmin: false,
        }),
      );

      const res = await service.confirmRestore(MATCH_ID, { team: 'away', name: 'Bob' });
      expect(res.status).toBe('accepted');
      expect(mockCmds.rcon).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        matchId: MATCH_ID,
        command: CS2_RCON_COMMANDS.RESTORE_LOAD('backup_round08.txt'),
      });
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        MATCH_ID,
        'restore:executed',
        expect.objectContaining({ status: 'accepted' }),
      );
    });

    it('waits for admin confirmation if requiresAdmin is true and opponent confirms', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 6,
          backupFile: 'backup_round05.txt',
          proposingTeam: 'home',
          requiresAdmin: true,
          opponentAgreed: false,
          adminApproved: false,
        }),
      );

      const res = await service.confirmRestore(MATCH_ID, { team: 'away', name: 'Bob' });
      expect(res.opponentAgreed).toBe(true);
      expect(res.adminApproved).toBe(false);
      // RCON should NOT have been called yet
      expect(mockCmds.rcon).not.toHaveBeenCalled();
      // Proposal remains stored in Redis
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        MATCH_ID,
        'restore:proposed',
        expect.anything(),
      );
    });

    it('executes restore when admin approves deep proposal', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 6,
          backupFile: 'backup_round05.txt',
          proposingTeam: 'home',
          requiresAdmin: true,
          opponentAgreed: true,
          adminApproved: false,
        }),
      );

      const res = await service.confirmRestore(MATCH_ID, { isAdmin: true, name: 'AdminRef' });
      expect(res.status).toBe('accepted');
      expect(mockCmds.rcon).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        matchId: MATCH_ID,
        command: CS2_RCON_COMMANDS.RESTORE_LOAD('backup_round05.txt'),
      });
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('cancelRestore', () => {
    it('returns false if no proposal to cancel', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const res = await service.cancelRestore(MATCH_ID, { name: 'Bob' });
      expect(res).toBe(false);
    });

    it('deletes redis key, unpauses match, announces in chat, and emits WS', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
        }),
      );

      const res = await service.cancelRestore(MATCH_ID, { name: 'Bob', team: 'away' });
      expect(res).toBe(true);
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockCmds.unpause).toHaveBeenCalledWith({ serverId: SERVER_ID, matchId: MATCH_ID });
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        MATCH_ID,
        'restore:cancelled',
        expect.objectContaining({ status: 'cancelled' }),
      );
    });
  });
});
