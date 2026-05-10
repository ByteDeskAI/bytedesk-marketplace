// API client types + low-level fetch helpers.

export interface SessionRow {
  ticket: string;
  slug: string;
  state: SessionState;
  parent: string;
  branch: string;
  activity: string;
  cost: string;
  runtime: string;
  progress: number;
}

export type SessionState =
  | 'starting' | 'working' | 'needs-input' | 'error' | 'done'
  | 'idle' | 'reviewing' | 'blocked' | 'completed';

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
  ts: string;
  ticket: string;
  depth: number;
  kind: string;
  detail: Record<string, unknown>;
}

// Mutating actions — Phase 5+ (Command pattern: client constructs typed
// command, server validates + dispatches to claude-sessions adapter).
export async function sendMessage(ticket: string, message: string): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!r.ok) throw new Error(await readError(r));
}

export async function killSession(ticket: string): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/kill`, { method: 'POST' });
  if (!r.ok) {
    const e = await readError(r);
    if (r.status === 409) {
      throw new Error(`UNCOMMITTED: ${e}`);
    }
    throw new Error(e);
  }
}

export async function cleanDeadMetas(): Promise<void> {
  const r = await fetch('/api/clean', { method: 'POST' });
  if (!r.ok) throw new Error(await readError(r));
}

// Spawn — Builder-on-the-server: client submits typed args, server
// constructs the spawn-claude-feature CLI invocation.
export interface SpawnArgs {
  ticket: string;
  slug: string;
  prompt: string;
  full_auto?: boolean;
  parent?: string;
  max_depth?: number;
}

export interface SpawnResult {
  ok: boolean;
  ticket: string;
  slug?: string;
  stdout: string;
}

export async function spawnFeature(args: SpawnArgs): Promise<SpawnResult> {
  const r = await fetch('/api/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function spawnReviewer(parentTicket: string, prompt?: string, fullAuto = true): Promise<SpawnResult> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(parentTicket)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt ?? '', full_auto: fullAuto }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

async function readError(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j.error || `${r.status} ${r.statusText}`;
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

export async function fetchVersion(): Promise<{ build: string; project: string }> {
  try {
    const r = await fetch('/api/version');
    if (r.ok) return r.json();
  } catch { /* fall through */ }
  return { build: 'dev', project: 'unknown' };
}
