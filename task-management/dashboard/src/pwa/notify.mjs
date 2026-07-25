/**
 * What is worth interrupting a human for.
 *
 * The board exists to watch several agents work at once, so the useful
 * notification is the one you would otherwise have to sit and stare at the tab
 * to catch: work stopping, work being taken away, a gate saying no, an epic
 * finishing. Everything else — creates, comments, ranks — is noise.
 *
 * Pure on purpose: `notificationFor` decides, the caller does the showing. The
 * whole filter is unit-tested without a browser (tests/unit/pwa-notify.test.mjs).
 */

/** The categories a user can switch on and off, and what each one means to them. */
export const CATEGORIES = {
  blocked: "A task you watch becomes blocked",
  claim: "Another session steals a claim you watch",
  gate: "A transition is refused for unmet acceptance criteria",
  epic: "An epic closes itself",
  assigned: "A task assigned to you changes hands",
};

/**
 * How long after this tab's own write we assume an arriving event is the echo of
 * it. The SSE round trip is milliseconds; ten seconds is slack, not a guess.
 */
export const SELF_WINDOW_MS = 10_000;

/**
 * Remember that this tab just wrote to `id`, and forget the writes too old to
 * suppress anything. Bounded by construction — no cleanup timer needed.
 * @param {{id: string, ts: number}[]} self
 * @param {string | null} id
 * @param {number} now
 */
export function recordSelfWrite(self, id, now = Date.now()) {
  const fresh = self.filter((s) => now - s.ts < SELF_WINDOW_MS);
  return id ? [...fresh, { id, ts: now }] : fresh;
}

const isSelf = (self, id, now) =>
  Boolean(id) && self.some((s) => s.id === id && now - s.ts < SELF_WINDOW_MS);

/**
 * @param {any} event a line from events.jsonl, or a locally
 *   synthesised `gate_refused` for a 409 the board itself received.
 * @param {{me?: string|null, watching?: Set<string>, categories?: Set<string>,
 *          self?: {id: string, ts: number}[], now?: number}} opts
 * @returns {{category: string, title: string, body: string, tag: string, id: string|null} | null}
 */
export function notificationFor(event, opts = {}) {
  const { me = null, watching = new Set(), categories = new Set(), self = [], now = Date.now() } = opts;
  const id = event?.id ?? null;
  const decided = decide(event, { me, watching });
  if (!decided) return null;
  if (!categories.has(decided.category)) return null;
  // A notification for a change this tab just made is the tab telling itself
  // what it already knows.
  if (isSelf(self, id, now)) return null;
  return { ...decided, id, tag: `${decided.category}:${id ?? "board"}` };
}

function decide(event, { me, watching }) {
  const id = event?.id ?? null;
  switch (event?.event) {
    case "update":
      if (event.status !== "blocked" || !watching.has(id)) return null;
      return {
        category: "blocked",
        title: `${id} is blocked`,
        body: event.blockedReason || "Work stopped — the board needs you.",
      };

    case "claim_stolen":
      if (!watching.has(id)) return null;
      return {
        category: "claim",
        title: `${id} was taken`,
        body: `Claimed by ${event.to || "another session"}.`,
      };

    // Gate refusals never reach events.jsonl — a refused transition writes
    // nothing, by design. `gate_refused` is synthesised from the 409 the board
    // got back, including one from a replayed offline write.
    case "gate_refused":
      return {
        category: "gate",
        title: `${id || "A transition"} was refused`,
        body: event.reason || "The gate said no.",
      };

    case "stop_gate_blocked":
      return {
        category: "gate",
        title: "The stop gate is holding",
        body: `Unfinished: ${event.tasks || "work in progress"}.`,
      };

    case "epic_auto_closed":
      return {
        category: "epic",
        title: `${id} closed itself`,
        body: `Every task under it is done${event.tasks ? ` (${event.tasks}).` : "."}`,
      };

    // The event carries only the new assignee, so "changed hands" is either
    // direction: it landed on me, or it left something I was watching.
    case "assign": {
      if (!me) return null;
      const to = event.assignee ?? null;
      if (to === me) return { category: "assigned", title: `${id} is yours`, body: `Assigned to ${me}.` };
      if (!watching.has(id)) return null;
      return {
        category: "assigned",
        title: `${id} changed hands`,
        body: to ? `Now assigned to ${to}.` : "The assignee was cleared.",
      };
    }

    default:
      return null;
  }
}
