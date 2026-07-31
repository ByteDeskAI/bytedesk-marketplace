/**
 * Put `km` on PATH (same pattern as task-management).
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BIN = {
  km: join(HERE, "..", "bin", "km"),
  "km-mcp": join(HERE, "..", "bin", "km-mcp"),
};

export function binDir() {
  return process.env.KM_BIN_DIR || join(homedir(), ".local", "bin");
}

function onPath(dir) {
  return (process.env.PATH || "").split(delimiter).includes(dir);
}

function isBrokenLink(p) {
  try {
    lstatSync(p);
    return !existsSync(p);
  } catch {
    return false;
  }
}

function inspect(name, dir = binDir()) {
  const target = join(dir, name);
  if (!existsSync(target) && !isBrokenLink(target)) return { target, state: "absent" };
  try {
    if (lstatSync(target).isSymbolicLink()) {
      if (readlinkSync(target) === BIN[name]) return { target, state: "ours" };
      if (!existsSync(target)) return { target, state: "stale" };
    }
  } catch {
    /* fall through */
  }
  return { target, state: "foreign" };
}

export function status(dir = binDir()) {
  const entries = Object.keys(BIN).map((name) => ({ name, ...inspect(name, dir) }));
  return {
    dir,
    onPath: onPath(dir),
    dirExists: existsSync(dir),
    entries,
    linked: entries.every((e) => e.state === "ours"),
    conflicts: entries.filter((e) => e.state === "foreign"),
  };
}

export function link({ force = false, dir = binDir() } = {}) {
  const s = status(dir);
  if (!s.dirExists) return { ok: false, reason: `${dir} does not exist`, ...s };
  const done = [];
  for (const entry of s.entries) {
    if (entry.state === "ours") continue;
    if (entry.state === "foreign" && !force) {
      return { ok: false, reason: `${entry.target} exists and is not ours (use --force)`, ...s };
    }
    if (entry.state !== "absent" || isBrokenLink(entry.target)) {
      try {
        unlinkSync(entry.target);
      } catch {
        /* ignore */
      }
    }
    symlinkSync(BIN[entry.name], entry.target);
    done.push(entry.target);
  }
  return { ok: true, created: done, ...status(dir) };
}

export function unlink(dir = binDir()) {
  const removed = [];
  for (const name of Object.keys(BIN)) {
    const { target, state } = inspect(name, dir);
    if (state === "ours" || state === "stale") {
      try {
        unlinkSync(target);
        removed.push(target);
      } catch {
        /* ignore */
      }
    }
  }
  return { ok: true, removed };
}

export function autolink() {
  if (process.env.KM_NO_AUTOLINK) return null;
  const s = status();
  if (s.linked) return null;
  if (!s.dirExists || !s.onPath) {
    return `km: link with \`km install\` when ${binDir()} is on PATH`;
  }
  if (s.conflicts.length) {
    return `km: ${s.conflicts[0].target} is not ours (km install --force to take it)`;
  }
  const r = link();
  if (r.ok && r.created?.length) return `km: linked ${r.created.join(", ")}`;
  return null;
}
