import { BadRequestException } from '@nestjs/common';
import { RoundRestoreService } from './round-restore.service';
import { CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';

describe('RoundRestoreService', () => {
  let service: RoundRestoreService;
  let mockRedis: any;
  let mockState: any;
  let mockCmds: any;
  let mockEmitter: any;
  let mockPrisma: any;
  let mockPause: any;

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

    mockPrisma = { eventPrimary: { findMany: jest.fn().mockResolvedValue([]) } };

    mockPause = {
      isPaused: jest.fn().mockResolvedValue(true), // the pause the proposal started is in effect
      getPhase: jest.fn().mockResolvedValue('freeze'),
      pause: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(undefined),
      clearArmed: jest.fn().mockResolvedValue(undefined),
    };

    service = new RoundRestoreService(
      mockRedis,
      mockState,
      mockCmds,
      mockEmitter,
      mockPrisma,
      mockPause,
    );
  });

  afterEach(() => {
    service.onModuleDestroy(); // no 45 s timer left behind
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

    it('gives each checkpoint the score it restores (the score before that round), not the current one', async () => {
      // 5 rounds played (T, T, CT, T, T): the round being played, or about to start, is the 6th
      mockState.getSnapshot.mockResolvedValueOnce({
        score: { round: 5, ct: 1, t: 4 },
        sides: { home: 'T', away: 'CT' },
      });
      const win = (winner: string, ct: number, t: number, ts: number) => ({ timestamp: ts, payload: { winner, reason: 'elim', score: { ct, t } } });
      mockPrisma.eventPrimary.findMany.mockResolvedValueOnce([win('T', 0, 1, 1), win('T', 0, 2, 2), win('CT', 1, 2, 3), win('T', 1, 3, 4), win('T', 1, 4, 5)]);

      const candidates = await service.getRestoreCandidates(MATCH_ID);

      expect(candidates.map((c) => [c.round, c.scoreCt, c.scoreT, c.isCurrent])).toEqual([
        [6, 1, 4, true], // the round in progress starts from the score on the scoreboard
        [5, 1, 3, false],
        [4, 1, 2, false],
        [3, 0, 2, false],
        [2, 0, 1, false],
      ]);
      expect(candidates[0].backupFile).toBe('backup_round05.txt');
      expect(candidates[0].scoreHome).toBe(4); // home plays T
    });

    it('in the freeze time `score.round` still names the round just finished: the next one is offered', async () => {
      mockState.getSnapshot.mockResolvedValueOnce({ score: { round: 3, ct: 1, t: 2 }, sides: { home: 'T', away: 'CT' } });
      const candidates = await service.getRestoreCandidates(MATCH_ID);
      expect(candidates[0].round).toBe(4);
      expect(candidates[0].backupFile).toBe('backup_round03.txt');
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

      // a technical pause of GG-Core (the console shows it), started now: the freeze time
      expect(mockPause.pause).toHaveBeenCalledWith(MATCH_ID, SERVER_ID, expect.objectContaining({ reason: 'technical', team: 'system', armOnly: false }));
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
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('returns false if no proposal to cancel', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const res = await service.cancelRestore(MATCH_ID, { name: 'Bob' });
      expect(res).toBe(false);
    });

    it('handles cancellation by proposer: announces 5s delay and unpauses after timer', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
          proposingTeam: 'home',
        }),
      );

      const res = await service.cancelRestore(MATCH_ID, { name: 'Alice', team: 'home' });
      expect(res).toBe(true);
      expect(mockRedis.del).toHaveBeenCalled();

      // Immediate announcement with 5s notice
      expect(mockCmds.say).toHaveBeenCalledWith(
        SERVER_ID,
        expect.stringContaining('annulée (Alice). Reprise dans 5s'),
      );
      // Not yet unpaused immediately
      expect(mockCmds.unpause).not.toHaveBeenCalled();

      // Advance timers by 5s
      await jest.advanceTimersByTimeAsync(5000);

      expect(mockCmds.unpause).toHaveBeenCalledWith({ serverId: SERVER_ID, matchId: MATCH_ID });
      expect(mockCmds.say).toHaveBeenCalledWith(SERVER_ID, '[GG-Core] Match repris !');
    });

    it('handles refusal by opponent: emits restore:refused, warns about !tech, and unpauses after 5s', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
          proposingTeam: 'home',
        }),
      );

      const res = await service.cancelRestore(MATCH_ID, { name: 'Bob', team: 'away' });
      expect(res).toBe(true);
      expect(mockRedis.del).toHaveBeenCalled();

      // Notification of refusal + hint for !tech
      expect(mockCmds.say).toHaveBeenCalledWith(
        SERVER_ID,
        expect.stringContaining('refusée par l\'adversaire (Bob)'),
      );
      expect(mockCmds.say).toHaveBeenCalledWith(
        SERVER_ID,
        expect.stringContaining('tapez !tech'),
      );

      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        MATCH_ID,
        'restore:refused',
        expect.objectContaining({ status: 'refused' }),
      );

      // Advance timer
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockCmds.unpause).toHaveBeenCalledWith({ serverId: SERVER_ID, matchId: MATCH_ID });
    });

    it('aborts unpause if clearUnpauseTimer is invoked within 5s', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          targetRound: 9,
          backupFile: 'backup_round08.txt',
          proposingTeam: 'home',
        }),
      );

      await service.cancelRestore(MATCH_ID, { name: 'Bob', team: 'away' });
      expect(service.hasPendingUnpause(MATCH_ID)).toBe(true);

      // Player calls !tech -> clearUnpauseTimer
      const cleared = service.clearUnpauseTimer(MATCH_ID);
      expect(cleared).toBe(true);
      expect(service.hasPendingUnpause(MATCH_ID)).toBe(false);

      await jest.advanceTimersByTimeAsync(5000);
      expect(mockCmds.unpause).not.toHaveBeenCalled();
    });
  });
  describe('proposal made in the middle of a round', () => {
    it('only arms the pause (it starts at the next freeze time): no raw pause sent to the server now', async () => {
      mockPause.getPhase.mockResolvedValue('live');
      await service.proposeRestore(MATCH_ID, 9, { team: 'home', name: 'Alice' });
      expect(mockPause.pause).toHaveBeenCalledWith(MATCH_ID, SERVER_ID, expect.objectContaining({ armOnly: true, team: 'system' }));
      expect(mockCmds.pause).not.toHaveBeenCalled();
    });
  });

  describe('proposal expiry (nobody answers within 45 s)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const stored = (status = 'pending') => {
      const saved = JSON.parse(mockRedis.set.mock.calls.at(-1)[1]);
      return JSON.stringify({ ...saved, status });
    };

    it('announces the expiry in chat, tells the site, then resumes the game it had paused', async () => {
      const proposal = await service.proposeRestore(MATCH_ID, 9, { team: 'home', name: 'Alice' });
      mockRedis.get.mockResolvedValue(stored());

      await jest.advanceTimersByTimeAsync(45_000);

      expect(mockRedis.del).toHaveBeenCalledWith(`match:${MATCH_ID}:restore_proposal`);
      expect(mockCmds.say).toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('expirée'));
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(MATCH_ID, 'restore:cancelled', expect.objectContaining({ status: 'expired', targetRound: proposal.targetRound }));
      expect(mockCmds.unpause).not.toHaveBeenCalled(); // 5 s safety delay first
      await jest.advanceTimersByTimeAsync(5_000);
      expect(mockCmds.unpause).toHaveBeenCalledWith({ serverId: SERVER_ID, matchId: MATCH_ID });
    });

    it('in the middle of a round (no pause in effect) it does not claim to resume, but still cancels the armed pause', async () => {
      mockPause.getPhase.mockResolvedValue('live'); // the round is still running: the pause is only armed
      mockPause.isPaused.mockResolvedValue(false);
      await service.proposeRestore(MATCH_ID, 3, { team: 'home', name: 'Alice' });
      mockRedis.get.mockResolvedValue(stored());

      await jest.advanceTimersByTimeAsync(45_000);
      expect(mockCmds.say).toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('Le round continue.'));
      expect(mockCmds.say).not.toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('Reprise dans 5s'));

      await jest.advanceTimersByTimeAsync(5_000);
      expect(mockCmds.unpause).toHaveBeenCalledWith({ serverId: SERVER_ID, matchId: MATCH_ID });
      expect(mockPause.clearArmed).toHaveBeenCalledWith(MATCH_ID); // the pause armed for the next freeze time is forgotten
      expect(mockCmds.say).not.toHaveBeenCalledWith(SERVER_ID, '[GG-Core] Match repris !');
    });

    it('when the round ended meanwhile and the armed pause took effect, it says the game resumes in 5 s, then resumes it', async () => {
      await service.proposeRestore(MATCH_ID, 9, { team: 'home', name: 'Alice' });
      mockRedis.get.mockResolvedValue(stored());
      mockPause.isPaused.mockResolvedValue(true); // the round ended meanwhile: the armed pause took effect

      await jest.advanceTimersByTimeAsync(45_000);
      expect(mockCmds.say).toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('Reprise dans 5s.'));
      expect(mockCmds.say).not.toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('Le round continue'));

      await jest.advanceTimersByTimeAsync(5_000);
      expect(mockCmds.say).toHaveBeenCalledWith(SERVER_ID, '[GG-Core] Match repris !');
    });

    it('says nothing when the proposal was cancelled or accepted meanwhile (key gone)', async () => {
      await service.proposeRestore(MATCH_ID, 9, { team: 'home', name: 'Alice' });
      mockRedis.get.mockResolvedValue(null);
      mockCmds.say.mockClear();

      await jest.advanceTimersByTimeAsync(60_000);

      expect(mockCmds.say).not.toHaveBeenCalled();
      expect(mockCmds.unpause).not.toHaveBeenCalled();
    });
  });
});
