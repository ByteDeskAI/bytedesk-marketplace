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
  // Intelligence layer (Phase 8 / BDM-24). Optional — older binaries
  // may not include them.
  confidence?: number;
  drift?: number;
  objective?: string;
  // Auth-context badges (Phase 12.2 / A23).
  depth?: number;
  full_auto?: boolean;
  worktree?: string;
}

export interface GitStatus {
  worktree: string;
  branch: string;
  clean: boolean;
  files: { status: string; path: string }[];
  log: { hash: string; subject: string; author: string; when: string }[];
}

export interface PRStatus {
  available: boolean;
  number?: number;
  state?: string;
  url?: string;
  title?: string;
  author?: string;
  checks?: { name: string; state: string; conclusion: string; workflow?: string }[];
  files?: string[];
  error?: string;
}

export async function fetchGitStatus(ticket: string): Promise<GitStatus> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/git`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function fetchPRStatus(ticket: string): Promise<PRStatus> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/pr`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Per-ticket transcript-derived stats (Phase 12.x — claude jsonl live tail).
export interface TicketStats {
  ticket: string;
  ai_title?: string;
  agent_name?: string;
  last_prompt?: string;
  permission_mode?: string;
  pr_number?: number;
  pr_url?: string;
  tools?: Record<string, number>;
  tool_total: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_hit: number;
  cost_usd: number;
  errors: number;
  api_errors: number;
  thinking_chars: number;
  compactions: number;
  queue_depth: number;
  last_turn_at?: string;
  last_stop_reason?: string;
  last_turn_duration_ms?: number;
  tool_latency_ms?: Record<string, number>;
  sub_agents?: SubAgentInfo[];
  updated_at: string;
}

// SubAgentInfo — one entry per sub-agent transcript discovered for the
// session (the parent's `subagents/agent-<id>.jsonl`).
export interface SubAgentInfo {
  agent_id: string;
  agent_name?: string;
  started?: string;
  last_event?: string;
  status: 'running' | 'done' | 'error';
  tools?: Record<string, number>;
  tool_total: number;
  tokens_in: number;
  tokens_out: number;
  errors: number;
}

// UIMessage / UIPart — chat-mode wire shape projected from jsonl
// server-side (mirrors @tanstack/ai-react's UIMessage). Returned by
// /api/sessions/<T>/messages and emitted live as deltas through the
// transcript SSE feed.
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  agent_id?: string;
  parts: UIPart[];
}

export interface UIPart {
  type: 'text' | 'thinking' | 'tool-call' | 'tool-result' | 'system';
  text?: string;
  tool_use_id?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  state?: 'running' | 'done' | 'error';
  output?: string;
  sub_agent_id?: string;
  subtype?: string;
}

export async function fetchMessages(
  ticket: string,
  opts: { agent_id?: string; limit?: number } = {},
): Promise<UIMessage[]> {
  const params = new URLSearchParams();
  if (opts.agent_id) params.set('agent_id', opts.agent_id);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const url = `/api/sessions/${encodeURIComponent(ticket)}/messages${qs ? `?${qs}` : ''}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function fetchSessionStats(ticket: string): Promise<TicketStats> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/stats`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Live transcript event — one decoded line of the .jsonl, surfaced via
// SSE on /api/sessions/<T>/transcript. agent_id is set when the event
// came from a sub-agent file (`subagents/agent-<id>.jsonl`); empty for
// the parent thread.
export interface TranscriptEvent {
  ticket: string;
  agent_id?: string;
  type: 'tool_use' | 'tool_result' | 'tool_error' | 'text' | 'thinking' | 'stop' | 'pr-link' | 'system' | 'last-prompt' | string;
  timestamp: string;
  tool_name?: string;
  text?: string;
  detail?: Record<string, unknown>;
}

// Phase 12.3 — lifecycle actions.
export async function resumeSession(ticket: string): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/resume`, { method: 'POST' });
  if (!r.ok) throw new Error(await readError(r));
}

export async function rebaseSession(ticket: string, onto = 'develop'): Promise<{ ok: boolean; stdout: string }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(ticket)}/rebase`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onto }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function sweepMerged(): Promise<{ ok: boolean; stdout: string }> {
  const r = await fetch('/api/sweep', { method: 'POST' });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export interface WaitResult { matched: boolean; state: string; elapsed_seconds: number; }

export async function waitForState(ticket: string, state: string, timeout = 90): Promise<WaitResult> {
  const r = await fetch('/api/wait', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, state, timeout }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export interface FleetRule { id: string; path: string; created: string; body?: Record<string, unknown>; }

export async function listRules(): Promise<FleetRule[]> {
  const r = await fetch('/api/rules');
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function deleteRule(id: string): Promise<void> {
  const r = await fetch(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await readError(r));
}

export interface NotifyState { holder_pid: number; alive: boolean; standby: boolean; notify_dir: string; }

export async function fetchNotifyState(): Promise<NotifyState> {
  const r = await fetch('/api/notify-state');
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Phase 12.4 — tournament spawn
export interface TournamentArgs {
  ticket: string;
  slug: string;
  prompt: string;
  n: number;
  judge_prompt?: string;
}

export interface TournamentResult {
  ok: boolean;
  parent: string;
  variants: { ticket: string; ok: boolean; error?: string }[];
  judge_prompt?: string;
}

export async function spawnTournament(args: TournamentArgs): Promise<TournamentResult> {
  const r = await fetch('/api/tournament', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Phase 12.4 — Jira fetch
export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
}

export async function fetchJiraIssue(key: string): Promise<JiraIssue> {
  const r = await fetch(`/api/jira/issue?key=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export interface JiraBacklogItem {
  key: string;
  summary: string;
  status: string;
  priority: string;
}

export async function fetchJiraBacklog(jql?: string): Promise<JiraBacklogItem[]> {
  const url = jql ? `/api/jira/backlog?jql=${encodeURIComponent(jql)}` : '/api/jira/backlog';
  const r = await fetch(url);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Phase 12.7 — audit verify
export interface AuditResult {
  ticket: string;
  ok: boolean;
  lines: number;
  bad_line?: number;
  bad_hash?: string;
  want_hash?: string;
  reason?: string;
  head_hash?: string;
}

export async function verifyAudit(ticket?: string): Promise<AuditResult | AuditResult[]> {
  const url = ticket ? `/api/audit/verify?ticket=${encodeURIComponent(ticket)}` : '/api/audit/verify';
  const r = await fetch(url);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Phase 12.10 — tailscale
export async function tailscaleStart(funnel: boolean): Promise<{ ok: boolean; stdout?: string; error?: string }> {
  const r = await fetch('/api/tailscale/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ funnel }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function tailscaleStop(): Promise<{ ok: boolean }> {
  const r = await fetch('/api/tailscale/stop', { method: 'POST' });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function tailscaleStatus(): Promise<{ raw: unknown; rawText: string }> {
  const r = await fetch('/api/tailscale/status');
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
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
  label?: string;
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

export interface CostEstimate {
  low: number;
  high: number;
}

export async function estimateCost(prompt: string, fullAuto: boolean): Promise<CostEstimate> {
  const r = await fetch('/api/estimate-cost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, full_auto: fullAuto }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
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

export interface BroadcastResult {
  ok: boolean;
  results: { ticket: string; ok: boolean; error?: string }[];
}

export async function broadcast(message: string): Promise<BroadcastResult> {
  const r = await fetch('/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
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

// Settings — Phase 10 (BDM-26).
export interface FleetSettings {
  mobile: { enabled: boolean; ntfy_url: string; topic: string; kinds: string };
  tailscale: { enabled: boolean; funnel: boolean };
  theme: { theme: string; accent: string; font: string };
  ai?: { enabled: boolean; model: string; key_env: string };
  jira?: { base_url: string; email: string; api_token: string; jql: string };
}

export async function loadSettings(): Promise<FleetSettings> {
  const r = await fetch('/api/settings');
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function saveSettings(s: FleetSettings): Promise<FleetSettings> {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

// Chains — Phase 12.4 (BDM-28). Persisted DAGs that compose Spawn /
// Wait / Judge / Condition / Notify / Script nodes. The schema is
// intentionally open-ended (`config` is `Record<string, unknown>`) so
// new node types can land without a wire change.

export type ChainNodeType = 'spawn' | 'wait' | 'judge' | 'condition' | 'notify' | 'script';

export interface ChainNode {
  id: string;
  type: ChainNodeType;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

export interface ChainEdge {
  from: string;
  to: string;
  on_success?: boolean;
  on_failure?: boolean;
}

export interface Chain {
  id: string;
  name: string;
  created?: string;
  updated?: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  trusted?: boolean;
}

export interface ChainNodeRunState {
  node_id: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  started?: string;
  finished?: string;
  error?: string;
  outputs?: Record<string, unknown>;
}

export interface ChainRunStatus {
  run_id: string;
  chain_id: string;
  started: string;
  finished?: string;
  state: 'running' | 'done' | 'error';
  error?: string;
  nodes: Record<string, ChainNodeRunState>;
  trusted: boolean;
}

export async function listChains(): Promise<Chain[]> {
  const r = await fetch('/api/chains');
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function getChain(id: string): Promise<Chain> {
  const r = await fetch(`/api/chains/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function saveChain(c: Chain): Promise<Chain> {
  const r = await fetch(`/api/chains/${encodeURIComponent(c.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function deleteChain(id: string): Promise<void> {
  const r = await fetch(`/api/chains/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await readError(r));
}

export async function runChain(id: string): Promise<{ ok: boolean; run_id: string; chain_id: string }> {
  const r = await fetch(`/api/chains/${encodeURIComponent(id)}/run`, { method: 'POST' });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function getChainRun(chainID: string, runID: string): Promise<ChainRunStatus> {
  const r = await fetch(`/api/chains/${encodeURIComponent(chainID)}/runs/${encodeURIComponent(runID)}`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function listChainRuns(chainID: string): Promise<ChainRunStatus[]> {
  const r = await fetch(`/api/chains/${encodeURIComponent(chainID)}/runs`);
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function fetchVersion(): Promise<{ build: string; project: string }> {
  try {
    const r = await fetch('/api/version');
    if (r.ok) return r.json();
  } catch { /* fall through */ }
  return { build: 'dev', project: 'unknown' };
}
