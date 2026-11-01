import { MatchGateway } from './match.gateway';
import { RealtimeEmitter } from './ws-emitter.internal';
import * as jwt from 'jsonwebtoken';

describe('MatchGateway (WS Authentication & Rooms)', () => {
  let gateway: MatchGateway;
  let mockRealtime: jest.Mocked<RealtimeEmitter>;
  let mockAuth: any;
  const JWT_SECRET = 'test-secret-12345';

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;

    mockRealtime = {
      bindIo: jest.fn(),
      emitBoth: jest.fn(),
      emitPublic: jest.fn(),
      emitAdmin: jest.fn(),
    } as any;

    mockAuth = { sessionFromCookie: jest.fn().mockReturnValue(null) };
    gateway = new MatchGateway(mockRealtime, mockAuth);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('binds Server to RealtimeEmitter in afterInit', () => {
    const mockServer = { to: jest.fn() } as any;
    gateway.afterInit(mockServer);

    expect(mockRealtime.bindIo).toHaveBeenCalledWith(mockServer);
  });

  describe('handleConnection', () => {
    function makeMockSocket(options: {
      query?: Record<string, any>;
      auth?: Record<string, any>;
    }) {
      return {
        id: 'sock-123',
        handshake: {
          query: options.query ?? {},
          auth: options.auth ?? {},
          headers: { cookie: 'gg_session=x' },
        },
        data: {} as any,
        join: jest.fn(),
        leave: jest.fn(),
        disconnect: jest.fn(),
      } as any;
    }

    it('accepts a connection without matchId (React front: one socket, matches followed later), joins nothing', () => {
      const socket = makeMockSocket({ query: {} });

      gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('takes the role from the session cookie when there is no token, then match:subscribe joins the rooms', () => {
      mockAuth.sessionFromCookie.mockReturnValue({ role: 'admin', sub: '76561197960265729', name: 'a', via: 'steam' });
      const socket = makeMockSocket({ query: {} });

      gateway.handleConnection(socket);
      expect(socket.data.role).toBe('admin');

      expect(gateway.subscribe(socket, { matchId: 'game-1' })).toEqual({ ok: true, matchId: 'game-1', role: 'admin' });
      expect(socket.join).toHaveBeenCalledWith('match:game-1:public');
      expect(socket.join).toHaveBeenCalledWith('match:game-1:admin');
      expect(gateway.subscribe(socket, { matchId: 'bad id!' })).toEqual({ ok: false, error: 'matchId' });
    });

    it('a player session stays a viewer: public room only', () => {
      mockAuth.sessionFromCookie.mockReturnValue({ role: 'player', sub: '76561197960265729', name: 'p', via: 'steam' });
      const socket = makeMockSocket({ query: { matchId: 'game-1' } });

      gateway.handleConnection(socket);

      expect(socket.data.role).toBe('viewer');
      expect(socket.join).toHaveBeenCalledTimes(1);
      expect(socket.join).toHaveBeenCalledWith('match:game-1:public');
    });

    it('joins only public room for viewer (no token)', () => {
      const socket = makeMockSocket({ query: { matchId: 'm-sandbox' } });

      gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.role).toBe('viewer');
      expect(socket.data.matchId).toBe('m-sandbox');
      expect(socket.join).toHaveBeenCalledTimes(1);
      expect(socket.join).toHaveBeenCalledWith('match:m-sandbox:public');
    });

    it('joins both public and admin rooms for admin token in auth', () => {
      const adminToken = jwt.sign({ role: 'admin', sub: 'admin-user-1' }, JWT_SECRET);
      const socket = makeMockSocket({
        query: { matchId: 'm-sandbox' },
        auth: { token: adminToken },
      });

      gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.role).toBe('admin');
      expect(socket.data.user).toEqual({ id: 'admin-user-1' });
      expect(socket.join).toHaveBeenCalledWith('match:m-sandbox:public');
      expect(socket.join).toHaveBeenCalledWith('match:m-sandbox:admin');
      expect(socket.join).toHaveBeenCalledTimes(2);
    });

    it('joins both public and admin rooms when token is passed in query string', () => {
      const adminToken = jwt.sign({ role: 'admin', sub: 'admin-user-2' }, JWT_SECRET);
      const socket = makeMockSocket({
        query: { matchId: 'm-sandbox', token: adminToken },
      });

      gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.role).toBe('admin');
      expect(socket.join).toHaveBeenCalledWith('match:m-sandbox:admin');
    });

    it('disconnects connection when token signature is invalid', () => {
      const invalidToken = jwt.sign({ role: 'admin' }, 'wrong-secret');
      const socket = makeMockSocket({
        query: { matchId: 'm-sandbox' },
        auth: { token: invalidToken },
      });

      gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('handles socket disconnect gracefully', () => {
      const socket = { id: 'sock-123', data: { matchId: 'm-sandbox' } } as any;
      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
    });
  });
});
