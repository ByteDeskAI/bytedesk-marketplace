// Generic poll hook. The Phase 3a read-surface hooks (useSessionList,
// useStats, useProjects, useEventStream) compose this. Phase 3b will
// replace the polling with a single SSE multiplex; the hook signatures
// stay the same, so consumers don't change.

import { useEffect, useRef, useState } from 'preact/hooks';

export interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function usePolling<T>(url: string, intervalMs: number): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: null, loading: true, error: null });
  const cancelled = useRef(false);

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

    tick();
    timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled.current = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [url, intervalMs]);

  return state;
}
