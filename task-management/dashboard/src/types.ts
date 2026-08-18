/** Exactly what index.json and events.jsonl already contain. Nothing invented. */
export type Status =
  "backlog" | "open" | "in_progress" | "blocked" | "parked" | "done" | "deleted";

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
  priority?: Priority;
  estimate?: number;
  comments?: Comment[];
  links?: Link[];
  parent?: string;
  rank?: number;
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
  /** Set when the task was imported from a goal doc. */
  goalDoc?: string;
  touches?: string[];
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
  /** Only present on a detail fetch — the list payload strips it. */
  body?: string;
}

export interface Board {
  generated: string;
  epics: Epic[];
  tasks: Task[];
  adrs: { id: string; title: string; status: string }[];
  /** state.json. The board payload has always carried this; the UI used to ignore it. */
  state?: { activeEpic?: string | null; claims?: Record<string, unknown> };
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
