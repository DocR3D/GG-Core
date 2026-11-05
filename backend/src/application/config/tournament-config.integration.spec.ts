// src/application/config/tournament-config.integration.spec.ts

import { ChatCommandHandler } from '@app/subscribers/chat-commands.handler';
import { TournamentConfigService } from './tournament-config.service';
import { AdminCallService } from '@app/match/admin-call/admin-call.service';
import { AdminCallCommand } from '@app/match/commands/admin-call.command';
import type { CommandEvent } from '@domain/events/command.event';

describe('Tournament Configuration Integration - Dynamic Aliases & Message Templates', () => {
  let chatHandler: ChatCommandHandler;
  let configService: TournamentConfigService;
  let adminCallService: AdminCallService;
  let adminCallCommand: AdminCallCommand;

  let mockPrisma: any;
  let mockRedis: any;
  let mockMatchCmds: any;
  let mockState: any;
  let mockEmitter: any;
  let mockRegistry: any;
  let mockCtxFactory: any;
  let mockPhase: any;

  const TOURNAMENT_ID = 't-brest-lan-2026';
  const MATCH_ID = 'm-match-123';
  const SERVER_ID = 'srv-arena-1';

  beforeEach(async () => {
    mockPrisma = {
      tournament: {
        findUnique: jest.fn().mockResolvedValue({
          id: TOURNAMENT_ID,
          name: 'GG-LAN Brest 2026',
          settings: {
            config: {
              botTag: '[GGLAN-2026]',
              commandAliases: {
                admin: ['admin', 'sos', 'arbitre', 'helpme'],
              },
              disabledCommands: ['restore'],
              messages: {
                ADMIN_CALL_ACK: '{tag} Arbitre prévenu pour : "{message}" !',
              },
            },
          },
        }),
        update: jest.fn(),
      },
      eventPrimary: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
      matchMap: {
        findUnique: jest.fn(),
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };

    mockMatchCmds = {
      say: jest.fn().mockResolvedValue(undefined),
      ensureInitMatch: jest.fn(),
      changeLevel: jest.fn(),
    };

    mockState = {
      getDbMatchMapId: jest.fn().mockResolvedValue(null),
      getSnapshot: jest.fn().mockResolvedValue({
        phase: 'live_main',
        score: { ct: 5, t: 3, round: 9 },
        sides: { home: 'CT', away: 'T' },
        teams: { home_name: 'Garitos', away_name: 'Opponent' },
      }),
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
      getMatchIdFromServerId: jest.fn().mockResolvedValue(MATCH_ID),
    };

    mockEmitter = {
      emitAdmin: jest.fn(),
      emitLobbyAdmin: jest.fn(),
    };

    configService = new TournamentConfigService(mockPrisma, mockRedis);
    // Link match to tournament
    await configService.setMatchTournamentId(MATCH_ID, TOURNAMENT_ID);

    adminCallService = new AdminCallService(
      mockRedis,
      mockEmitter,
      mockMatchCmds,
      mockState,
      mockPrisma,
      configService,
    );

    adminCallCommand = new AdminCallCommand(adminCallService);

    // Mock rule handling admin command
    const mockRule = {
      canHandleCommand: jest.fn((cmd: string) => cmd === 'admin'),
      handleCommand: jest.fn(async (ev: CommandEvent, ctx: any) => {
        await adminCallCommand.handle(ev, ctx);
      }),
    };

    mockRegistry = {
      getRule: jest.fn().mockReturnValue(mockRule),
    };

    mockPhase = {
      getPhase: jest.fn().mockResolvedValue('live_main'),
    };

    mockCtxFactory = {
      make: jest.fn().mockReturnValue({
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        say: mockMatchCmds.say,
        orch: {
          sideToLogical: jest.fn().mockResolvedValue('home'),
        },
      }),
    };

    chatHandler = new ChatCommandHandler(
      mockRegistry,
      mockCtxFactory,
      mockPhase,
      mockMatchCmds,
      configService,
    );
  });

  it('resolves custom alias !sos to canonical admin and executes call with custom template and bot tag', async () => {
    const event = {
      kind: 'primary',
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      timestamp: Date.now(),
      type: 'command',
      payload: {
        command: 'sos',
        parameters: ['mon', 'ecran', 'est', 'noir'],
        sender: {
          name: 'Garitos',
          steamId: 'STEAM_1:0:11111',
          team: 'CT',
          channel: 'say',
        },
      },
    };

    await chatHandler.handle(event as unknown as CommandEvent);

    // 1) Rule was invoked with canonical command 'admin'
    expect(mockRegistry.getRule().canHandleCommand).toHaveBeenCalledWith('admin');
    expect(mockRegistry.getRule().handleCommand).toHaveBeenCalled();

    // 2) CS2 chat received the customized message with tournament bot tag & custom template
    expect(mockMatchCmds.say).toHaveBeenCalledWith(
      SERVER_ID,
      '[GGLAN-2026] Arbitre prévenu pour : "mon ecran est noir" !',
    );

    // 3) Admin call was stored in Redis and pushed to WebSocket
    expect(mockRedis.hset).toHaveBeenCalled();
    expect(mockEmitter.emitAdmin).toHaveBeenCalledWith(
      MATCH_ID,
      'admin:call',
      expect.objectContaining({
        message: 'mon ecran est noir',
      }),
    );
  });

  it('blocks and drops commands configured in disabledCommands', async () => {
    const disabledEvent = {
      kind: 'primary',
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      timestamp: Date.now(),
      type: 'command',
      payload: {
        command: 'restore',
        parameters: ['5'],
        sender: {
          name: 'Garitos',
          steamId: 'STEAM_1:0:11111',
          team: 'CT',
          channel: 'say',
        },
      },
    };

    await chatHandler.handle(disabledEvent as unknown as CommandEvent);

    // Should not delegate to rule or say anything
    expect(mockRegistry.getRule().canHandleCommand).not.toHaveBeenCalled();
    expect(mockMatchCmds.say).not.toHaveBeenCalled();
  });
});
