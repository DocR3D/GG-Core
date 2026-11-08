import { RestoreCommand } from './restore.command';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';

describe('RestoreCommand', () => {
  let command: RestoreCommand;
  let mockRestoreService: any;

  const MATCH_ID = 'match-xyz';
  const SERVER_ID = 'srv-1';

  beforeEach(() => {
    mockRestoreService = {
      getRestoreCandidates: jest.fn().mockResolvedValue([
        { round: 10, isCurrent: true, canDirectRestore: true, scoreCt: 5, scoreT: 4 },
        { round: 9, isCurrent: false, canDirectRestore: true, scoreCt: 5, scoreT: 3 },
      ]),
      getProposal: jest.fn().mockResolvedValue(null),
      proposeRestore: jest.fn().mockResolvedValue({ targetRound: 9 }),
      confirmRestore: jest.fn().mockResolvedValue({ targetRound: 9, status: 'accepted' }),
      cancelRestore: jest.fn().mockResolvedValue(true),
    };

    command = new RestoreCommand(mockRestoreService);
  });

  function makeCommandEvent(cmd: string, parameters: string[] = [], team: 'CT' | 'T' = 'CT') {
    return {
      type: 'command',
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      round: 10,
      tick: 0,
      payload: {
        command: cmd,
        parameters,
        sender: { name: 'PlayerOne', steamId: 'STEAM_0:1:123', team },
      },
    } as any;
  }

  function makeCtx() {
    return {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      say: jest.fn().mockResolvedValue(undefined),
      orch: {
        sideToLogical: jest.fn().mockResolvedValue('home'),
      },
      state: {
        getSnapshot: jest.fn().mockResolvedValue({}),
      },
    } as any;
  }

  describe('canHandle', () => {
    it('returns true for restore, backup, backups, cancel, refuse, no', async () => {
      const validCmds = [
        CS2_CHAT_COMMANDS.RESTORE,
        CS2_CHAT_COMMANDS.BACKUP,
        CS2_CHAT_COMMANDS.BACKUPS,
        CS2_CHAT_COMMANDS.CANCEL,
        CS2_CHAT_COMMANDS.REFUSE,
        CS2_CHAT_COMMANDS.NO,
      ];
      for (const cmd of validCmds) {
        const can = await command.canHandle(makeCommandEvent(cmd), makeCtx());
        expect(can).toBe(true);
      }
    });

    it('returns false for unrelated commands', async () => {
      const can = await command.canHandle(makeCommandEvent('pause'), makeCtx());
      expect(can).toBe(false);
    });
  });

  describe('handle !backup / !backups', () => {
    it('displays candidates in chat', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.BACKUP);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.getRestoreCandidates).toHaveBeenCalledWith(MATCH_ID);
    });
  });

  describe('handle !cancel / !refuse / !no', () => {
    it('delegates to cancelRestore', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.CANCEL);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.cancelRestore).toHaveBeenCalledWith(
        MATCH_ID,
        expect.objectContaining({ name: 'PlayerOne', team: 'home' }),
      );
    });
  });

  describe('handle !restore', () => {
    it('shows candidates if no parameter passed', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, []);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.getRestoreCandidates).toHaveBeenCalledWith(MATCH_ID);
    });

    it('cancels if parameter is cancel or no', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, ['cancel']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.cancelRestore).toHaveBeenCalled();
    });

    it('warns if parameter is NaN', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, ['abc']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(false);
      expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('invalide'));
    });

    it('proposes restore if no active proposal exists', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, ['9']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.proposeRestore).toHaveBeenCalledWith(
        MATCH_ID,
        9,
        expect.objectContaining({ team: 'home', name: 'PlayerOne' }),
      );
    });

    it('confirms restore if active proposal exists from the other team', async () => {
      mockRestoreService.getProposal.mockResolvedValueOnce({
        targetRound: 9,
        proposingTeam: 'away',
      });

      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, ['9']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockRestoreService.confirmRestore).toHaveBeenCalledWith(
        MATCH_ID,
        expect.objectContaining({ team: 'home', name: 'PlayerOne' }),
      );
    });

    it('warns if active proposal exists from the same team', async () => {
      mockRestoreService.getProposal.mockResolvedValueOnce({
        targetRound: 9,
        proposingTeam: 'home',
      });

      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.RESTORE, ['9']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(false);
      expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('déjà active'));
    });
  });
});
