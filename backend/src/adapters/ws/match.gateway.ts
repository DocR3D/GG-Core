import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';

import { UseGuards, Logger } from '@nestjs/common'; // <-- UseGuards vient d'ici
import type { Server, Socket } from 'socket.io';
import { RealtimeEmitter } from './realtime.emitter';
import { SocketAuthGuard } from './socket.auth.guard';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
@UseGuards(SocketAuthGuard)
export class MatchGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MatchGateway.name);

  @WebSocketServer()
  private io!: Server;

  constructor(private readonly realtime: RealtimeEmitter) {}

  afterInit(server: Server) {
    this.realtime.bindIo(server);
    this.logger.log('[WS] Gateway initialized');
  }

  handleConnection(@ConnectedSocket() socket: Socket) {
    // 1) Récupérer matchId
    const raw = socket.handshake.query?.matchId;
    const matchId = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
    if (!matchId || !matchId.trim()) {
      this.logger.warn('Rejecting WS connection: missing matchId');
      socket.disconnect(true);
      return;
    }

    // 2) Auth manuelle au handshake
    const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;

    let role: 'admin' | 'viewer' = 'viewer';
    if (token) {
      try {
        const decoded = jwt.verify(String(token), process.env.JWT_SECRET!) as jwt.JwtPayload | string;
        if (typeof decoded !== 'string') {
          role = ((decoded as any).role ?? 'viewer') as 'admin' | 'viewer';
          socket.data.user = { id: (decoded as any).sub };
        }
      } catch {
        this.logger.warn('Invalid JWT on WS handshake, disconnecting');
        socket.disconnect(true);
        return;
      }
    }

    socket.data.role = role;
    socket.data.matchId = matchId;

    // 3) Rooms
    socket.join(`match:${matchId}:public`);
    if (role === 'admin') {
      socket.join(`match:${matchId}:admin`);
    }

    this.logger.log(`[WS] ${socket.id} joined match:${matchId} (role=${role})`);
  }

  handleDisconnect(@ConnectedSocket() socket: Socket) {
    this.logger.log(`[WS] ${socket.id} disconnected (match=${socket.data?.matchId || '?'})`);
  }
}
