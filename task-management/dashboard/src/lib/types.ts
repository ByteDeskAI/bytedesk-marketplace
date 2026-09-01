/** Exactly what index.json and events.jsonl already contain. Nothing invented. */
export type Status =
  "backlog" | "open" | "in_progress" | "blocked" | "parked" | "done" | "deleted";

/** The vocabulary `lib/issue.mjs` TYPES owns. `subtask` is parentage, not a type. */
export const TYPES = ["task", "bug", "story", "spike", "chore"] as const;
export type IssueType = (typeof TYPES)[number];

export interface Acceptance {
  text?: string;
  done?: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: Status;
  epic?: string | null;
  created?: string;
  updated?: string;
  closed?: string;
  acceptance?: Acceptance[];
  blockedBy?: string[];
  evidence?: string[];
  commits?: string[];
  session?: string;
  actor?: string;
  branch?: string;
  worktree?: string;
  blockedReason?: string;
  parkedReason?: string;
  // TM-028 (lib/issue.mjs). All optional — a task with none of them set is unchanged.
  assignee?: string;
  labels?: string[];
  /** Derived on the board payload — true when the task body has a non-empty ## Answer. */
  hasAnswer?: boolean;
  priority?: Priority;
  estimate?: number;
  comments?: Comment[];
  links?: Link[];
  parent?: string;
  rank?: number;
  /**
   * Stored issue type. May be absent on older tasks — those still have a type via `typeOf`
   * (a recognised label, else `task`). `subtask` is not a type; `parent` expresses that.
   */
  type?: IssueType;
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
  /** Set when the task was imported from a goal doc. */
  goalDoc?: string;
  touches?: string[];
  /** Sprint this card is committed to, when it is. Closing a sprint leaves this set. */
  sprint?: string | null;
  /** Minted from a capability — join is `task.capability` → `CAP-*`, never the reverse epic field. */
  capability?: string;
}

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

/** `GET /api/templates` — what the create picker lists. */
export interface TemplateSummary {
  name: string;
  description: string;
}

/** `GET /api/templates/:name` — the file `readTemplate` returns. */
export interface TemplateDetail {
  name: string;
  fields: Record<string, unknown>;
  body: string;
}

/**
 * How a task's type is decided — same order as `typeOf` in lib/issue.mjs.
 * Stored field, then a recognised label (the pre-field encoding), then `task`.
 */
export function typeOf(
  task?: Pick<Task, "type" | "labels"> | null,
): IssueType {
  if (task?.type && (TYPES as readonly string[]).includes(task.type)) {
    return task.type;
  }
  const worn = (task?.labels ?? [])
    .map((l) => String(l).toLowerCase())
    .find((l) => (TYPES as readonly string[]).includes(l) && l !== "task");
  return (worn as IssueType) || "task";
}

/** Derived by GET /api/task/:id/evidence — not stored frontmatter. */
export interface EvidenceItem {
  ref: string;
  kind: "file" | "url" | "uri";
  name: string;
  exists: boolean;
  previewable: boolean;
}

export interface Comment {
  author?: string;
  ts: string;
  text: string;
}

export interface Link {
  type: string;
  id: string;
}

export interface Epic {
  id: string;
  title: string;
  status: Status;
  closed?: string;
  /** Linked plan path, when this epic was captured from one. */
  plan?: string;
  labels?: string[];
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
}

/** `GET /api/plans` — derived readdir, not a KIND. */
export interface PlanInboxItem {
  path: string;
  name: string;
  linkedEpic?: string;
  exists: boolean;
}

/** One goal row from parseManifest — title + list, never a raw dump. */
export interface PlanManifestGoal {
  id: string;
  title?: string | null;
  doc?: string;
}

export interface PlanManifest {
  plan?: string | null;
  epicTitle?: string;
  goals?: PlanManifestGoal[];
  error?: string;
}

/** `GET /api/plans/file?ref=` — confined; 404 outside p.plans unless it is epic.plan. */
export interface PlanFile {
  ref: string;
  name: string;
  content?: string;
  manifest?: PlanManifest;
}

/** ADR lifecycle only — never a task Status. */
export type AdrStatus = "proposed" | "accepted" | "superseded";

export interface Adr {
  id: string;
  title: string;
  status: string;
  epic?: string | null;
  date?: string;
  created?: string;
  updated?: string;
  deciders?: string[];
  supersedes?: string;
  decisionKey?: string;
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
}

/** Sized points only; unsized is counted separately and never treated as 0. */
export interface SprintReport {
  cards: number;
  committed: number;
  done: number;
  unsized: number;
}

export interface Sprint {
  id: string;
  title: string;
  status: string;
  ends?: string;
  closed?: string;
  /** Derived by sprintCounts — the same helper sprintReport prints. */
  report?: SprintReport;
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
}

/** Store vocabulary: proposed is `open`, accepted is `in_progress`, shipped is `done`. */
export interface Capability {
  id: string;
  title: string;
  status: string;
  area?: string;
  impact?: string;
  effort?: string;
  confidence?: string;
  source?: string;
  evidence?: string[];
  related?: string[];
  /** Minted task that builds this. Epic is on that task, never here. */
  task?: string;
  shipped?: string;
  droppedReason?: string;
  created?: string;
  updated?: string;
  /** Derived impact × ease × confidence, 1–27. Not a store field. */
  score?: number;
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
}

export interface Board {
  generated: string;
  epics: Epic[];
  tasks: Task[];
  adrs: Adr[];
  sprints: Sprint[];
  /** Ranked enhancement backlog. Empty `capabilities/` is `[]`, not omitted. */
  capabilities?: Capability[];
  /** state.json. The board payload has always carried this; the UI used to ignore it. */
  state?: { activeEpic?: string | null; activeSprint?: string | null; claims?: Record<string, unknown> };
  /** Board preferences out of the repo's own config, so they follow the project not the browser. */
  settings?: {
    categories?: string[];
    me?: string | null;
    watching?: string[];
    grouped?: boolean;
    views?: Record<string, unknown>;
  };
  /** How the store labels this session — what the profile menu shows. */
  actor?: string;
  /** The project this board belongs to, in title case, from the repo's directory name. */
  project?: string;
  /** Canonical + configured label vocabulary (decision:* and triage roles). */
  labelCatalog?: string[];
}

export interface StoreEvent {
  ts: string;
  event: string;
  /**
   * The catalog's sentence for `event`, attached by `/api/events`. The vocabulary lives in
   * lib/ntfy.mjs and the SPA imports nothing from lib/, so it arrives on the payload rather than
   * being duplicated here. Optional because the PWA replays events cached before this existed.
   */
  label?: string;
  /** An `update` a specific event in the same second already explains. Set by /api/events. */
  _shadowed?: boolean;
  /** Set by /api/events when this write moved the entity's status; the value it moved to. */
  _status?: string;
  id?: string;
  title?: string;
  status?: string;
  session?: string | null;
  actor?: string;
  patch?: string;
  reason?: string;
  from?: string;
  to?: string;
}

// ── the rewrite's additions: shapes of the new routes (docs/dashboard-api.md) ──────────

/** `GET /api/meta` — vocabulary and identity, so the SPA hardcodes nothing. */
export interface Meta {
  plugin: { version: string; root: string };
  store: { root: string; base: string; boardId: string; owner?: string; project: string };
  harness: "claude" | "codex" | "grok" | null;
  actor: string;
  session: string | null;
  vocab: {
    columns: string[];
    labels: Record<string, string>;
    priorities: string[];
    types: string[];
    linkTypes: Record<string, string>;
    adrStatuses: string[];
    capLevels: string[];
    capEfforts: string[];
    findFields: string[];
    eventCatalog: Record<string, Record<string, { label: string; priority?: number; tags?: string[] }>>;
    exportFormats: string[];
    labelCatalog: string[];
  };
  settings: SettingsSnapshot;
  config: Record<string, unknown>;
  gates: { enforce: boolean; override: { reason: string; ts: string } | null };
}

export interface SettingsField {
  key: string;
  group: string;
  label: string;
  type: "boolean" | "number" | "string" | "enum" | "json" | string;
  help?: string;
  value?: unknown;
  default?: unknown;
  options?: string[];
  readOnly?: boolean;
}
export interface SettingsSnapshot {
  groups: { id: string; label: string; help?: string }[];
  fields: SettingsField[];
  ntfy?: { token: string | null; active: boolean };
}

export type Kind = "task" | "epic" | "adr" | "sprint" | "capability";
export type Entity = Task | Epic | Adr | Sprint | Capability;

/** `GET /api/task/:id/why` */
export interface Why {
  id: string;
  title?: string;
  status?: string;
  startable: boolean;
  reasons: { kind: string; blocking: boolean; text: string }[];
  chain: { id: string; depth: number; status?: string; title?: string; reason?: string }[];
  roots: string[];
  cycles?: string[][];
  text: string;
}

/** `GET /api/graph` */
export interface GraphNode { id: string; title?: string; status?: string; epic?: string | null; kind?: string }
export interface GraphEdge { from: string; to: string; type?: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; activeEpic?: string | null; mermaid: string }

/** `GET /api/time` and `GET /api/task/:id/time` */
export interface TimeSummary {
  completed: number;
  medianMs: number | null;
  meanMs: number | null;
  median?: string;
  mean?: string;
  wip: { id: string; ms: number }[];
  oldestOpen: { id: string; ms: number } | null;
  throughput: { byDay: Record<string, number>; total: number; perDay: number };
}
export interface TaskTime {
  id: string;
  cycle: number | null;
  inStatus: Record<string, number>;
  timeline: { ts: string; status?: string; event: string }[];
}

/** `GET /api/find?q=` */
export interface FindHit { id: string; kind: Kind; title: string; status?: string; epic?: string | null; labels?: string[]; priority?: string; assignee?: string }

/** `GET /api/claims` */
export interface Claim { session: string | null; actor?: string; worktree?: string; branch?: string; pid?: number; ts?: string }
export interface Claims { claims: Record<string, Claim>; stale: string[]; wipLimit: number; inProgress: number }

/** `GET /api/sessions` */
export interface Session { session: string | null; actor?: string; tasks: string[]; worktree?: string; branch?: string; ts?: string; live: boolean }

/** `GET /api/doctor` */
export interface Finding { level: "error" | "warning"; code: string; id?: string; message: string; fixable: boolean }
export interface Doctor { findings: Finding[]; errors: number; warnings: number; fixable: number; text: string }

/** `GET /api/worktrees` */
export interface Worktree { path: string; branch?: string; taskId?: string; dirty?: boolean; ahead?: number; exists?: boolean }

/** `GET /api/skills` */
export interface Skill { name: string; description: string; userInvokable: boolean; command: string }

/** `GET /api/parallel` */
export interface Batch { tasks: { id: string; title: string }[]; touches: string[] }

/** `GET /api/entity/:id/history` */
export interface History { id: string; events: StoreEvent[]; text: string }

/** `GET /api/ntfy` */
export interface NtfyInfo { config: Record<string, unknown>; hasToken: boolean; catalog: Record<string, Record<string, { label: string }>> }

/** Transcript messages for the live work stream (`/api/task/:id/stream`). */
export interface StreamPart { type: string; text?: string; name?: string; input?: unknown; output?: unknown; isError?: boolean }
export interface StreamMessage { id?: string; role: "user" | "assistant" | "system" | string; parts: StreamPart[]; ts?: string }
export interface Stream { messages: StreamMessage[]; session?: string | null; file?: string; harness?: string | null; reason?: string }
