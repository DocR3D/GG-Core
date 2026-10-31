import { createContext, useContext, type ReactNode } from 'react';
import type { Session } from './api';
import { useApi, type Loaded } from './useApi';

const SessionContext = createContext<Loaded<Session>>({ status: 'loading' });

/** The logged-in user, read once (GET /auth/me) for the whole app. */
export function SessionProvider({ children }: { children: ReactNode }) {
  return <SessionContext.Provider value={useApi<Session>('/auth/me')}>{children}</SessionContext.Provider>;
}

export function useSession(): Loaded<Session> {
  return useContext(SessionContext);
}

export const isAdmin = (s: Loaded<Session>) => s.status === 'ok' && s.data.role === 'admin';
