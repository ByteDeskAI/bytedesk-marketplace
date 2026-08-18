import { queueWrite } from "./pwa/outbox.mjs";
import { markSelfWrite } from "./pwa/usePwa";
import type { Adr, Board, Epic, EvidenceItem, StoreEvent, Task, TemplateDetail, TemplateSummary } from "./types";

const json = <T>(url: string): Promise<T> =>
  fetch(url).then((r) => r.json() as Promise<T>);

export const fetchBoard = () => json<Board>("/api/board");

export const fetchEvents = () =>
  json<StoreEvent[]>("/api/events").catch((): StoreEvent[] => []);

/**
 * One task in full. The board payload strips `body` from every task on purpose — a 20-task board
 * would otherwise ship tens of kilobytes of markdown nobody is reading — so the drawer fetches
 * the record it is about to show.
 */
export const fetchTask = (id: string) =>
  json<Task>(`/api/task/${encodeURIComponent(id)}`);

/** One epic in full. The board payload strips `body` the same way it does for tasks. */
export const fetchEpic = (id: string) =>
  json<Epic>(`/api/epic/${encodeURIComponent(id)}`);

/** One ADR in full. The board list strips `body` the same way it does for tasks and epics. */
export const fetchAdr = (id: string) =>
  json<Adr>(`/api/adr/${encodeURIComponent(id)}`);

export const fetchTemplates = () => json<TemplateSummary[]>("/api/templates");

export const fetchTemplate = (name: string) =>
  json<TemplateDetail>(`/api/templates/${encodeURIComponent(name)}`);

/** Derived items for the drawer. The task still only stores evidence[] strings. */
export const fetchEvidence = (id: string) =>
  json<{ evidence: EvidenceItem[] }>(
    `/api/task/${encodeURIComponent(id)}/evidence`,
  );

/** Multipart attach — not queued offline: a File cannot go through the JSON outbox. */
export async function attachEvidenceFile(id: string, file: File) {
  markSelfWrite(id);
  const body = new FormData();
  body.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/task/${encodeURIComponent(id)}/evidence`, {
      method: "POST",
      body,
    });
  } catch {
    throw new WriteError("offline — file attach is not queued");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new WriteError(data.error || `POST evidence failed (${res.status})`);
  }
  return data;
}

/** A refusal from a gate — the reason is written for the person reading the board. */
export class WriteError extends Error {}

async function send(method: string, url: string, payload?: unknown) {
  // Recorded before the request: the SSE echo of our own write can beat the
  // response back, and a tab must not notify itself about its own change.
  markSelfWrite(url.match(/^\/api\/task\/([^/?]+)/)?.[1] ?? null);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
  } catch {
    // The write never reached the server. Keep the intent and replay it through
    // this same function on reconnect, so it meets the same gates and can be
    // refused the same way — a queued write is deferred, not forgiven.
    queueWrite({ method, url, body: payload ?? {} });
    throw new WriteError(
      "offline — queued, and replayed when the server is back",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new WriteError(
      data.error || `${method} ${url} failed (${res.status})`,
    );
  return data;
}

/** Prompt for a stop reason. Cancel / empty omits the field; the transition still happens. */
export function stopReason(status: Task["status"] | string): { reason?: string } {
  if (status !== "blocked" && status !== "parked") return {};
  const why = window.prompt(
    status === "blocked" ? "Why is this blocked?" : "Why is this parked?",
  );
  return why?.trim() ? { reason: why.trim() } : {};
}

/** One call per board action. The server owns the gates; this is only plumbing. */
export const write = {
  // `body` was missing here, so the create form collected a markdown body into React state and
  // dropped it on submit — the server had accepted and stored it all along.
  create: (payload: {
    title: string;
    body?: string;
    epic?: string | null;
    assignee?: string;
    priority?: string;
    template?: string;
  }) => send("POST", "/api/task", payload) as Promise<{ id: string }>,
  /** `{ title }` creates; `{ id }` still activates. Do not send both. */
  createEpic: (payload: { title: string; body?: string }) =>
    send("POST", "/api/epic", payload),
  closeEpic: (id: string) => send("POST", `/api/epic/${id}/close`),
  reopenEpic: (id: string) => send("POST", `/api/epic/${id}/reopen`),
  createAdr: (payload: { title: string; body?: string }) =>
    send("POST", "/api/adr", payload),
  acceptAdr: (id: string) => send("POST", `/api/adr/${id}/accept`),
  supersedeAdr: (id: string, payload: { title: string; body?: string }) =>
    send("POST", `/api/adr/${id}/supersede`, payload),
  edit: (id: string, payload: { title?: string; body?: string; epic?: string | null }) =>
    send("PATCH", `/api/task/${id}`, payload),
  act: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    send("POST", `/api/task/${id}/${action}`, payload),
  /** Board preferences, written to the repo's config so they follow the project. */
  settings: (patch: Record<string, unknown>) =>
    send("POST", "/api/settings", patch),
  bulk: (ids: string[], op: string, args: Record<string, unknown> = {}) =>
    send("POST", "/api/bulk", { ids, op, args }),
  transition: (
    id: string,
    status: Task["status"],
    extra: Record<string, unknown> = {},
  ) => send("POST", `/api/task/${id}/transition`, { status, ...extra }),
  /** Add or remove blockers. Refused server-side if it would close a cycle. */
  dep: (id: string, change: { add?: string[]; remove?: string[] }) =>
    send("POST", `/api/task/${id}/dep`, change),
  /** Switch the active epic — the gate every subsequent task creation passes through. */
  activeEpic: (id: string | null) => send("POST", "/api/epic", { id }),
};

/** The server's SSE tail of events.jsonl. Reconnects are the browser's job. */
export function subscribe(
  onEvent: (e: StoreEvent) => void,
  onLive: (live: boolean) => void,
) {
  const src = new EventSource("/events");
  src.onopen = () => onLive(true);
  src.onerror = () => onLive(false);
  src.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as StoreEvent);
    } catch {
      /* a half-written line will arrive again on the next tick */
    }
  };
  return () => src.close();
}
