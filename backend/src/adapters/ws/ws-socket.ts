import type { Socket } from 'socket.io';

/** What GG-Core keeps on a WebSocket connection: who it is (role from a JWT or the session cookie) and its match. */
export interface WsSocketData {
  role?: 'admin' | 'viewer';
  user?: { id?: unknown };
  matchId?: string;
}

/** A Socket.IO connection with its data typed (socket.data is `any` in socket.io). */
export type WsSocket = Omit<Socket, 'data'> & { data: WsSocketData };
