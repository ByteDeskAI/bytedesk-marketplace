/** Exactly what index.json and events.jsonl already contain. Nothing invented. */
export type Status = "open" | "in_progress" | "blocked" | "parked" | "done" | "deleted";

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
}

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

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
}

export interface Board {
  generated: string;
  epics: Epic[];
  tasks: Task[];
  adrs: { id: string; title: string; status: string }[];
  /** state.json. The board payload has always carried this; the UI used to ignore it. */
  state?: { activeEpic?: string | null; claims?: Record<string, unknown> };
}

export interface StoreEvent {
  ts: string;
  event: string;
  id?: string;
  title?: string;
  status?: string;
  session?: string | null;
  actor?: string;
}
