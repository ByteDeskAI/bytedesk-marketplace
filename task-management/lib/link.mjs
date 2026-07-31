/**
 * Putting `tm` on PATH. The plugin works without this (hooks call bin/tm by
 * absolute path) — this is purely so a human can type `tm board`.
 *
 * Auto-links on first session when it is safe to do so: the target dir exists,
 * and nothing else already owns the name. Anything ambiguous degrades to a
 * one-line suggestion instead of a surprise write to someone's PATH.
 * Opt out entirely with TM_NO_AUTOLINK=1.
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BIN = {
  tm: join(HERE, "..", "bin", "tm"),
  "tm-dashboard": join(HERE, "..", "bin", "tm-dashboard"),
  // Codex's hooks.json takes a bare command string with no plugin-root substitution, so the hook
  // entrypoint has to be reachable by name or that manifest cannot be written at all.
  "tm-hook": join(HERE, "..", "bin", "tm-hook"),
};

export function binDir() {
  return process.env.TM_BIN_DIR || join(homedir(), ".local", "bin");
}

function onPath(dir) {
  return (process.env.PATH || "").split(delimiter).includes(dir);
}

/** What is at <binDir>/<name>: ours, someone else's, or nothing. */
function inspect(name, dir = binDir()) {
  const target = join(dir, name);
  if (!existsSync(target) && !isBrokenLink(target)) return { target, state: "absent" };
  try {
    if (lstatSync(target).isSymbolicLink()) {
      if (readlinkSync(target) === BIN[name]) return { target, state: "ours" };
      // A dangling symlink (moved checkout, deleted tool) owns the name but
      // nothing works through it — safe to replace without --force.
      if (!existsSync(target)) return { target, state: "stale" };
    }
  } catch {
    /* fall through */
  }
  return { target, state: "foreign" };
}

function isBrokenLink(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
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

/** Create the symlinks. Refuses to clobber anything that isn't already ours. */
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
      // clears stale/foreign links and any leftover dangling entry
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

/**
 * Called from the SessionStart hook. Links quietly when safe; otherwise returns
 * a single line of advice. Returns null when there is nothing to say.
 */
export function autolink() {
  if (process.env.TM_NO_AUTOLINK) return null;
  const s = status();
  if (s.linked) return null;

  if (!s.dirExists || !s.onPath) {
    return `task-management: \`tm\` is not on PATH. Add it with: ln -s ${BIN.tm} <a dir on your PATH>/tm`;
  }
  if (s.conflicts.length) {
    return `task-management: something else already owns \`${s.conflicts[0].name}\` in ${s.dir}; not touching it. Link manually or run \`${BIN.tm} install --force\`.`;
  }
  const res = link();
  if (!res.ok) return `task-management: could not link \`tm\` (${res.reason}). Run ${BIN.tm} install.`;
  return res.created.length
    ? `task-management: linked \`tm\` and \`tm-dashboard\` into ${s.dir} (TM_NO_AUTOLINK=1 to skip; \`tm uninstall\` to remove).`
    : null;
}

export function unlink(dir = binDir()) {
  const removed = [];
  for (const entry of status(dir).entries) {
    if (entry.state !== "ours") continue;
    unlinkSync(entry.target);
    removed.push(entry.target);
  }
  return removed;
}
