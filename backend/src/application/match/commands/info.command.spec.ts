import { InfoCommand } from './info.command';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';

describe('InfoCommand', () => {
  let command: InfoCommand;
  let mockPauseService: any;

  const MATCH_ID = 'm-test-info';
  const SERVER_ID = 'srv-1';

  beforeEach(() => {
    mockPauseService = {
      getTacBank: jest.fn().mockResolvedValue(90),
    };
    command = new InfoCommand(mockPauseService);
  });

  function makeCommandEvent(cmd: string, team = 'CT') {
    return {
      type: 'command',
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      payload: {
        command: cmd,
        parameters: [],
        sender: { name: 'PlayerInfo', steamId: 'STEAM_456', team },
      },
    } as any;
  }

  function makeCtx(phase = 'live_main', score = { ct: 8, t: 4, round: 12 }) {
    return {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      say: jest.fn().mockResolvedValue(undefined),
      orch: {
        sideToLogical: jest.fn().mockResolvedValue('home'),
      },
      state: {
        getSnapshot: jest.fn().mockResolvedValue({ phase, score }),
      },
    } as any;
  }

  describe('canHandle', () => {
    it('returns true for help, commands, aide, pauses, score', async () => {
      const cmds = [
        CS2_CHAT_COMMANDS.HELP,
        CS2_CHAT_COMMANDS.COMMANDS,
        CS2_CHAT_COMMANDS.AIDE,
        CS2_CHAT_COMMANDS.PAUSES,
        CS2_CHAT_COMMANDS.SCORE,
      ];
      for (const c of cmds) {
        expect(await command.canHandle(makeCommandEvent(c), makeCtx())).toBe(true);
      }
    });
  });

  describe('handle !pauses', () => {
    it('returns remaining tactical bank for player team', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.PAUSES);

      const res = await command.handle(ev, ctx);
      expect(res).toBe(true);
      expect(mockPauseService.getTacBank).toHaveBeenCalledWith(MATCH_ID, 'home');
      expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('90 secondes'));
    });
  });

  describe('handle !score', () => {
    it('returns current score and round', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.SCORE);

      const res = await command.handle(ev, ctx);
      expect(res).toBe(true);
      expect(ctx.say).toHaveBeenCalledWith('[GG-Core] Score : CT 8 - 4 T (Round 12)');
    });
  });

  describe('handle !help / !commands', () => {
    it('returns warmup commands if in warmup phase', async () => {
      const ctx = makeCtx('warmup_main');
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.HELP);

      await command.handle(ev, ctx);
      expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('!ready'));
    });

    it('returns live commands if in live phase', async () => {
      const ctx = makeCtx('live_main');
      const ev = makeCommandEvent(CS2_CHAT_COMMANDS.HELP);

      await command.handle(ev, ctx);
      expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('!tech'));
    });
  });
});
