// src/application/broadcast/buytime-broadcast.service.spec.ts
import { BuytimeBroadcastService } from './buytime-broadcast.service';
import { MatchPhase } from '@domain/phase.types';

describe('BuytimeBroadcastService', () => {
  let redis: any;
  let cmds: any;
  let state: any;
  let emitter: any;
  let prisma: any;
  let service: BuytimeBroadcastService;

  const mockRedisStorage: Record<string, string> = {};
  const mockActiveIds = new Set<string>();

  beforeEach(() => {
    Object.keys(mockRedisStorage).forEach((k) => delete mockRedisStorage[k]);
    mockActiveIds.clear();

    redis = {
      set: jest.fn((key: string, val: string) => {
        mockRedisStorage[key] = val;
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) => Promise.resolve(mockRedisStorage[key] ?? null)),
      sadd: jest.fn((key: string, id: string) => {
        mockActiveIds.add(id);
        return Promise.resolve(1);
      }),
      srem: jest.fn((key: string, id: string) => {
        mockActiveIds.delete(id);
        return Promise.resolve(1);
      }),
      smembers: jest.fn(() => Promise.resolve(Array.from(mockActiveIds))),
      keys: jest.fn((pattern: string) => {
        const prefix = pattern.replace('*', '');
        return Promise.resolve(Object.keys(mockRedisStorage).filter((k) => k.startsWith(prefix)));
      }),
    };

    cmds = {
      say: jest.fn().mockResolvedValue({ ok: true }),
    };

    state = {
      getServerIdFromMatchId: jest.fn().mockResolvedValue('srv-a'),
      getMatchIdFromServerId: jest.fn((sid: string) => Promise.resolve(sid === 'srv-a' ? 'm-live' : null)),
      getPhase: jest.fn((mid: string) => Promise.resolve(mid === 'm-live' ? MatchPhase.LIVE_MAIN : null)),
      getSnapshot: jest.fn().mockResolvedValue({ score: { round: 1 } }),
    };

    emitter = {
      emitLobbyAdmin: jest.fn(),
    };

    prisma = {
      server: {
        findMany: jest.fn().mockResolvedValue([{ name: 'srv-a' }, { name: 'srv-b' }]),
      },
    };

    service = new BuytimeBroadcastService(redis, cmds, state, emitter, prisma);
  });

  describe('createBroadcast', () => {
    it('throws if message is empty', async () => {
      await expect(service.createBroadcast({ message: '   ' })).rejects.toThrow('Le message ne peut pas être vide');
    });

    it('defaults to 1 round when roundsCount is omitted, and is configurable', async () => {
      // 1. Omitted roundsCount -> defaults to 1 round
      const defaultBc = await service.createBroadcast({
        message: 'Message round 1 par défaut',
        targets: ['srv-a'],
      });
      expect(defaultBc.roundsTotal).toBe(1);
      expect(defaultBc.servers['srv-a'].roundsRemaining).toBe(1);

      // 2. Configurable to 4 rounds
      const customBc = await service.createBroadcast({
        message: 'Message 4 rounds',
        roundsCount: 4,
        targets: ['srv-a'],
      });
      expect(customBc.roundsTotal).toBe(4);
      expect(customBc.servers['srv-a'].roundsRemaining).toBe(4);
    });

    it('sends immediately to idle servers and arms for competitive matches', async () => {
      const broadcast = await service.createBroadcast({
        message: 'Pause dîner dans 15 min !',
        prefix: '[GG-Core]',
        roundsCount: 3,
        targets: ['srv-a', 'srv-b'],
        sendImmediateIfNoMatch: true,
      });

      expect(broadcast.formattedMessage).toBe('[GG-Core] Pause dîner dans 15 min !');
      expect(broadcast.roundsTotal).toBe(3);

      // srv-b is idle: immediate dispatch
      expect(cmds.say).toHaveBeenCalledWith('srv-b', '[GG-Core] Pause dîner dans 15 min !');
      expect(broadcast.servers['srv-b'].immediate).toBe(true);
      expect(broadcast.servers['srv-b'].completed).toBe(true);
      expect(broadcast.servers['srv-b'].roundsSent).toBe(1);

      // srv-a has match running: armed for 3 rounds
      expect(broadcast.servers['srv-a'].immediate).toBe(false);
      expect(broadcast.servers['srv-a'].completed).toBe(false);
      expect(broadcast.servers['srv-a'].roundsRemaining).toBe(3);
      expect(broadcast.servers['srv-a'].roundsSent).toBe(0);

      // Added to active broadcasts
      expect(mockActiveIds.has(broadcast.id)).toBe(true);
    });
  });

  describe('onFreezeTime (Multi-round buytime delivery)', () => {
    it('delivers across consecutive rounds and completes when roundsCount reaches 0', async () => {
      // 1. Arm a 3-round broadcast for srv-a
      const broadcast = await service.createBroadcast({
        message: 'Fin des poules à 13h',
        roundsCount: 3,
        targets: ['srv-a'],
      });

      expect(broadcast.servers['srv-a'].roundsRemaining).toBe(3);
      cmds.say.mockClear();

      // --- Round 1 Freeze Time ---
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 1 } });
      let sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(1);
      expect(cmds.say).toHaveBeenCalledWith('srv-a', '[Annonce] Fin des poules à 13h');

      let updated = await service.getBroadcast(broadcast.id);
      expect(updated?.servers['srv-a'].roundsRemaining).toBe(2);
      expect(updated?.servers['srv-a'].roundsSent).toBe(1);
      expect(updated?.servers['srv-a'].completed).toBe(false);
      expect(updated?.completed).toBe(false);

      // Duplicate trigger within round 1 -> ignored
      cmds.say.mockClear();
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 1 } });
      sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(0);
      expect(cmds.say).not.toHaveBeenCalled();

      // --- Round 2 Freeze Time ---
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 2 } });
      sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(1);
      expect(cmds.say).toHaveBeenCalledWith('srv-a', '[Annonce] Fin des poules à 13h');

      updated = await service.getBroadcast(broadcast.id);
      expect(updated?.servers['srv-a'].roundsRemaining).toBe(1);
      expect(updated?.servers['srv-a'].roundsSent).toBe(2);

      // --- Round 3 Freeze Time ---
      cmds.say.mockClear();
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 3 } });
      sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(1);
      expect(cmds.say).toHaveBeenCalledWith('srv-a', '[Annonce] Fin des poules à 13h');

      updated = await service.getBroadcast(broadcast.id);
      expect(updated?.servers['srv-a'].roundsRemaining).toBe(0);
      expect(updated?.servers['srv-a'].roundsSent).toBe(3);
      expect(updated?.servers['srv-a'].completed).toBe(true);
      expect(updated?.completed).toBe(true);
      expect(mockActiveIds.has(broadcast.id)).toBe(false);

      // --- Round 4 Freeze Time -> No more deliveries ---
      cmds.say.mockClear();
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 4 } });
      sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(0);
      expect(cmds.say).not.toHaveBeenCalled();
    });
  });

  describe('rearmBroadcast', () => {
    it('defaults to +1 round when empty, and supports custom additional rounds or roundsCount alias', async () => {
      const broadcast = await service.createBroadcast({
        message: 'Message test',
        roundsCount: 1,
        targets: ['srv-a'],
      });

      // Complete round 1
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 1 } });
      await service.onFreezeTime('m-live', 'srv-a');

      const current = await service.getBroadcast(broadcast.id);
      expect(current?.completed).toBe(true);
      expect(mockActiveIds.has(broadcast.id)).toBe(false);

      // 1. Default rearm with empty body -> +1 round
      const rearmedDefault = await service.rearmBroadcast(broadcast.id, {});
      expect(rearmedDefault.completed).toBe(false);
      expect(rearmedDefault.roundsTotal).toBe(2);
      expect(rearmedDefault.servers['srv-a'].roundsRemaining).toBe(1);

      // 2. Custom rearm with additionalRounds: 2
      const rearmedCustom = await service.rearmBroadcast(broadcast.id, { additionalRounds: 2 });
      expect(rearmedCustom.roundsTotal).toBe(4);
      expect(rearmedCustom.servers['srv-a'].roundsRemaining).toBe(3);

      // 3. Custom rearm using roundsCount alias: 1
      const rearmedAlias = await service.rearmBroadcast(broadcast.id, { roundsCount: 1 });
      expect(rearmedAlias.roundsTotal).toBe(5);
      expect(rearmedAlias.servers['srv-a'].roundsRemaining).toBe(4);

      // Round 2 freeze time works
      cmds.say.mockClear();
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 2 } });
      const sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(1);
      expect(cmds.say).toHaveBeenCalledWith('srv-a', '[Annonce] Message test');
    });
  });

  describe('cancelBroadcast', () => {
    it('cancels active broadcast and prevents further round dispatches', async () => {
      const broadcast = await service.createBroadcast({
        message: 'Message annulable',
        roundsCount: 5,
        targets: ['srv-a'],
      });

      expect(mockActiveIds.has(broadcast.id)).toBe(true);

      const cancelled = await service.cancelBroadcast(broadcast.id);
      expect(cancelled.cancelled).toBe(true);
      expect(cancelled.completed).toBe(true);
      expect(cancelled.servers['srv-a'].roundsRemaining).toBe(0);
      expect(mockActiveIds.has(broadcast.id)).toBe(false);

      // Next round freeze time -> 0 sent
      cmds.say.mockClear();
      state.getSnapshot.mockResolvedValueOnce({ score: { round: 2 } });
      const sent = await service.onFreezeTime('m-live', 'srv-a');
      expect(sent).toBe(0);
      expect(cmds.say).not.toHaveBeenCalled();
    });
  });

  describe('listBroadcasts', () => {
    it('lists broadcasts sorted by creation date desc', async () => {
      await service.createBroadcast({ message: 'Premier' });
      await new Promise((r) => setTimeout(r, 10));
      await service.createBroadcast({ message: 'Deuxième' });

      const list = await service.listBroadcasts();
      expect(list.length).toBe(2);
      expect(list[0].message).toBe('Deuxième');
      expect(list[1].message).toBe('Premier');
    });
  });
});
