/**
 * Push notifications over ntfy, fired hook-side.
 *
 * The dashboard's Notification API only reaches you with a browser open. ntfy
 * reaches your phone while the machine is unattended, which is the case that
 * matters when several agents are working a board on their own.
 *
 * Three rules this module never breaks:
 *   1. It never throws. A notifier that fails a hook or a `tm` command is worse
 *      than one that stays quiet.
 *   2. Nothing fires unless its event kind is explicitly switched on. Every kind
 *      is off by default — see CATALOG for what is available.
 *   3. The token comes from the environment only. `config.json` lives in the
 *      git-tracked store, so a credential must never be written there.
 */
import { config } from "./store.mjs";
import { paths } from "./paths.mjs";

/**
 * Every event kind the store emits, grouped for the settings panel.
 *
 * `recommended` — things a human would want to be interrupted for.
 * `writes`      — the full write stream; useful for watching agents work, but a
 *                 busy board will notify constantly, so these are opt-in.
 * `noise`       — bookkeeping. Listed so the panel is honest about what exists,
 *                 but you almost certainly never want a phone buzz for these.
 */
export const CATALOG = {
  events: {
    // recommended
    stop_gate_blocked: { group: "recommended", label: "A session is blocked from stopping with work still open", priority: "high", tags: "warning" },
    claim_stolen: { group: "recommended", label: "Another session took a claim", priority: "high", tags: "twisted_rightwards_arrows" },
    claims_swept: { group: "recommended", label: "A claim expired and work was abandoned", priority: "default", tags: "ghost" },
    epic_auto_closed: { group: "recommended", label: "An epic closed itself — every task done", priority: "default", tags: "tada" },
    reopened: { group: "recommended", label: "A finished task was brought back", priority: "default", tags: "leftwards_arrow_with_hook" },
    unblocked: { group: "recommended", label: "A blocker cleared and work became startable", priority: "default", tags: "arrow_forward" },
    parked_on_session_end: { group: "recommended", label: "A session ended and parked unfinished work", priority: "default", tags: "pause_button" },

    // writes — the whole stream, so you can see what is available
    create: { group: "writes", label: "A task, epic or ADR is created", priority: "low", tags: "new" },
    update: { group: "writes", label: "Any field on a task changes", priority: "min", tags: "pencil2" },
    edit: { group: "writes", label: "A title or body is corrected", priority: "min", tags: "pencil" },
    settings: { group: "writes", label: "Board preferences change", priority: "min", tags: "gear" },
    goal_set: { group: "writes", label: "A goal is set on the work in flight", priority: "min", tags: "dart" },
    sprint: { group: "writes", label: "A sprint is created, committed to or closed", priority: "min", tags: "calendar" },
    ac_met: { group: "writes", label: "An acceptance criterion is met", priority: "min", tags: "white_check_mark" },
    ac_unmet: { group: "writes", label: "An acceptance criterion is un-ticked", priority: "min", tags: "leftwards_arrow_with_hook" },
    ac_removed: { group: "writes", label: "An acceptance criterion is removed", priority: "min", tags: "wastebasket" },
    moved: { group: "writes", label: "A task is refiled under another epic", priority: "min", tags: "truck" },
    done: { group: "writes", label: "A task is completed", priority: "default", tags: "white_check_mark" },
    assign: { group: "writes", label: "A task is assigned or unassigned", priority: "low", tags: "bust_in_silhouette" },
    labels: { group: "writes", label: "Labels change", priority: "min", tags: "label" },
    type: { group: "writes", label: "The issue type is set", priority: "min", tags: "label" },
    prioritise: { group: "writes", label: "Priority changes", priority: "low", tags: "exclamation" },
    estimate: { group: "writes", label: "An estimate is set", priority: "min", tags: "1234" },
    comment: { group: "writes", label: "A comment is added", priority: "low", tags: "speech_balloon" },
    link: { group: "writes", label: "Two tasks are linked", priority: "min", tags: "link" },
    dep: { group: "writes", label: "A dependency is added", priority: "low", tags: "no_entry" },
    undep: { group: "writes", label: "A dependency is removed", priority: "low", tags: "arrow_forward" },
    subtask: { group: "writes", label: "A task is nested under a parent", priority: "min", tags: "family" },
    rank: { group: "writes", label: "The backlog is reordered", priority: "min", tags: "arrow_up_down" },
    claim: { group: "writes", label: "A task is claimed", priority: "low", tags: "lock" },
    release: { group: "writes", label: "A claim is released", priority: "min", tags: "unlock" },
    worktree_new: { group: "writes", label: "A worktree is created for a task", priority: "low", tags: "deciduous_tree" },
    worktree_rm: { group: "writes", label: "A worktree is removed", priority: "min", tags: "wastebasket" },
    git_link: { group: "writes", label: "A commit or PR is attached to a task", priority: "low", tags: "octopus" },
    // Worth saying out loud rather than swallowing: the alternative — attaching it anyway — is
    // what put 25 marketplace pull requests on a persona task.
    git_link_skipped: {
      group: "writes",
      label: "A commit or PR was not attached — it came from another repo",
      priority: "low",
      tags: "octopus",
    },
    plan_captured: { group: "writes", label: "An approved plan becomes an epic", priority: "default", tags: "clipboard" },
    goal_imported: { group: "writes", label: "A goal doc becomes a task, its success criteria the gate", priority: "default", tags: "dart" },
    decision_captured: { group: "writes", label: "A decision is recorded as an ADR", priority: "low", tags: "memo" },
    decision_updated: { group: "writes", label: "An existing ADR is revised", priority: "min", tags: "memo" },
    epic_active: { group: "writes", label: "The active epic changes", priority: "min", tags: "dart" },
    epic_reopened: { group: "writes", label: "An epic reopened because one of its tasks came back", priority: "low", tags: "leftwards_arrow_with_hook" },
    subagent_stop: { group: "writes", label: "A subagent finishes", priority: "min", tags: "robot" },
    override: { group: "writes", label: "A gate is bypassed with `tm override`", priority: "default", tags: "key" },
    override_used: { group: "writes", label: "An override token was spent by a gate", priority: "default", tags: "key" },

    // noise
    init: { group: "noise", label: "A store is initialized", priority: "min", tags: "package" },
    migrate: { group: "noise", label: "A store is moved", priority: "min", tags: "truck" },
    events_rotated: { group: "noise", label: "The event log rotates", priority: "min", tags: "recycle" },
    notification: { group: "noise", label: "Claude Code asks for attention", priority: "min", tags: "bell" },
    stop_gate_released: { group: "noise", label: "The stop gate lets a session go", priority: "min", tags: "checkered_flag" },
    doctor_fix: { group: "noise", label: "`tm doctor --fix` repaired something", priority: "min", tags: "wrench" },
    doctor_release: { group: "noise", label: "`tm doctor` released a dead claim", priority: "min", tags: "wrench" },
  },
  get recommended() {
    return Object.keys(this.events).filter((k) => this.events[k].group === "recommended");
  },
  get writes() {
    return Object.keys(this.events).filter((k) => this.events[k].group === "writes");
  },
  get noise() {
    return Object.keys(this.events).filter((k) => this.events[k].group === "noise");
  },
};

const DEFAULTS = {
  enabled: false,
  server: "https://ntfy.prod.bytedesk.ai",
  topic: null,
  categories: [],
  minIntervalSeconds: 30,
  boardUrl: null,
};

/** Store config plus environment. The token is environment-only, by design. */
export function ntfyConfig(p = paths(), env = process.env) {
  const stored = config(p).ntfy || {};
  const { token: _ignored, ...safe } = stored; // a token in config.json is ignored, not honoured
  const cfg = {
    ...DEFAULTS,
    ...safe,
    server: env.TM_NTFY_SERVER || safe.server || DEFAULTS.server,
    topic: env.TM_NTFY_TOPIC || safe.topic || DEFAULTS.topic,
    token: env.TM_NTFY_TOKEN || null,
  };
  // "Enabled" without a credential or a topic would fail silently on every send.
  cfg.enabled = Boolean(cfg.enabled && cfg.token && cfg.topic);
  return cfg;
}

export function topicUrl({ server, topic }) {
  return `${String(server).replace(/\/+$/, "")}/${topic}`;
}

export function categoryOf(event) {
  return CATALOG.events[event] || null;
}

/**
 * Decide whether one event earns a push. Returns a reason when it doesn't, so
 * `tm ntfy test` can explain the silence rather than leaving you guessing.
 */
export function shouldPublish(event, cfg, { seen = new Map(), now = Date.now() } = {}) {
  if (!cfg.enabled) return { ok: false, reason: "ntfy is not enabled (needs a topic and TM_NTFY_TOKEN)" };
  const meta = categoryOf(event.event);
  if (!meta) return { ok: false, reason: `"${event.event}" is not a known event kind` };
  if (!cfg.categories.includes(event.event)) return { ok: false, reason: `"${event.event}" is not enabled in this project's categories` };

  const window = (cfg.minIntervalSeconds ?? 0) * 1000;
  if (window) {
    const key = `${event.event}:${event.id || "-"}`;
    const last = seen.get(key);
    if (last && now - last < window) {
      return { ok: false, reason: `rate-limited: ${event.event} for ${event.id} fired ${Math.round((now - last) / 1000)}s ago` };
    }
    seen.set(key, now);
  }
  return { ok: true, meta };
}

/** The ntfy message for an event. `task` may be null — plenty of events have none. */
export function messageFor(event, task, cfg) {
  const meta = categoryOf(event.event) || { label: event.event, priority: "default", tags: "bell" };
  const who = event.actor && event.actor !== "main" ? ` — ${event.actor}` : "";
  const title = [event.id, meta.label].filter(Boolean).join(" · ");
  const body = [task?.title, who && who.replace(/^ — /, "by ")].filter(Boolean).join("\n") || meta.label;

  const msg = {
    title,
    body,
    priority: meta.priority || "default",
    tags: String(meta.tags || "bell").split(",").map((t) => t.trim()).filter(Boolean),
  };
  if (cfg.boardUrl && event.id) msg.click = `${String(cfg.boardUrl).replace(/\/+$/, "")}/?task=${event.id}`;
  return msg;
}

/**
 * HTTP header values are ByteString — anything above U+00FF makes fetch throw
 * before the request leaves the machine, which `send` then reports as a status-0
 * "network error". Our own catalog labels are full of em dashes, so this is the
 * difference between a working notifier and one that is silently dead.
 * The body is untouched: it is sent as UTF-8 and carries the real text.
 */
function headerSafe(value) {
  return String(value)
    .replace(/[\u2014\u2013]/g, "-") // em/en dash — by far the common case here
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2026]/g, "...")
    // Anything still outside latin-1 is dropped rather than risking a throw.
    .replace(/[^\x20-\xFF]/g, "");
}

/** The headers ntfy expects. Kept separate so the publisher stays a few lines. */
export function headersFor(msg, cfg) {
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "text/plain; charset=utf-8",
    Title: headerSafe(msg.title),
    Priority: headerSafe(msg.priority),
    Tags: headerSafe(msg.tags.join(",")),
  };
  if (msg.click) headers.Click = headerSafe(msg.click);
  return headers;
}

/**
 * Send one message. Resolves to a result rather than throwing — callers are
 * hooks and CLI verbs that must not fail because a phone didn't buzz.
 */
export async function send(msg, cfg, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(topicUrl(cfg), {
      method: "POST",
      headers: headersFor(msg, cfg),
      body: msg.body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : await res.text().catch(() => "") };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
