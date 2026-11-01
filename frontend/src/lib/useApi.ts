import { useEffect, useState } from 'react';
import { api } from './api';

export type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

/** GET a backend route, again when `path` changes. */
export function useApi<T>(path: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    api<T>(path)
      .then((data) => alive && setState({ status: 'ok', data }))
      .catch((e: Error) => alive && setState({ status: 'error', message: e.message }));
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}
