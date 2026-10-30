// src/application/shared/request-session.ts
// Session of the request being served, for code that does not see the request - e.g. the site bar of htmlPage()
// (who is logged in). Set once per request by AuthMiddleware; null outside a request or when nobody is logged in.
import { AsyncLocalStorage } from 'async_hooks';
import type { Session } from '@app/auth/auth.service';

const storage = new AsyncLocalStorage<Session | null>();

export function runWithSession<T>(session: Session | null, fn: () => T): T {
  return storage.run(session, fn);
}

export function currentSession(): Session | null {
  return storage.getStore() ?? null;
}
