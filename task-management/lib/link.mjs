/**
 * Putting `tm` on PATH. The plugin works without this (hooks call bin/tm by
 * absolute path) — this is purely so a human can type `tm board`.
 *
 * Auto-links on first session when it is safe to do so. Opt out with
 * TM_NO_AUTOLINK=1 or TM_AUTOLINK=0. Default is on.
 *
 * POSIX: symlinks in ~/.local/bin.
 * Windows: .cmd wrappers (and a POSIX shim for Git Bash) in %USERPROFILE%\.local\bin.
 * The bin dir is created if missing. PATH membership is reported, not required.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { paths } from "./paths.mjs";
import { config } from "./store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BIN = {
  tm: join(HERE, "..", "bin", "tm"),
  "tm-dashboard": join(HERE, "..", "bin", "tm-dashboard"),
  // Codex's hooks.json takes a bare command string with no plugin-root substitution, so the hook
  // entrypoint has to be reachable by name or that manifest cannot be written at all.
  "tm-hook": join(HERE, "..", "bin", "tm-hook"),
};

const NAMES = Object.keys(BIN);

export function binDir() {
  return process.env.TM_BIN_DIR || join(homedir(), ".local", "bin");
}

function onPath(dir) {
  const parts = (process.env.PATH || "").split(delimiter);
  const norm = (s) => String(s).replace(/[\\/]+$/, "").toLowerCase();
  const want = norm(dir);
  return parts.some((p) => norm(p) === want);
}

function cmdWrapper(target) {
  return `@echo off\r\nsetlocal\r\nnode "${target}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
}

function posixWrapper(target) {
  return `#!/bin/sh\nexec node "${target}" "$@"\n`;
}

function isOursCmd(file, target) {
  try {
    const text = readFileSync(file, "utf8");
    return text.includes(target);
  } catch {
    return false;
  }
}

function isBrokenLink(p) {
  try {
    lstatSync(p);
    return !existsSync(p);
  } catch {
    return false;
  }
}

/** What is at <dir>/<name> (and <name>.cmd on Windows): ours, someone else's, or nothing. */
export function inspect(name, dir = binDir(), platform = process.platform) {
  const target = BIN[name];
  const posix = join(dir, name);
  const cmd = join(dir, `${name}.cmd`);
  if (platform === "win32") {
    if (existsSync(cmd)) {
      if (isOursCmd(cmd, target)) return { target: cmd, state: "ours", extra: posix };
      return { target: cmd, state: "foreign", extra: posix };
    }
    if (existsSync(posix) || isBrokenLink(posix)) {
      if (isOursCmd(posix, target)) return { target: posix, state: "ours", extra: cmd };
      try {
        if (lstatSync(posix).isSymbolicLink() && readlinkSync(posix) === target) {
          return { target: posix, state: "ours", extra: cmd };
        }
      } catch {
        /* fall through */
      }
      if (isBrokenLink(posix)) return { target: posix, state: "stale", extra: cmd };
      return { target: posix, state: "foreign", extra: cmd };
    }
    return { target: cmd, state: "absent", extra: posix };
  }
  if (!existsSync(posix) && !isBrokenLink(posix)) return { target: posix, state: "absent" };
  try {
    if (lstatSync(posix).isSymbolicLink()) {
      if (readlinkSync(posix) === target) return { target: posix, state: "ours" };
      if (!existsSync(posix)) return { target: posix, state: "stale" };
    }
  } catch {
    /* fall through */
  }
  return { target: posix, state: "foreign" };
}

export function status(dir = binDir(), platform = process.platform) {
  const entries = NAMES.map((name) => ({ name, ...inspect(name, dir, platform) }));
  return {
    dir,
    onPath: onPath(dir),
    dirExists: existsSync(dir),
    platform,
    entries,
    linked: entries.every((e) => e.state === "ours"),
    conflicts: entries.filter((e) => e.state === "foreign"),
  };
}

function placeWin32(name, dir) {
  const target = BIN[name];
  const cmd = join(dir, `${name}.cmd`);
  const sh = join(dir, name);
  writeFileSync(cmd, cmdWrapper(target));
  writeFileSync(sh, posixWrapper(target), { mode: 0o755 });
  return [cmd, sh];
}

function placePosix(name, dir) {
  const dest = join(dir, name);
  try {
    unlinkSync(dest);
  } catch {
    /* absent */
  }
  symlinkSync(BIN[name], dest);
  return [dest];
}

/** Create the links. Creates the bin dir. Refuses to clobber anything that isn't already ours. */
export function link({ force = false, dir = binDir(), platform = process.platform } = {}) {
  mkdirSync(dir, { recursive: true });
  const s = status(dir, platform);
  const done = [];
  for (const entry of s.entries) {
    if (entry.state === "ours") continue;
    if (entry.state === "foreign" && !force) {
      return { ok: false, reason: `${entry.target} exists and is not ours (use --force)`, ...status(dir, platform) };
    }
    for (const p of [entry.target, entry.extra].filter(Boolean)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    const written = platform === "win32" ? placeWin32(entry.name, dir) : placePosix(entry.name, dir);
    done.push(...written);
  }
  return { ok: true, created: done, ...status(dir, platform) };
}

function autolinkDisabled() {
  if (process.env.TM_NO_AUTOLINK) return true;
  const v = String(process.env.TM_AUTOLINK || "").toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

/**
 * Called from the SessionStart hook. Links quietly when safe; otherwise returns
 * a single line of advice. Returns null when there is nothing to say.
 * Default is on. TM_NO_AUTOLINK=1 or TM_AUTOLINK=0 opts out.
 */
export function autolink(opts = {}) {
  if (autolinkDisabled()) return null;
  try {
    const p = opts.p || paths();
    if (p.root && config(p).plugin?.autolink === false) return null;
  } catch {
    /* no store yet — still link */
  }
  const dir = opts.dir || binDir();
  const platform = opts.platform || process.platform;
  const s = status(dir, platform);
  if (s.linked) return null;
  if (s.conflicts.length) {
    return `task-management: something else already owns \`${s.conflicts[0].name}\` in ${s.dir}; not touching it. Link manually or run \`tm install --force\`.`;
  }
  const res = link({ dir, platform });
  if (!res.ok) return `task-management: could not link \`tm\` (${res.reason}). Run tm install.`;
  const pathNote = res.onPath
    ? ""
    : ` Add ${res.dir} to PATH to use the names from a shell.`;
  return res.created.length
    ? `task-management: linked \`tm\` into ${res.dir} (TM_NO_AUTOLINK=1 to skip; \`tm uninstall\` to remove).${pathNote}`
    : null;
}

export function unlink(dir = binDir(), platform = process.platform) {
  const removed = [];
  for (const entry of status(dir, platform).entries) {
    if (entry.state !== "ours") continue;
    for (const p of [entry.target, entry.extra].filter(Boolean)) {
      try {
        unlinkSync(p);
        removed.push(p);
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}
