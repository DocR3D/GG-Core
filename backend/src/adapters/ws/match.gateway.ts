import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';

import { UseGuards, Logger } from '@nestjs/common'; // <-- UseGuards vient d'ici
import type { Server } from 'socket.io';
import type { WsSocket } from './ws-socket';
import { RealtimeEmitter } from './ws-emitter.internal';
import { SocketAuthGuard } from './socket.auth.guard';
import * as jwt from 'jsonwebtoken';
import { AuthService } from '@app/auth/auth.service';

const MATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Socket.IO: one room per match and audience (match:{id}:public, match:{id}:admin).
 * - role: a JWT in the handshake (scripts, auth.token / ?token=), otherwise the session cookie sent by the browser
 *   (the React front is served by this server, same origin: its HttpOnly cookie comes with the handshake);
 * - match: ?matchId= at connection (veto pages), and/or `match:subscribe` { matchId } / `match:unsubscribe` later
 *   (the React front keeps ONE connection and follows the matches its screen shows). A connection without match
 *   is accepted: it receives nothing until it subscribes (the site bar uses it to show the live link is up).
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
@UseGuards(SocketAuthGuard)
export class MatchGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MatchGateway.name);

  @WebSocketServer()
  private io!: Server;

  constructor(
    private readonly realtime: RealtimeEmitter,
    private readonly auth: AuthService,
  ) {}

  afterInit(server: Server) {
    this.realtime.bindIo(server);
    this.logger.log('[WS] Gateway initialized');
  }

  handleConnection(@ConnectedSocket() socket: WsSocket) {
    // 1) Role: JWT in the handshake, or the session cookie
    const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
    let role: 'admin' | 'viewer' = 'viewer';
    if (token) {
      try {
        const decoded = jwt.verify(String(token), process.env.JWT_SECRET!);
        if (typeof decoded !== 'string') {
          role = (decoded as { role?: 'admin' | 'viewer' }).role ?? 'viewer';
          socket.data.user = { id: decoded.sub };
        }
      } catch {
        this.logger.warn('Invalid JWT on WS handshake, disconnecting');
        socket.disconnect(true);
        return;
      }
    } else {
      const session = this.auth.sessionFromCookie(socket.handshake.headers?.cookie);
      if (session) {
        role = session.role === 'admin' ? 'admin' : 'viewer';
        socket.data.user = { id: session.sub };
      }
    }
    socket.data.role = role;

    // 2) Match given at connection (optional)
    const raw = socket.handshake.query?.matchId;
    const matchId = Array.isArray(raw) ? raw[0] : (raw);
    if (matchId?.trim()) this.join(socket, matchId.trim());
    else this.logger.log(`[WS] ${socket.id} connected without match (role=${role})`);
  }

  /** Follow a match: its public room, and its admin room for an admin. */
  @SubscribeMessage('match:subscribe')
  subscribe(@ConnectedSocket() socket: WsSocket, @MessageBody() body: { matchId?: string }) {
    const matchId = String(body?.matchId ?? '').trim();
    if (!MATCH_ID.test(matchId)) return { ok: false, error: 'matchId' };
    this.join(socket, matchId);
    return { ok: true, matchId, role: socket.data.role };
  }

  /** Stop following a match. */
  @SubscribeMessage('match:unsubscribe')
  unsubscribe(@ConnectedSocket() socket: WsSocket, @MessageBody() body: { matchId?: string }) {
    const matchId = String(body?.matchId ?? '').trim();
    void socket.leave(`match:${matchId}:public`);
    void socket.leave(`match:${matchId}:admin`);
    return { ok: true, matchId };
  }

  handleDisconnect(@ConnectedSocket() socket: WsSocket) {
    this.logger.log(`[WS] ${socket.id} disconnected (match=${socket.data?.matchId || '-'})`);
  }

  private join(socket: WsSocket, matchId: string) {
    socket.data.matchId = matchId;
    void socket.join(`match:${matchId}:public`); // in-memory adapter: synchronous
    if (socket.data.role === 'admin') void socket.join(`match:${matchId}:admin`);
    this.logger.log(`[WS] ${socket.id} joined match:${matchId} (role=${socket.data.role})`);
  }
}
