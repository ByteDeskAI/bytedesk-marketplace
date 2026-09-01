/**
 * Every fetch, one place. The server owns the gates; this is plumbing. Route contract:
 * task-management/docs/dashboard-api.md.
 */
import { queueWrite } from "../pwa/outbox.mjs";
import { markSelfWrite } from "../pwa/usePwa";
import type {
  Adr, Batch, Board, Capability, Claims, Doctor, Entity, Epic, EvidenceItem, FindHit, Graph, History,
  Meta, NtfyInfo, PlanFile, PlanInboxItem, Session, SettingsSnapshot, Skill, Sprint, StoreEvent, Task,
  TaskTime, TemplateDetail, TemplateSummary, TimeSummary, Why, Worktree,
} from "./types";

/** A refusal from a gate — the reason is written for the person reading the board. */
export class WriteError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "" && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};
const enc = encodeURIComponent;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new WriteError(data.error || `GET ${url} failed (${res.status})`, res.status);
  return data;
}

// ── reads ──────────────────────────────────────────────────────────────────────────────
export const fetchBoard = () => json<Board>("/api/board");
export const fetchMeta = () => json<Meta>("/api/meta");
export const fetchSettings = () => json<SettingsSnapshot>("/api/settings");
export const fetchEvents = (params: { since?: string; limit?: number; id?: string; kind?: string } = {}) =>
  json<StoreEvent[]>(`/api/events${q(params)}`).catch((): StoreEvent[] => []);
/** Any kind by id; the board payload strips `body`, so detail views fetch the record. */
export const fetchEntity = (id: string) => json<Entity>(`/api/entity/${enc(id)}`);
export const fetchTask = (id: string) => json<Task>(`/api/task/${enc(id)}`);
export const fetchEpic = (id: string) => json<Epic>(`/api/epic/${enc(id)}`);
export const fetchAdr = (id: string) => json<Adr>(`/api/adr/${enc(id)}`);
export const fetchSprint = (id: string) => json<Sprint>(`/api/sprint/${enc(id)}`);
export const fetchCapability = (id: string) => json<Capability>(`/api/capability/${enc(id)}`);
export const fetchBacklog = () => json<Task[]>("/api/backlog");
export const fetchTemplates = () => json<TemplateSummary[]>("/api/templates");
export const fetchTemplate = (name: string) => json<TemplateDetail>(`/api/templates/${enc(name)}`);
export const fetchEvidence = (id: string) => json<{ evidence: EvidenceItem[] }>(`/api/task/${enc(id)}/evidence`);
export const evidenceUrl = (id: string, ref: string) => `/api/task/${enc(id)}/file?ref=${enc(ref)}`;
export const fetchPlans = () => json<PlanInboxItem[]>("/api/plans").catch((): PlanInboxItem[] => []);
export const fetchPlanFile = (ref: string) => json<PlanFile>(`/api/plans/file?ref=${enc(ref)}`);
export const fetchWorktrees = () => json<Worktree[]>("/api/worktrees");
export const fetchWhy = (id: string) => json<Why>(`/api/task/${enc(id)}/why`);
export const fetchGraph = (params: { epic?: string; all?: boolean; subtasks?: boolean } = {}) =>
  json<Graph>(`/api/graph${q({ epic: params.epic, all: params.all ? 1 : undefined, subtasks: params.subtasks === false ? 0 : undefined })}`);
export const fetchStandup = (since?: string) => json<{ since: string; text: string }>(`/api/standup${q({ since })}`);
export const fetchHandoff = (id: string) => json<{ id: string; text: string }>(`/api/task/${enc(id)}/handoff`);
export const fetchTime = () => json<TimeSummary>("/api/time");
export const fetchTaskTime = (id: string) => json<TaskTime>(`/api/task/${enc(id)}/time`);
export const fetchStale = () => json<{ minutes: number; tasks: string[] }>("/api/stale");
export const fetchHistory = (id: string) => json<History>(`/api/entity/${enc(id)}/history`);
export const find = (query: string) => json<{ query: string; hits: FindHit[] }>(`/api/find?q=${enc(query)}`);
export const fetchClaims = () => json<Claims>("/api/claims");
export const fetchParallel = (epic?: string) => json<{ batches: Batch[] }>(`/api/parallel${q({ epic })}`);
export const fetchNtfy = () => json<NtfyInfo>("/api/ntfy");
export const fetchOverride = () => json<{ override: { reason: string; ts: string } | null; enforce: boolean }>("/api/override");
export const fetchDoctor = () => json<Doctor>("/api/doctor");
export const fetchSessions = () => json<{ harness: string | null; sessions: Session[] }>("/api/sessions");
export const fetchSkills = () => json<Skill[]>("/api/skills");
/** A URL, not a fetch: the browser downloads it. */
export const exportUrl = (params: { format: string; epic?: string; status?: string; open?: boolean; events?: boolean; download?: boolean }) =>
  `/api/export${q({ ...params, open: params.open ? 1 : undefined, events: params.events ? 1 : undefined, download: params.download ? 1 : undefined })}`;

// ── writes ─────────────────────────────────────────────────────────────────────────────
async function send<T = Record<string, unknown>>(method: string, url: string, payload?: unknown): Promise<T> {
  // Recorded before the request: the SSE echo of our own write can beat the response back,
  // and a tab must not notify itself about its own change.
  markSelfWrite(url.match(/^\/api\/task\/([^/?]+)/)?.[1] ?? null);
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
  } catch {
    // Kept and replayed through the same gates on reconnect — deferred, not forgiven.
    queueWrite({ method, url, body: payload ?? {} });
    throw new WriteError("offline — queued, and replayed when the server is back");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new WriteError(data.error || `${method} ${url} failed (${res.status})`, res.status);
  return data;
}

/** Multipart attach — not queued offline: a File cannot go through the JSON outbox. */
export async function attachEvidenceFile(id: string, file: File) {
  markSelfWrite(id);
  const body = new FormData();
  body.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/task/${enc(id)}/evidence`, { method: "POST", body });
  } catch {
    throw new WriteError("offline — file attach is not queued");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new WriteError(data.error || `POST evidence failed (${res.status})`, res.status);
  return data;
}

const task = (id: string, action: string, payload: Record<string, unknown> = {}) => send("POST", `/api/task/${enc(id)}/${action}`, payload);

/** One call per board action. Names mirror the CLI verbs. */
export const write = {
  // tasks
  create: (payload: { title: string; body?: string; epic?: string | null; assignee?: string; priority?: string; template?: string; acceptance?: string[] }) =>
    send<{ id: string; title: string; epic?: string | null }>("POST", "/api/task", payload),
  edit: (id: string, payload: { title?: string; body?: string; epic?: string | null }) => send("PATCH", `/api/task/${enc(id)}`, payload),
  transition: (id: string, status: Task["status"], extra: { reason?: string; steal?: boolean } = {}) => task(id, "transition", { status, ...extra }),
  act: task,
  assign: (id: string, assignee: string | null) => task(id, "assign", { assignee }),
  labels: (id: string, change: { add?: string[]; remove?: string[] }) => task(id, "labels", change),
  type: (id: string, type: string) => task(id, "type", { type }),
  priority: (id: string, priority: string | null) => task(id, "priority", { priority }),
  estimate: (id: string, estimate: number | null) => task(id, "estimate", { estimate }),
  comment: (id: string, text: string) => task(id, "comment", { text }),
  link: (id: string, type: string, to: string) => task(id, "link", { type, to }),
  unlink: (id: string, type: string, to: string) => task(id, "unlink", { type, to }),
  subtask: (id: string, parent: string | null) => task(id, "subtask", { parent }),
  dep: (id: string, change: { add?: string[]; remove?: string[] }) => task(id, "dep", change),
  rank: (id: string, where: { before?: string; after?: string; to?: number }) => task(id, "rank", where),
  ac: (id: string, text: string) => task(id, "ac", { text }),
  accept: (id: string, index: number, opts: { done?: boolean; remove?: boolean } = {}) => task(id, "accept", { index, ...opts }),
  evidence: (id: string, payload: { text?: string; path?: string; detach?: string }) => task(id, "evidence", payload),
  sprint: (id: string, sprint: string | null) => task(id, "sprint", { sprint }),
  worktree: (id: string, action: "create" | "remove", force = false) => task(id, "worktree", { action, force }),
  claim: (id: string, steal = false) => task(id, "claim", { steal }),
  release: (id: string) => task(id, "release"),
  deleteTask: (id: string, why?: string) => task(id, "delete", why ? { why } : {}),
  restoreTask: (id: string) => task(id, "restore"),
  touches: (id: string, paths: string[]) => task(id, "touches", { paths }),
  bulk: (ids: string[], op: string, args: Record<string, unknown> = {}) =>
    send<{ ok: string[]; failed: { id: string; error: string }[] }>("POST", "/api/bulk", { ids, op, args }),
  // epics
  createEpic: (payload: { title: string; body?: string }) => send<{ id: string }>("POST", "/api/epic", payload),
  activeEpic: (id: string | null) => send("POST", "/api/epic", { id }),
  editEpic: (id: string, payload: { title?: string; body?: string }) => send("PATCH", `/api/epic/${enc(id)}`, payload),
  closeEpic: (id: string) => send("POST", `/api/epic/${enc(id)}/close`),
  reopenEpic: (id: string) => send("POST", `/api/epic/${enc(id)}/reopen`),
  epicPlan: (id: string, plan: string | null) => send("POST", `/api/epic/${enc(id)}/plan`, { plan }),
  // decisions
  createAdr: (payload: { title: string; body?: string }) => send<{ id: string }>("POST", "/api/adr", payload),
  editAdr: (id: string, payload: { title?: string; body?: string; deciders?: string[] }) => send("PATCH", `/api/adr/${enc(id)}`, payload),
  acceptAdr: (id: string) => send("POST", `/api/adr/${enc(id)}/accept`),
  supersedeAdr: (id: string, payload: { title: string; body?: string }) => send<{ id: string }>("POST", `/api/adr/${enc(id)}/supersede`, payload),
  // sprints
  createSprint: (payload: { title: string; ends?: string }) => send<{ id: string }>("POST", "/api/sprint", payload),
  activeSprint: (id: string | null) => send("POST", "/api/sprint", { id }),
  editSprint: (id: string, payload: { title?: string; ends?: string | null; body?: string }) => send("PATCH", `/api/sprint/${enc(id)}`, payload),
  closeSprint: (id: string) => send<{ unfinished?: number }>("POST", `/api/sprint/${enc(id)}/done`),
  // capabilities
  proposeCap: (payload: { title: string; area?: string; impact?: string; effort?: string; confidence?: string; source?: string; problem?: string; current?: string; proposal?: string; criteria?: string[]; nonGoals?: string[] }) =>
    send<{ id: string }>("POST", "/api/capability", payload),
  editCap: (id: string, payload: Record<string, unknown>) => send("PATCH", `/api/capability/${enc(id)}`, payload),
  acceptCap: (id: string) => send<{ task?: string }>("POST", `/api/capability/${enc(id)}/accept`),
  shipCap: (id: string, payload: { evidence?: string; task?: string } = {}) => send("POST", `/api/capability/${enc(id)}/ship`, payload),
  dropCap: (id: string, why?: string) => send("POST", `/api/capability/${enc(id)}/drop`, why ? { why } : {}),
  // store-level
  settings: (patch: Record<string, unknown>) => send<{ applied?: string[]; ignored?: string[] }>("POST", "/api/settings", patch),
  doctorFix: () => send<{ applied: { code: string; id?: string; did?: string; error?: string }[]; findings: Doctor["findings"] }>("POST", "/api/doctor/fix", { confirm: true }),
  reindex: () => send("POST", "/api/reindex"),
  sweep: () => send<{ released: string[] }>("POST", "/api/claims/sweep", { confirm: true }),
  override: (reason: string) => send("POST", "/api/override", { reason }),
  ntfyTest: (event?: string) => send<{ sent: boolean; status?: number; error?: string; reason?: string }>("POST", "/api/ntfy/test", event ? { event } : {}),
  goalImport: (payload: { path?: string; content?: string; name?: string; epic?: string }) =>
    send<{ id?: string; epic?: string; tasks?: string[]; skipped?: { id: string; why: string }[] }>("POST", "/api/goal/import", payload),
  createTemplate: (payload: { name: string; description?: string; fields?: Record<string, unknown>; body: string; overwrite?: boolean }) =>
    send("POST", "/api/templates", payload),
  editTemplate: (name: string, payload: { description?: string; fields?: Record<string, unknown>; body?: string }) =>
    send("PATCH", `/api/templates/${enc(name)}`, payload),
};

// ── live feed ──────────────────────────────────────────────────────────────────────────
export interface FeedHandlers {
  onEvent: (e: StoreEvent) => void;
  onLive: (live: boolean) => void;
  /** The server lost continuity (log rotated, or we reconnected past its tail): refetch. */
  onResync?: () => void;
}

/**
 * The SSE tail of events.jsonl. Reconnects are the browser's job; `Last-Event-ID` replay is
 * the server's (docs/dashboard-api.md §SSE). Untyped `message` frames are the pre-rewrite
 * server — same payload, no id.
 */
export function subscribe({ onEvent, onLive, onResync }: FeedHandlers) {
  const src = new EventSource("/events");
  const parse = (m: MessageEvent) => {
    try {
      onEvent(JSON.parse(m.data) as StoreEvent);
    } catch {
      /* a half-written line arrives again on the next tick */
    }
  };
  src.onopen = () => onLive(true);
  src.onerror = () => onLive(false);
  src.onmessage = parse;
  src.addEventListener("store", parse as EventListener);
  src.addEventListener("resync", () => onResync?.());
  return () => src.close();
}
