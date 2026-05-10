// Placeholder API client. Phase 3 (BDM-17) will replace these stubs with
// real fetches against the Go server's /api/* endpoints + an SSE topic
// multiplex. For now, the SPA renders against this static fixture so the
// scaffold demos the atomic-design layout without coupling to data plumbing.

export interface SessionRow {
  ticket: string;
  slug: string;
  state: SessionState;
  parent: string | null;
  branch: string;
  activity: string;
  cost: string;
  runtime: string;
  progress: number; // 0..1
}

export type SessionState =
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
  needs_input: { value: number; delta: number };
  completed: { value: number; window: string };
  est_cost_24h: { value: string; delta_pct: number; series: number[] };
  runtime_24h: { value: string; series: number[] };
  events_24h: { value: number; delta_pct: number; series: number[] };
}

const PLACEHOLDER_STATS: FleetStats = {
  active_sessions: { value: 8, total: 12 },
  needs_input: { value: 2, delta: 1 },
  completed: { value: 5, window: 'today' },
  est_cost_24h: { value: '$18.42', delta_pct: 12, series: [5, 7, 6, 8, 10, 9, 12, 14, 13, 16, 18] },
  runtime_24h: { value: '42h 17m', series: [2, 3, 5, 6, 8, 11, 14, 18, 22, 28, 35, 42] },
  events_24h: { value: 1328, delta_pct: 18, series: [200, 280, 410, 540, 680, 820, 1010, 1180, 1290, 1328] },
};

const PLACEHOLDER_ROWS: SessionRow[] = [
  { ticket: 'ACME-123', slug: 'checkout-redesign',  state: 'working',     parent: null,        branch: 'feature/ACME-123', activity: '2m ago',  cost: '$2.41', runtime: '3h 12m', progress: 0.72 },
  { ticket: 'ACME-124', slug: 'api-cache-layer',    state: 'needs-input', parent: null,        branch: 'feature/ACME-124', activity: '1m ago',  cost: '$1.08', runtime: '2h 48m', progress: 0.35 },
  { ticket: 'ACME-125', slug: 'billing-refactor',   state: 'working',     parent: 'ACME-120',  branch: 'feature/ACME-125', activity: '30s ago', cost: '$3.72', runtime: '4h 22m', progress: 0.65 },
  { ticket: 'ACME-126', slug: 'docs-improvements',  state: 'idle',        parent: null,        branch: 'feature/ACME-126', activity: '8m ago',  cost: '$0.32', runtime: '45m',    progress: 0.10 },
  { ticket: 'ACME-127', slug: 'email-delivery-fix', state: 'working',     parent: null,        branch: 'feature/ACME-127', activity: '45s ago', cost: '$1.91', runtime: '1h 31m', progress: 0.48 },
  { ticket: 'ACME-128', slug: 'e2e-tests-hardening',state: 'blocked',     parent: 'ACME-123',  branch: 'feature/ACME-128', activity: '2m ago',  cost: '$0.45', runtime: '1h 02m', progress: 0.20 },
  { ticket: 'ACME-120', slug: 'core-auth-overhaul', state: 'completed',   parent: null,        branch: 'feature/ACME-120', activity: '2h ago',  cost: '$4.55', runtime: '6h 14m', progress: 1.00 },
  { ticket: 'ACME-121', slug: 'review-core-auth',   state: 'reviewing',   parent: 'ACME-120',  branch: 'review/ACME-120',  activity: '1m ago',  cost: '$2.12', runtime: '2h 05m', progress: 0.85 },
];

export async function fetchStats(): Promise<FleetStats> {
  // Phase 3: replace with `fetch('/api/stats').then(r => r.json())`.
  return PLACEHOLDER_STATS;
}

export async function fetchSessions(): Promise<SessionRow[]> {
  // Phase 3: replace with `fetch('/api/sessions').then(r => r.json())`.
  return PLACEHOLDER_ROWS;
}

export async function fetchVersion(): Promise<{ build: string; project: string }> {
  try {
    const r = await fetch('/api/version');
    if (r.ok) return r.json();
  } catch { /* fall through */ }
  return { build: 'dev', project: 'unknown' };
}
