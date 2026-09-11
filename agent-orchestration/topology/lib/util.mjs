// Small shared helpers for the topology layer. Zero dependencies on purpose:
// this code runs from an installed plugin cache with no node_modules.
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class TopologyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TopologyError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new TopologyError(code, message, details);
}

export function invariant(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

/** Run a command with argv (never a shell string). */
export async function run(command, args, options = {}) {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (timeoutMs > 0 && performance.now() - started >= timeoutMs) {
      const error = Object.assign(new Error(`Command exceeded ${timeoutMs}ms deadline`), {code:124, killed:true, stdout:result.stdout, stderr:result.stderr});
      throw error;
    }
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure) {
      return { code: error.killed ? 124 : (error.code || 1), stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
    }
    throw error;
  }
}

/** Parse `--flag value`, `--flag=value`, `--bool`, and positionals. Repeated flags become arrays. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = true;
    }
    if (key in flags) {
      flags[key] = [].concat(flags[key], value);
    } else {
      flags[key] = value;
    }
  }
  return { flags, positional };
}

/** Render `{{name}}` placeholders. Unknown placeholders are left in place so they are visible. */
export function render(template, vars) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name) => {
    const value = lookup(vars, name);
    return value === undefined || value === null ? match : String(value);
  });
}

function lookup(vars, path) {
  let current = vars;
  for (const part of path.split(".")) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/** Recursively render every string in a JSON value. */
export function renderDeep(value, vars) {
  if (typeof value === "string") return render(value, vars);
  if (Array.isArray(value)) return value.map((item) => renderDeep(item, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderDeep(item, vars)]));
  }
  return value;
}

export function expandHome(path) {
  if (typeof path !== "string") return path;
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function absolutize(path, base) {
  // resolve() also normalizes separators, so a template like "{{consumer}}/.orchestration/runs"
  // does not leave mixed / and \\ in a Windows run directory.
  //
  // `base` is resolved LAZILY and only on the relative branch. It used to be a default parameter
  // (`base = process.cwd()`), and a default parameter is evaluated on every call where the argument
  // is undefined — including every call with an already-absolute path that never reads it. That is
  // not free: process.cwd() throws `ENOENT: uv_cwd` inside a process whose working directory has
  // been unlinked, so a long-lived daemon started in a directory that later goes away (tm removing
  // a task-owned worktree after a verified merge is the routine case) died on startup while
  // resolving a path it had already been given in absolute form. An absolute path must never need
  // a cwd to exist. TM-139.
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base ?? process.cwd(), expanded);
}

export async function readJson(path) {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("TOPOLOGY_INVALID_JSON", `${path} is not valid JSON: ${error.message}`, { path });
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync(); await handle.close(); handle = null;
    await rename(temp, path);
  } finally { await handle?.close(); await rm(temp, { force:true }); }
}

export async function writeText(path, text, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { encoding: "utf8", mode });
}

export async function exists(path) {
  return stat(path).then(() => true, () => false);
}

export async function isDirectory(path) {
  return stat(path).then((info) => info.isDirectory(), () => false);
}

export function newRunId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

/** "20m", "90s", "1h", or a bare number of seconds → milliseconds. */
export function parseDuration(value, fallbackMs) {
  if (value === undefined || value === null || value === "" || value === true) return fallbackMs;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  invariant(match, "TOPOLOGY_INVALID_DURATION", `Cannot parse duration "${value}". Use forms like 90s, 20m, 1h.`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return Math.round(amount * factor);
}

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Quote one argv element for a POSIX shell script. */
export function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Text that cannot carry a terminal escape: C0 controls, DEL and C1 controls removed, then capped
 * at `max` code points (never mid-surrogate). For anything user-controlled — an agent name, a role
 * typed at `agent new --role` — that ends up in a terminal title or a printed row (TM-168).
 */
export function terminalText(value, max = Infinity) {
  return Array.from(String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "")).slice(0, max).join("");
}

export function nowIso() {
  return new Date().toISOString();
}

export function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "run";
}

/**
 * Per-repo resource directories for a resource kind, newest convention first.
 * `.bytedesk/agent-orchestration/<kind>` is the current layout; `.orchestration/<kind>` is read as
 * a fallback so a repo laid out under the old convention keeps working. Writes always use the
 * first entry.
 */
export const AO_HOME = join(".bytedesk", "agent-orchestration");
export const AO_HOME_LEGACY = ".orchestration";

export function consumerResourceDirs(consumer, kind) {
  if (!consumer) return [];
  return [join(consumer, AO_HOME, kind), join(consumer, AO_HOME_LEGACY, kind)];
}

/**
 * Is `candidate` inside `root`? Used to keep a spec from launching an agent outside the repo that
 * invoked it. A spec is data — often committed data — so a path it supplies is untrusted input.
 */
export function isInside(root, candidate) {
  if (!root || !candidate) return false;
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Keep run artifacts out of the consumer's history. Runs live under a `.bytedesk/` tree that repos
 * in this ecosystem deliberately commit (task-management's store is tracked), so without this every
 * mailbox file, journal and launcher script lands in a diff. A self-ignoring runs dir is the fix
 * that needs no edit to the consumer's own .gitignore — and so cannot be forgotten in a repo that
 * adopts orchestration later.
 */
export async function ensureRunsIgnored(runDir) {
  const runsRoot = dirname(resolve(runDir));
  const marker = join(runsRoot, ".gitignore");
  if (await exists(marker)) return marker;
  await writeText(marker, "# Orchestration run artifacts: local, not history.\n*\n");
  return marker;
}
