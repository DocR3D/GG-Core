import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

// One Socket.IO connection for the whole app (same origin, /socket.io), reconnecting by itself.
let socket: Socket | null = null;
export function liveSocket(): Socket {
  socket ??= io({ withCredentials: true });
  return socket;
}

/** Whether the live link to the backend is up (shown in the site bar: a console without it shows stale data). */
export function useLiveStatus(): boolean {
  const s = liveSocket();
  const [up, setUp] = useState(s.connected);
  useEffect(() => {
    const on = () => setUp(true);
    const off = () => setUp(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, [s]);
  return up;
}
