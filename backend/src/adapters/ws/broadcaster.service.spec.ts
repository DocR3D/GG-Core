import { WsBroadcaster } from './broadcaster.service';
import { RealtimeEmitter } from './ws-emitter.internal';
import { SeqService } from '@app/match/state/sequence.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { REDIS_CHANNELS } from '@app/match/state/redis.keys';
import { EventEmitter } from 'events';

describe('WsBroadcaster & RealtimeEmitter (Anti-Double Delivery)', () => {
  let broadcaster: WsBroadcaster;
  let mockRedisSub: EventEmitter & { subscribe: jest.Mock };
  let mockEmitter: jest.Mocked<RealtimeEmitter>;
  let mockSeq: jest.Mocked<SeqService>;
  let mockMatchState: jest.Mocked<MatchStateService>;

  beforeEach(async () => {
    mockRedisSub = Object.assign(new EventEmitter(), {
      subscribe: jest.fn().mockResolvedValue('OK'),
    });

    mockEmitter = {
      emitBoth: jest.fn(),
      emitPublic: jest.fn(),
      emitAdmin: jest.fn(),
      emitLobby: jest.fn(),
      emitLobbyAdmin: jest.fn(),
      bindIo: jest.fn(),
      roomPublic: jest.fn((id) => `match:${id}:public`),
      roomAdmin: jest.fn((id) => `match:${id}:admin`),
      roomLobby: jest.fn(() => `matches:lobby`),
      roomLobbyAdmin: jest.fn(() => `matches:lobby:admin`),
    } as any;

    mockSeq = {
      next: jest.fn().mockResolvedValue(1),
    } as any;

    mockMatchState = {
      getServerMatch: jest.fn().mockResolvedValue('m-1'),
      getMatchIdFromServerId: jest.fn().mockResolvedValue('m-1'),
    } as any;

    broadcaster = new WsBroadcaster(
      mockRedisSub as any,
      mockEmitter,
      mockSeq,
      mockMatchState,
    );

    await broadcaster.onModuleInit();
  });

  describe('Audience routing & anti-duplicate dispatch', () => {
    it('subscribes to REDIS_CHANNELS.EVENTS on init', () => {
      expect(mockRedisSub.subscribe).toHaveBeenCalledWith(REDIS_CHANNELS.EVENTS);
    });

    it('routes audience=both events to emitBoth() and NEVER to emitPublic + emitAdmin separately', async () => {
      const busEvent = {
        v: 1,
        id: 'ev-1',
        type: 'kill',
        matchId: 'm-1',
        serverId: 'srv-a',
        source: 'logs',
        kind: 'primary',
        payload: {
          killer: { name: 'PlayerA', team: 'CT' },
          victim: { name: 'PlayerB', team: 'TERRORIST' },
          weapon: 'ak47',
        },
      };

      // Simule l'arrivée du message Redis
      mockRedisSub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify(busEvent));

      // Attendre la résolution asynchrone
      await new Promise((resolve) => setImmediate(resolve));

      // Doit appeler emitBoth (qui chaîne .to().to() dans Socket.IO pour dédoublonner)
      expect(mockEmitter.emitBoth).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        'm-1',
        'kill',
        expect.objectContaining({
          name: 'KILL',
          matchId: 'm-1',
        }),
      );

      // Ne doit SURTOUT PAS appeler séparément emitPublic ou emitAdmin (cause du bug de message en double)
      expect(mockEmitter.emitPublic).not.toHaveBeenCalled();
      expect(mockEmitter.emitAdmin).not.toHaveBeenCalled();
    });

    it('routes admin-only events (e.g. command) strictly to emitAdmin()', async () => {
      const commandEvent = {
        v: 1,
        id: 'ev-cmd-1',
        type: 'command',
        matchId: 'm-1',
        payload: { command: 'ready', sender: { name: 'PlayerA' } },
      };

      mockRedisSub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify(commandEvent));
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockEmitter.emitAdmin).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitAdmin).toHaveBeenCalledWith('m-1', 'command', expect.any(Object));
      expect(mockEmitter.emitBoth).not.toHaveBeenCalled();
      expect(mockEmitter.emitPublic).not.toHaveBeenCalled();
    });

    it('routes explicit public-only events strictly to emitPublic()', async () => {
      const publicEvent = {
        v: 1,
        id: 'ev-pub-1',
        name: 'ROUND_START',
        audience: 'public',
        matchId: 'm-1',
        payload: {},
      };

      mockRedisSub.emit('message', REDIS_CHANNELS.EVENTS, JSON.stringify(publicEvent));
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockEmitter.emitPublic).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitPublic).toHaveBeenCalledWith('m-1', 'round:start', expect.any(Object));
      expect(mockEmitter.emitBoth).not.toHaveBeenCalled();
      expect(mockEmitter.emitAdmin).not.toHaveBeenCalled();
    });
  });

  describe('push() direct method', () => {
    it('uses emitBoth() when audience is both', async () => {
      await broadcaster.push('m-1', 'score:update', { ct: 5, t: 3 }, 'both');

      expect(mockEmitter.emitBoth).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitBoth).toHaveBeenCalledWith(
        'm-1',
        'score:update',
        expect.objectContaining({ matchId: 'm-1', payload: { ct: 5, t: 3 } }),
      );
      expect(mockEmitter.emitPublic).not.toHaveBeenCalled();
      expect(mockEmitter.emitAdmin).not.toHaveBeenCalled();
    });

    it('uses emitAdmin() when audience is admin', async () => {
      await broadcaster.push('m-1', 'pause:update', { state: 'paused' }, 'admin');

      expect(mockEmitter.emitAdmin).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitBoth).not.toHaveBeenCalled();
      expect(mockEmitter.emitPublic).not.toHaveBeenCalled();
    });

    it('uses emitPublic() when audience is public', async () => {
      await broadcaster.push('m-1', 'match:state', { phase: 'live_main' }, 'public');

      expect(mockEmitter.emitPublic).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emitBoth).not.toHaveBeenCalled();
      expect(mockEmitter.emitAdmin).not.toHaveBeenCalled();
    });
  });

  describe('RealtimeEmitter unit test', () => {
    it('chains .to(roomPublic).to(roomAdmin).emit() in emitBoth to deduplicate sockets', () => {
      const emitter = new RealtimeEmitter();
      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      emitter.bindIo(mockIo as any);

      emitter.emitBoth('m-sandbox', 'round:end', { ok: true });

      expect(mockIo.to).toHaveBeenNthCalledWith(1, 'match:m-sandbox:public');
      expect(mockIo.to).toHaveBeenNthCalledWith(2, 'match:m-sandbox:admin');
      expect(mockIo.emit).toHaveBeenCalledWith('round:end', { ok: true });
    });
  });
});
