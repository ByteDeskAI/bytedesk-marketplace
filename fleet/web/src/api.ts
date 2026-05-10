// API client types + low-level fetch helpers.
//
// Phase 3a (BDM-17) replaced the placeholder fixtures with real fetches
// against the Go server's /api/* routes. Hooks (useSessionList, useStats,
// useProjects, useEventStream) compose these.
//
// Phase 3b will move from polling → SSE multiplex; the types here stay
// the same, so consumers don't change.

export interface SessionRow {
  ticket: string;
  slug: string;
  state: SessionState;
  parent: string;       // empty string = no parent
  branch: string;
  activity: string;     // pre-formatted: "2m ago"
  cost: string;         // pre-formatted: "$2.41"
  runtime: string;      // pre-formatted: "3h 12m"
  progress: number;     // 0..1
}

export type SessionState =
  | 'starting'
  | 'working'
  | 'needs-input'
  | 'error'
  | 'done'
  | 'idle'
  | 'reviewing'
  | 'blocked'
  | 'completed';

export interface FleetStats {
  active_sessions: { value: number; total: number };
  needs_input:     { value: number; delta: number };
  completed:       { value: number; window: string };
  est_cost_24h:    { value: string; delta_pct: number; series: number[] };
  runtime_24h:     { value: string; series: number[] };
  events_24h:      { value: number; delta_pct: number; series: number[] };
}

export interface Project {
  key: string;
  path: string;
  port: number;
  url: string;
}

export interface FleetEvent {
  id: string;
  ts: string;        // ISO timestamp
  ticket: string;
  depth: number;
  kind: string;
  detail: Record<string, unknown>;
}

// One-shot helper. Mostly used for the version footer; everything else uses
// hooks that wrap usePolling.
export async function fetchVersion(): Promise<{ build: string; project: string }> {
  try {
    const r = await fetch('/api/version');
    if (r.ok) return r.json();
  } catch {
    /* fall through to default */
  }
  return { build: 'dev', project: 'unknown' };
}
