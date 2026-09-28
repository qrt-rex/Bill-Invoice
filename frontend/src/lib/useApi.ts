import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

type Status = 'loading' | 'success' | 'error';

/**
 * Fetch-on-mount (and on `deps` change) with loading/error/retry state.
 * Stale responses from superseded requests are ignored.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Status>(enabled ? 'loading' : 'success');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve();
    const id = ++requestId.current;
    setStatus('loading');
    return fetcherRef.current()
      .then((res) => {
        if (id !== requestId.current) return;
        setData(res);
        setStatus('success');
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setError(err instanceof ApiError ? err.message : 'Unable to load data.');
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, status, error, reload: load, loading: status === 'loading' };
}

/** Debounces a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
