import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { WsEventType, LobbyEventType, LobbyAdminEventType } from './dto/events.dto';

/** The order fields of an emitted payload, for the debug log only. */
function meta(data: unknown): string {
  const d = (data ?? {}) as { seq?: unknown; ts?: unknown; updatedAt?: unknown };
  return JSON.stringify({ seq: d.seq, ts: d.ts, updatedAt: d.updatedAt });
}

@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private io?: Server;

  bindIo(io: Server) {
    this.io = io;
    this.logger.log('[WS] Socket.IO bound to RealtimeEmitter');
  }

  // Nommage des rooms
  roomPublic(matchId: string) {
    return `match:${matchId}:public`;
  }
  roomAdmin(matchId: string) {
    return `match:${matchId}:admin`;
  }
  roomLobby() {
    return `matches:lobby`;
  }
  roomLobbyAdmin() {
    return `matches:lobby:admin`;
  }

  // Par match
  emitPublic(matchId: string, eventName: WsEventType, data: unknown) {
    if (!this.io) return this.logger.warn(`emitPublic(${eventName}) without IO`);
    this.io.to(this.roomPublic(matchId)).emit(eventName, data);
    this.logger.debug(`[WS→public:${matchId}] ${eventName} ${meta(data)}`);
  }

  emitAdmin(matchId: string, eventName: WsEventType, data: unknown) {
    if (!this.io) return this.logger.warn(`emitAdmin(${eventName}) without IO`);
    this.io.to(this.roomAdmin(matchId)).emit(eventName, data);
    this.logger.debug(`[WS→admin:${matchId}] ${eventName} ${meta(data)}`);
  }

  emitBoth(matchId: string, eventName: WsEventType, data: unknown) {
    if (!this.io) return this.logger.warn(`emitBoth(${eventName}) without IO`);
    this.io.to(this.roomPublic(matchId)).to(this.roomAdmin(matchId)).emit(eventName, data);
    this.logger.debug(`[WS→both:${matchId}] ${eventName} ${meta(data)}`);
  }

  // Globaux (lobby)
  emitLobby(eventName: LobbyEventType, data: unknown) {
    if (!this.io) return this.logger.warn(`emitLobby(${eventName}) without IO`);
    this.io.to(this.roomLobby()).emit(eventName, data);
    this.logger.debug(`[WS→lobby] ${eventName} ${meta(data)}`);
  }

  emitLobbyAdmin(eventName: LobbyAdminEventType, data: unknown) {
    if (!this.io) return this.logger.warn(`emitLobbyAdmin(${eventName}) without IO`);
    this.io.to(this.roomLobbyAdmin()).emit(eventName, data);
    this.logger.debug(`[WS→lobby:admin] ${eventName} ${meta(data)}`);
  }
}
