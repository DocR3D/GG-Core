import { useEffect, useState } from 'react';
import { api } from './api';

export interface Polled<T> {
  data: T | null;
  error: string | null;
  /** when the data was last received (shown so a frozen screen is noticed) */
  at: number | null;
}

/**
 * GET a backend route every `everyMs` (and when the tab comes back): the data stays on screen while it refreshes,
 * an error is shown next to the last good data instead of blanking the screen.
 */
export function usePolling<T>(path: string, everyMs = 5000): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, at: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<T>(path)
        .then((data) => alive && setState({ data, error: null, at: Date.now() }))
        .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message })));
    load();
    const timer = setInterval(load, everyMs);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path, everyMs]);
  return state;
}
