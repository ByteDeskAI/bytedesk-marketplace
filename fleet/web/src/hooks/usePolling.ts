// usePolling — generic poll hook. Falls back to polling if SSE is
// unavailable; if a topic name is supplied, also subscribes to that SSE
// topic and refetches immediately when an event arrives.
//
// Phase 3b layered SSE on top of the Phase 3a polling. Hook callers
// don't see the difference; they just get faster updates on busy
// projects.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useSSE } from './useSSE';

export interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function usePolling<T>(
  url: string,
  intervalMs: number,
  sseTopic?: string
): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: null, loading: true, error: null });
  const cancelled = useRef(false);
  const fetchRef = useRef<() => void>();

  useEffect(() => {
    cancelled.current = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const data = (await r.json()) as T;
        if (!cancelled.current) {
          setState({ data, loading: false, error: null });
        }
      } catch (e) {
        if (!cancelled.current) {
          setState((prev) => ({ ...prev, loading: false, error: e as Error }));
        }
      }
    };
    fetchRef.current = tick;

    tick();
    timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled.current = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [url, intervalMs]);

  // SSE-driven immediate refetch.
  useSSE(sseTopic ?? '', () => {
    if (sseTopic) fetchRef.current?.();
  });

  return state;
}
