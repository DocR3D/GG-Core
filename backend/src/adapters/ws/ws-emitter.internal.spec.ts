/**
 * RealtimeEmitter : the rooms of Socket.IO and who gets what. (emitBoth with its two rooms chained is also checked in
 * broadcaster.service.spec.ts.) Without a Socket.IO server bound, an emit is a warning, never a crash.
 */
import { Logger } from '@nestjs/common';
import { RealtimeEmitter } from './ws-emitter.internal';

function bound() {
  const emitter = new RealtimeEmitter();
  const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
  emitter.bindIo(io as never);
  return { emitter, io };
}

describe('RealtimeEmitter', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('names the rooms of a match and the lobby', () => {
    const { emitter } = bound();

    expect(emitter.roomPublic('m-1')).toBe('match:m-1:public');
    expect(emitter.roomAdmin('m-1')).toBe('match:m-1:admin');
    expect(emitter.roomLobby()).toBe('matches:lobby');
    expect(emitter.roomLobbyAdmin()).toBe('matches:lobby:admin');
  });

  it('sends a public event to the public room of the match only', () => {
    const { emitter, io } = bound();

    emitter.emitPublic('m-1', 'kill', { seq: 1 });

    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('match:m-1:public');
    expect(io.emit).toHaveBeenCalledWith('kill', { seq: 1 });
  });

  it('sends an admin event to the admin room of the match only', () => {
    const { emitter, io } = bound();

    emitter.emitAdmin('m-1', 'command', { seq: 2 });

    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('match:m-1:admin');
    expect(io.emit).toHaveBeenCalledWith('command', { seq: 2 });
  });

  it('sends a lobby event to the lobby room, and a lobby admin event to the lobby admin room', () => {
    const { emitter, io } = bound();

    emitter.emitLobby('lobby:match_updated' as never, { id: 'm-1' });
    emitter.emitLobbyAdmin('lobby:admin_update' as never, { id: 'm-2' });

    expect(io.to).toHaveBeenNthCalledWith(1, 'matches:lobby');
    expect(io.to).toHaveBeenNthCalledWith(2, 'matches:lobby:admin');
    expect(io.emit).toHaveBeenNthCalledWith(1, 'lobby:match_updated', { id: 'm-1' });
    expect(io.emit).toHaveBeenNthCalledWith(2, 'lobby:admin_update', { id: 'm-2' });
  });

  it('broadcasts to every connected client without picking a room', () => {
    const { emitter, io } = bound();

    emitter.emitBroadcast('server:notice', { text: 'restart' });

    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledWith('server:notice', { text: 'restart' });
  });

  it('copes with data that has no order fields, or no data at all', () => {
    const { emitter, io } = bound();

    expect(() => emitter.emitPublic('m-1', 'kill', undefined)).not.toThrow();
    expect(() => emitter.emitAdmin('m-1', 'kill', null)).not.toThrow();
    expect(io.emit).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['emitPublic', (e: RealtimeEmitter) => e.emitPublic('m-1', 'kill', {})],
    ['emitAdmin', (e: RealtimeEmitter) => e.emitAdmin('m-1', 'kill', {})],
    ['emitBoth', (e: RealtimeEmitter) => e.emitBoth('m-1', 'kill', {})],
    ['emitLobby', (e: RealtimeEmitter) => e.emitLobby('lobby:match_updated' as never, {})],
    ['emitLobbyAdmin', (e: RealtimeEmitter) => e.emitLobbyAdmin('lobby:admin_update' as never, {})],
    ['emitBroadcast', (e: RealtimeEmitter) => e.emitBroadcast('server:notice', {})],
  ])('%s without a bound server is a warning and nothing else', (name, call) => {
    const emitter = new RealtimeEmitter();

    expect(() => call(emitter)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${name}(`));
  });
});
