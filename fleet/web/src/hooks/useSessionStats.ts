// useSessionStats — live per-ticket transcript-derived stats. Subscribes
// to the SSE feed at /api/sessions/<T>/transcript so tile headers and
// detail panels pick up new tool calls / token tallies / pr-link
// events without any polling.

import { useEffect, useState } from 'preact/hooks';
import { fetchSessionStats, type TicketStats, type TranscriptEvent } from '../api';

export interface SessionStreamState {
  stats: TicketStats | null;
  recentEvents: TranscriptEvent[];
  error: string | null;
}

const RECENT_KEEP = 50;

export function useSessionStats(ticket: string | null): SessionStreamState {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [recent, setRecent] = useState<TranscriptEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket) { setStats(null); setRecent([]); return; }
    let cancelled = false;
    setErr(null);

    // Initial load (server returns last-known stats even if SSE is
    // delayed by reconcile cadence).
    fetchSessionStats(ticket)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((e) => { if (!cancelled) setErr((e as Error).message); });

    const es = new EventSource(`/api/sessions/${encodeURIComponent(ticket)}/transcript`);
    es.addEventListener('stats', (ev) => {
      if (cancelled) return;
      try { setStats(JSON.parse((ev as MessageEvent).data) as TicketStats); }
      catch { /* swallow */ }
    });
    es.addEventListener('transcript', (ev) => {
      if (cancelled) return;
      try {
        const e = JSON.parse((ev as MessageEvent).data) as TranscriptEvent;
        setRecent((prev) => {
          const next = [e, ...prev];
          if (next.length > RECENT_KEEP) next.length = RECENT_KEEP;
          return next;
        });
      } catch { /* swallow */ }
    });
    es.onerror = () => { /* EventSource auto-reconnects; ignore */ };

    return () => { cancelled = true; es.close(); };
  }, [ticket]);

  return { stats, recentEvents: recent, error: err };
}
