// Small shared helpers for the topology layer. Zero dependencies on purpose:
// this code runs from an installed plugin cache with no node_modules.
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
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
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      timeout: options.timeoutMs ?? 30_000,
      windowsHide: true,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure) {
      return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
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

export function absolutize(path, base = process.cwd()) {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
