import { AdminCallService } from './admin-call.service';

describe('AdminCallService', () => {
  let service: AdminCallService;
  let mockRedis: any;
  let mockEmitter: any;
  let mockCmds: any;
  let mockState: any;
  let mockPrisma: any;

  const MATCH_ID = 'm-test-admin-call';
  const SERVER_ID = 'srv-1';

  beforeEach(() => {
    mockRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn(),
      hgetall: jest.fn().mockResolvedValue({}),
      expire: jest.fn().mockResolvedValue(1),
    };

    mockEmitter = {
      emitAdmin: jest.fn(),
      emitLobbyAdmin: jest.fn(),
    };

    mockCmds = {
      say: jest.fn().mockResolvedValue(undefined),
    };

    mockState = {
      getDbMatchMapId: jest.fn().mockResolvedValue('map-db-1'),
    };

    mockPrisma = {
      eventPrimary: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    service = new AdminCallService(
      mockRedis,
      mockEmitter,
      mockCmds,
      mockState,
      mockPrisma,
    );
  });

  describe('createCall', () => {
    it('creates an admin call, stores in redis & postgres, announces in chat, and emits WS', async () => {
      const call = await service.createCall(MATCH_ID, SERVER_ID, {
        team: 'home',
        player: { name: 'PlayerOne', steamId: 'STEAM_1' },
        message: 'écran figé au stand A-04',
      });

      expect(call.id).toBeDefined();
      expect(call.matchId).toBe(MATCH_ID);
      expect(call.message).toBe('écran figé au stand A-04');
      expect(call.status).toBe('open');

      expect(mockRedis.hset).toHaveBeenCalledWith(
        `match:${MATCH_ID}:admin_calls`,
        call.id,
        expect.stringContaining('écran figé'),
      );
      expect(mockPrisma.eventPrimary.create).toHaveBeenCalled();
      expect(mockCmds.say).toHaveBeenCalledWith(
        SERVER_ID,
        expect.stringContaining('Message reçu par les admins'),
      );
      expect(mockEmitter.emitAdmin).toHaveBeenCalledWith(
        MATCH_ID,
        'admin:call',
        expect.objectContaining({ id: call.id }),
      );
      expect(mockEmitter.emitLobbyAdmin).toHaveBeenCalledWith(
        'admin:call',
        expect.objectContaining({ id: call.id }),
      );
    });
  });

  describe('getCalls', () => {
    it('returns sorted calls', async () => {
      mockRedis.hgetall.mockResolvedValueOnce({
        call1: JSON.stringify({ id: 'call1', calledAt: 100 }),
        call2: JSON.stringify({ id: 'call2', calledAt: 200 }),
      });

      const calls = await service.getCalls(MATCH_ID);
      expect(calls).toHaveLength(2);
      expect(calls[0].id).toBe('call2'); // 200 > 100
      expect(calls[1].id).toBe('call1');
    });
  });

  describe('ackCall and resolveCall', () => {
    it('acknowledges a call and notifies admins', async () => {
      mockRedis.hget.mockResolvedValueOnce(
        JSON.stringify({ id: 'call1', status: 'open', message: 'test' }),
      );

      const updated = await service.ackCall(MATCH_ID, 'call1', 'AdminMax');
      expect(updated?.status).toBe('acknowledged');
      expect(updated?.acknowledgedBy).toBe('AdminMax');
      expect(mockEmitter.emitAdmin).toHaveBeenCalledWith(
        MATCH_ID,
        'admin:call_ack',
        expect.objectContaining({ status: 'acknowledged' }),
      );
    });

    it('resolves a call and notifies admins', async () => {
      mockRedis.hget.mockResolvedValueOnce(
        JSON.stringify({ id: 'call1', status: 'acknowledged', message: 'test' }),
      );

      const updated = await service.resolveCall(MATCH_ID, 'call1', 'AdminMax');
      expect(updated?.status).toBe('resolved');
      expect(updated?.acknowledgedBy).toBe('AdminMax');
      expect(mockEmitter.emitAdmin).toHaveBeenCalledWith(
        MATCH_ID,
        'admin:call_ack',
        expect.objectContaining({ status: 'resolved' }),
      );
    });
  });
});
