import { AdminCallCommand } from './admin-call.command';
import { CS2_CHAT_COMMANDS } from '@domain/rules/rules.constants';

describe('AdminCallCommand', () => {
  let command: AdminCallCommand;
  let mockService: any;

  const MATCH_ID = 'm-test-admin-cmd';
  const SERVER_ID = 'srv-1';

  beforeEach(() => {
    mockService = {
      createCall: jest.fn().mockResolvedValue({ id: 'call-123' }),
    };
    command = new AdminCallCommand(mockService);
  });

  function makeCommandEvent(cmd: string, parameters: string[] = []) {
    return {
      type: 'command',
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      round: 3,
      payload: {
        command: cmd,
        parameters,
        sender: { name: 'PlayerX', steamId: 'STEAM_123', team: 'CT' },
      },
    } as any;
  }

  function makeCtx() {
    return {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      orch: {
        sideToLogical: jest.fn().mockResolvedValue('home'),
      },
    } as any;
  }

  describe('canHandle', () => {
    it('returns true for admin, calladmin, arbitre', async () => {
      const valid = [
        CS2_CHAT_COMMANDS.ADMIN,
        CS2_CHAT_COMMANDS.CALLADMIN,
        CS2_CHAT_COMMANDS.ARBITRE,
      ];
      for (const cmd of valid) {
        expect(await command.canHandle(makeCommandEvent(cmd), makeCtx())).toBe(true);
      }
    });

    it('returns false for unrelated commands', async () => {
      expect(await command.canHandle(makeCommandEvent('pause'), makeCtx())).toBe(false);
    });
  });

  describe('handle', () => {
    it('forwards message and player info to AdminCallService', async () => {
      const ctx = makeCtx();
      const ev = makeCommandEvent('admin', ['besoin', 'arbitre', 'table', '4']);

      const handled = await command.handle(ev, ctx);
      expect(handled).toBe(true);
      expect(mockService.createCall).toHaveBeenCalledWith(
        MATCH_ID,
        SERVER_ID,
        expect.objectContaining({
          team: 'home',
          player: { name: 'PlayerX', steamId: 'STEAM_123' },
          message: 'besoin arbitre table 4',
        }),
      );
    });
  });
});
