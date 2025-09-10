import { CanActivate, Injectable, ExecutionContext } from '@nestjs/common';
import type { Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SocketAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // pas de <Socket> ici
    const socket = ctx.switchToWs().getClient() as Socket;

    const token =
      (socket.handshake.auth?.token ||
        socket.handshake.query?.token) as string | undefined;

    // autoriser le public
    if (!token) { socket.data.role = 'viewer'; return true; }

    try {
      // Utilise un secret HS256 simple en dev
      const decoded = jwt.verify(String(token), process.env.JWT_SECRET!) as jwt.JwtPayload | string;

      // si tu as un payload objet
      if (typeof decoded !== 'string') {
        socket.data.user = { id: decoded.sub as string | number | undefined };
        socket.data.role = (decoded as any).role ?? 'viewer'; // 'admin' | 'viewer'
        // Option : vérifier decoded.scope === `match:${socket.handshake.query.matchId}`
      } else {
        socket.data.role = 'viewer';
      }
      return true;
    } catch {
      socket.disconnect(true);
      return false;
    }
  }
}
