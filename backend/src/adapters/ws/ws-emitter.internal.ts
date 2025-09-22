import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { WsEventType, LobbyEventType, LobbyAdminEventType } from './dto/events.dto';

@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private io?: Server;

  bindIo(io: Server) {
    this.io = io;
    this.logger.log('[WS] Socket.IO bound to RealtimeEmitter');
  }

  // Nommage des rooms
  roomPublic(matchId: string)     { return `match:${matchId}:public`; }
  roomAdmin(matchId: string)      { return `match:${matchId}:admin`;  }
  roomLobby()                     { return `matches:lobby`; }
  roomLobbyAdmin()                { return `matches:lobby:admin`; }

  // Émetteurs existants (par match)
  emitPublic(matchId: string, eventName: WsEventType, data: any) {
    if (!this.io) { this.logger.warn(`emitPublic(${eventName}) without IO`); return; }
    this.io.to(this.roomPublic(matchId)).emit(eventName, data);
    this.logger.debug(`[WS→public:${matchId}] ${eventName} seq=${data?.seq} ts=${data?.ts}`);
  }

  emitAdmin(matchId: string, eventName: WsEventType, data: any) {
    if (!this.io) { this.logger.warn(`emitAdmin(${eventName}) without IO`); return; }
    this.io.to(this.roomAdmin(matchId)).emit(eventName, data);
    this.logger.debug(`[WS→admin:${matchId}] ${eventName} seq=${data?.seq} ts=${data?.ts}`);
  }

  // NOUVEAU : émetteurs globaux (lobby)
  emitLobby(eventName: LobbyEventType, data: any) {
    if (!this.io) { this.logger.warn(`emitLobby(${eventName}) without IO`); return; }
    this.io.to(this.roomLobby()).emit(eventName, data);
    this.logger.debug(`[WS→lobby] ${eventName} updatedAt=${data?.updatedAt ?? 'n/a'}`);
  }

  emitLobbyAdmin(eventName: LobbyAdminEventType, data: any) {
    if (!this.io) { this.logger.warn(`emitLobbyAdmin(${eventName}) without IO`); return; }
    this.io.to(this.roomLobbyAdmin()).emit(eventName, data);
    this.logger.debug(`[WS→lobby:admin] ${eventName} updatedAt=${data?.updatedAt ?? 'n/a'}`);
  }
}
