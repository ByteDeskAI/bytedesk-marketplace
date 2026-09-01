/**
 * Project-scoped settings catalog. One list the CLI, the dashboard and tests share,
 * so a page cannot invent keys and a gate cannot be renamed in one place only.
 *
 * Identity (boardId, owner) and secrets (ntfy token) are listed as read-only.
 * Everything else here is already `tm config` / config.json — the page is a surface,
 * not a new store.
 */
import { config, writeConfig, logEvent } from "./store.mjs";
import { paths } from "./paths.mjs";
import { ntfyConfig } from "./ntfy.mjs";

export const GROUPS = [
  { id: "dashboard", label: "Dashboard", help: "How the live board behaves on this project." },
  { id: "identity", label: "Identity", help: "Who this board is, derived from git. Not editable here." },
  { id: "policy", label: "Policy", help: "Gates the CLI, hooks and MCP all honour. Project-scoped." },
  { id: "workflow", label: "Workflow", help: "Timing, claims, git linking, decision capture." },
  { id: "ntfy", label: "Phone push (ntfy)", help: "Reach a phone while no browser is open. Token stays in the environment." },
];

export const CATALOG = [
  {
    key: "board.launchBrowser",
    group: "dashboard",
    type: "boolean",
    default: false,
    label: "Launch browser when the board starts",
    help: "Opens the dashboard URL after .bytedesk/task-management/bin/tm-dashboard binds. Override a run with --no-browser or TM_NO_BROWSER=1.",
  },
  {
    key: "board.grouped",
    group: "dashboard",
    type: "boolean",
    default: false,
    label: "Group cards by epic",
    help: "Swimlanes on the board. Same toggle as the header.",
  },
  {
    key: "board.me",
    group: "dashboard",
    type: "string",
    default: null,
    label: "Your name on this board",
    help: "Used to decide which changes are about your work (notifications, assignment).",
  },
  {
    key: "enforce",
    group: "policy",
    type: "boolean",
    default: true,
    label: "Enforce gates",
    help: "WIP, epic-required, and done-needs-acceptance. TM_ENFORCE=off still wins for one process.",
  },
  {
    key: "requireEpic",
    group: "policy",
    type: "boolean",
    default: true,
    label: "Require an active epic to create tasks",
  },
  {
    key: "requireAcceptance",
    group: "policy",
    type: "boolean",
    default: true,
    label: "Require acceptance criteria to mark done",
  },
  {
    key: "wipLimit",
    group: "policy",
    type: "integer",
    default: 3,
    min: 0,
    max: 99,
    label: "WIP limit",
    help: "In-progress cap. 0 means no limit.",
  },
  {
    key: "autoCloseEpics",
    group: "workflow",
    type: "boolean",
    default: true,
    label: "Auto-close epics when every child is done",
  },
  {
    key: "gitLink",
    group: "workflow",
    type: "boolean",
    default: true,
    label: "Attach commits and PRs to the running task",
  },
  {
    key: "parkOnSessionEnd",
    group: "workflow",
    type: "boolean",
    default: true,
    label: "Park in-progress work when a session ends",
  },
  {
    key: "trackTouches",
    group: "workflow",
    type: "boolean",
    default: true,
    label: "Record edited paths on the running task",
  },
  {
    key: "staleMinutes",
    group: "workflow",
    type: "integer",
    default: 90,
    min: 1,
    max: 10_080,
    label: "Stale after (minutes)",
  },
  {
    key: "claimTtlMinutes",
    group: "workflow",
    type: "integer",
    default: 240,
    min: 1,
    max: 10_080,
    label: "Claim TTL (minutes)",
  },
  {
    key: "captureDecisions",
    group: "workflow",
    type: "enum",
    default: "smart",
    options: [
      { value: "smart", label: "Smart — skip yes/no and single-option prompts" },
      { value: true, label: "Always write an ADR" },
      { value: false, label: "Never capture" },
    ],
    label: "Capture AskUserQuestion answers as ADRs",
  },
  {
    key: "eventMaxBytes",
    group: "workflow",
    type: "integer",
    default: 5_000_000,
    min: 100_000,
    max: 500_000_000,
    label: "Rotate the event log past (bytes)",
    help: "events.jsonl rolls to events.1.jsonl when it grows past this. One generation is kept.",
  },
  {
    key: "branchPrefix",
    group: "workflow",
    type: "string",
    default: "tm/",
    label: "Worktree branch prefix",
    help: "tm worktree new names its branch <prefix><id>-<slug>; commit linking infers the task from it.",
  },
  {
    key: "worktreeDir",
    group: "workflow",
    type: "string",
    default: ".bytedesk/worktrees",
    label: "Where worktrees live",
    help: "Relative to the repository root. Ignored via .bytedesk/.gitignore.",
  },
  {
    key: "worktreeShare",
    group: "workflow",
    type: "json",
    default: null,
    label: "What a new worktree shares from the main checkout",
    help: "[{path, mode}] with mode symlink|copy|hardlink. Empty means the default: node_modules symlinked, .env copied.",
  },
  {
    key: "ntfy.enabled",
    group: "ntfy",
    type: "boolean",
    default: false,
    label: "Enable ntfy",
    help: "Still inactive until TM_NTFY_TOKEN is set in the environment and a topic is configured.",
  },
  {
    key: "ntfy.server",
    group: "ntfy",
    type: "string",
    default: "https://ntfy.prod.bytedesk.ai",
    label: "ntfy server",
  },
  {
    key: "ntfy.topic",
    group: "ntfy",
    type: "string",
    default: null,
    label: "ntfy topic",
  },
  {
    key: "ntfy.minIntervalSeconds",
    group: "ntfy",
    type: "integer",
    default: 30,
    min: 0,
    max: 3600,
    label: "Minimum interval between identical pushes (seconds)",
  },
  {
    key: "ntfy.boardUrl",
    group: "ntfy",
    type: "string",
    default: null,
    label: "Board URL in push actions",
  },
  {
    key: "boardId",
    group: "identity",
    type: "string",
    readOnly: true,
    label: "Board id",
    help: "Derived from the git origin. Not writable.",
  },
  {
    key: "owner",
    group: "identity",
    type: "string",
    readOnly: true,
    label: "Owner",
    help: "Derived from git user. Not writable.",
  },
];

const BY_KEY = new Map(CATALOG.map((f) => [f.key, f]));
const LEGACY_BOARD = {
  grouped: "board.grouped",
  me: "board.me",
  categories: "board.categories",
  watching: "board.watching",
  views: "board.views",
  launchBrowser: "board.launchBrowser",
};
/** Board keys the PWA already writes that are not on the policy page. */
const PASSTHROUGH = new Set(["board.categories", "board.watching", "board.views"]);

function getPath(obj, key) {
  return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

function setPath(obj, key, value) {
  const parts = key.split(".");
  const next = { ...obj };
  let cur = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    cur[p] = { ...(cur[p] && typeof cur[p] === "object" ? cur[p] : {}) };
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
  return next;
}

function coerce(field, raw) {
  if (raw === undefined) return { error: "missing" };
  if (raw === null && (field.type === "string" || field.default === null)) return { value: null };
  if (field.type === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    if (raw === "true" || raw === "1") return { value: true };
    if (raw === "false" || raw === "0") return { value: false };
    return { error: `${field.key} must be a boolean` };
  }
  if (field.type === "integer") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n)) return { error: `${field.key} must be an integer` };
    if (field.min != null && n < field.min) return { error: `${field.key} must be ≥ ${field.min}` };
    if (field.max != null && n > field.max) return { error: `${field.key} must be ≤ ${field.max}` };
    return { value: n };
  }
  if (field.type === "json") {
    // Arrays and objects only — a scalar here is a typo, not a structure.
    if (typeof raw === "string") {
      try {
        return coerce(field, JSON.parse(raw));
      } catch {
        return { error: `${field.key} must be valid JSON` };
      }
    }
    if (raw === null || typeof raw === "object") return { value: raw };
    return { error: `${field.key} must be a JSON array or object` };
  }
  if (field.type === "enum") {
    const ok = field.options.some((o) => Object.is(o.value, raw) || String(o.value) === String(raw));
    if (!ok) return { error: `${field.key} must be one of: ${field.options.map((o) => String(o.value)).join(", ")}` };
    const hit = field.options.find((o) => Object.is(o.value, raw) || String(o.value) === String(raw));
    return { value: hit.value };
  }
  if (field.type === "string") {
    if (typeof raw !== "string" && raw !== null) return { error: `${field.key} must be a string` };
    const s = raw == null ? null : String(raw).trim() || null;
    return { value: s };
  }
  return { error: `${field.key} has unknown type` };
}

export function settingsSnapshot(p = paths()) {
  const cfg = config(p);
  const ntfy = ntfyConfig(p);
  const fields = CATALOG.map((f) => {
    let value = getPath(cfg, f.key);
    if (value === undefined) value = f.default ?? null;
    return { ...f, value };
  });
  return {
    groups: GROUPS,
    fields,
    ntfy: { token: ntfy.token ? "set" : null, active: ntfy.enabled },
  };
}

/** Expand a POST body: legacy board keys and dotted catalog keys. */
export function normalizePatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (LEGACY_BOARD[k]) out[LEGACY_BOARD[k]] = v;
    else out[k] = v;
  }
  return out;
}

export function applySettings(patch, p = paths()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw Object.assign(new Error("settings must be an object"), { status: 400 });
  }
  const flat = normalizePatch(patch);
  const known = {};
  const ignored = [];
  const errors = [];
  for (const [key, raw] of Object.entries(flat)) {
    const field = BY_KEY.get(key);
    if (!field) {
      if (PASSTHROUGH.has(key)) {
        known[key] = raw;
        continue;
      }
      ignored.push(key);
      continue;
    }
    if (field.readOnly) {
      errors.push(`${key} is read-only`);
      continue;
    }
    const got = coerce(field, raw);
    if (got.error) errors.push(got.error);
    else known[key] = got.value;
  }
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { status: 400 });
  if (!Object.keys(known).length) {
    throw Object.assign(
      new Error(`no writable setting in: ${Object.keys(flat).join(", ") || "(empty)"}`),
      { status: 400 },
    );
  }
  let next = config(p);
  for (const [key, value] of Object.entries(known)) next = setPath(next, key, value);
  writeConfig(next, p);
  logEvent("settings", { keys: Object.keys(known).join(",") }, p);
  return { ok: true, values: known, ignored: ignored.length ? ignored : undefined, settings: settingsSnapshot(p) };
}

export function launchBrowserEnabled(p = paths(), env = process.env, argv = process.argv) {
  if (env.TM_NO_BROWSER || env.CI) return false;
  if (argv.includes("--no-browser")) return false;
  if (argv.includes("--browser")) return true;
  return config(p).board?.launchBrowser === true;
}
