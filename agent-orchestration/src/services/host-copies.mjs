// TM-284: every agent host on this machine (Claude, Codex, Grok, Kimi) runs its own copy of this
// plugin, and every copy talks to the same managed services and state. Mixed builds disagree on
// session names and identity, so `services ensure` and install-host bring OLDER copies up to the
// build the services pointer runs. Node built-ins only: install-host imports this unbundled.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const NAME = "agent-orchestration";
// The same excludes as plugin-rsync, minus build caches this plugin never has.
const EXCLUDED = new Set(["node_modules", ".git"]);

const readJsonSync = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const real = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
const looksLikeCopy = (dir) => existsSync(join(dir, "package.json")) && existsSync(join(dir, "dist"));

/** Numeric x.y.z comparison; a missing or unparsable version sorts lowest. */
export function compareVersions(a, b) {
  const parts = (v) => (/^\d+\.\d+\.\d+/.exec(String(v ?? "")) ? String(v).split(/[.-]/).slice(0, 3).map(Number) : [-1, -1, -1]);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * What build a copy on disk holds: package.json's version, and the source fingerprint the bundle
 * inlines (`false ? null : "<sha256>"`). Reading the bundle is the slow half, so it is lazy.
 */
export function copyIdentity(root) {
  const version = readJsonSync(join(root, "package.json"))?.version ?? null;
  return {
    version,
    get fingerprint() {
      try { return /false \? null : "([0-9a-f]{64})"/.exec(readFileSync(join(root, "dist", "cli.cjs"), "utf8"))?.[1] ?? null; } catch { return null; }
    },
  };
}

/**
 * Installed copies for the other hosts. Codex and Grok keep a copy each (the paths plugin-rsync
 * refreshes); Kimi keeps none and runs whatever root ~/.kimi-code/mcp.json names.
 */
export function hostCopies({ home, env = {} }) {
  const found = [];
  const add = (host, dir) => { if (dir && isDir(dir) && looksLikeCopy(dir) && !found.some((c) => c.real === real(dir))) found.push({ host, root: resolve(dir), real: real(dir) }); };
  const codex = join(env.CODEX_HOME || join(home, ".codex"), "plugins", "cache", "bytedesk", NAME);
  if (looksLikeCopy(codex)) add("codex", codex);
  else if (isDir(codex)) for (const entry of readdirSync(codex)) if (!entry.startsWith(".")) add("codex", join(codex, entry));
  const registry = readJsonSync(join(home, ".grok", "installed-plugins", "registry.json"));
  for (const entry of Object.values(registry?.repos ?? {})) {
    const meta = entry?.plugins?.[NAME];
    if (!entry?.path || !meta) continue;
    add("grok", meta.subdir ? join(entry.path, meta.subdir) : entry.path);
  }
  const kimi = readJsonSync(join(env.KIMI_CODE_HOME || join(home, ".kimi-code"), "mcp.json"))?.mcpServers?.[NAME]?.command;
  if (typeof kimi === "string" && /[\\/]bin[\\/]agent-orchestration-mcp$/.test(kimi)) add("kimi", dirname(dirname(kimi)));
  return found;
}

/** The top of the git checkout holding `dir`, or null. */
function gitTop(dir, git) {
  const result = git(["-C", dir, "rev-parse", "--show-toplevel"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Uncommitted (or untracked) paths under `dir`; null when `dir` is not in a git checkout. */
export function uncommitted(dir, git = defaultGit) {
  if (!gitTop(dir, git)) return null;
  const result = git(["-C", dir, "status", "--porcelain", "--", "."]);
  if (result.status !== 0) return ["(git status failed)"];
  return result.stdout.split("\n").filter(Boolean);
}

function defaultGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return { status: result.error ? 1 : result.status, stdout: result.stdout ?? "" };
}

// ponytail: the range forms this package.json uses (exact, ^, ~, >=); anything fancier only has
// to be present. Swap in a semver parser if a dependency ever needs `||` or hyphen ranges.
export function satisfies(range, version) {
  if (!version) return false;
  const m = /^(\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)/.exec(String(range).trim());
  if (!m) return true;
  const [, op = "", ...want] = m;
  const [a, b, c] = want.map(Number);
  const have = String(version).split(/[.-]/).slice(0, 3).map(Number);
  const cmp = compareVersions(version, `${a}.${b}.${c}`);
  if (op === "") return cmp === 0;
  if (op === ">=") return cmp >= 0;
  if (cmp < 0) return false;
  if (op === "~") return have[0] === a && have[1] === b;
  // ^: the left-most non-zero part is fixed.
  if (a > 0) return have[0] === a;
  if (b > 0) return have[0] === 0 && have[1] === b;
  return have[0] === 0 && have[1] === 0 && have[2] === c;
}

/** Dependencies of `pkg` the copy's node_modules does not satisfy. */
export function missingDependencies(pkg, root) {
  const missing = [];
  for (const [name, range] of Object.entries(pkg?.dependencies ?? {})) {
    const installed = readJsonSync(join(root, "node_modules", ...name.split("/"), "package.json"))?.version ?? null;
    if (!satisfies(range, installed)) missing.push(`${name}@${range} (have ${installed ?? "none"})`);
  }
  return missing;
}

/**
 * Replace `dest` with a copy of `source`, keeping dest's node_modules. Built beside dest and swapped
 * in by rename, so a failure at any step leaves the old copy as it was. Node's cp, not rsync:
 * native Windows has no rsync, and a fresh tree is `--delete` by construction.
 */
export async function replaceCopy(source, dest) {
  const staging = await mkdtemp(join(dirname(dest), `.${basename(dest)}.ao-refresh-`));
  const retired = `${staging}-old`;
  let moved = false, swapped = false;
  try {
    await cp(source, staging, { recursive: true, force: true, verbatimSymlinks: true, filter: (path) => path === source || !EXCLUDED.has(basename(path)) });
    await rename(dest, retired);
    swapped = true;
    if (existsSync(join(retired, "node_modules"))) { await rename(join(retired, "node_modules"), join(staging, "node_modules")); moved = true; }
    await rename(staging, dest);
  } catch (error) {
    // Put everything back where it was before reporting.
    if (moved) await rename(join(staging, "node_modules"), join(retired, "node_modules")).catch(() => {});
    if (swapped && !existsSync(dest)) await rename(retired, dest).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await rm(retired, { recursive: true, force: true }).catch(() => {});
}

/**
 * Bring every older host copy up to `pointer` (the services' plugin root and its identity). An
 * equal or newer copy is left alone; so is any copy when the source has uncommitted changes, a
 * destination inside a git checkout (someone's working tree), and a copy whose node_modules would
 * not satisfy the new package.json. Returns one row per copy so ensure can log what it did.
 */
export async function refreshHostCopies({ pointer, home, env = {}, copies = hostCopies({ home, env }), git = defaultGit, replace = replaceCopy, dryRun = false }) {
  const report = { source: pointer?.pluginRoot ?? null, version: pointer?.version ?? null, refreshed: [], current: [], skipped: [], failed: [] };
  if (!pointer?.pluginRoot || !isDir(pointer.pluginRoot)) return { ...report, skipped: copies.map((c) => ({ ...row(c), reason: "the services pointer names no plugin root" })) };
  const source = real(pointer.pluginRoot);
  let dirty;
  for (const copy of copies) {
    const id = copyIdentity(copy.root);
    const base = { ...row(copy), version: id.version };
    if (copy.real === source) { report.current.push({ ...base, reason: "is the services plugin root" }); continue; }
    const order = compareVersions(id.version, pointer.version);
    if (order > 0) { report.current.push({ ...base, reason: `newer than the services (${pointer.version})` }); continue; }
    if (order === 0) { report.current.push({ ...base, reason: pointer.fingerprint && id.fingerprint && id.fingerprint !== pointer.fingerprint ? "same version, different build" : "same build" }); continue; }
    if (gitTop(copy.root, git)) { report.skipped.push({ ...base, reason: `${copy.root} is inside a git checkout; update it with git` }); continue; }
    dirty ??= uncommitted(pointer.pluginRoot, git) ?? [];
    if (dirty.length) { report.skipped.push({ ...base, reason: `source ${pointer.pluginRoot} has ${dirty.length} uncommitted change(s); refusing to copy a working tree` }); continue; }
    const missing = missingDependencies(readJsonSync(join(pointer.pluginRoot, "package.json")), copy.root);
    if (missing.length) { report.failed.push({ ...base, reason: `node_modules does not satisfy the new package.json: ${missing.join(", ")}; run npm ci in ${copy.root}`, missing }); continue; }
    if (dryRun) { report.refreshed.push({ ...base, from: id.version, version: pointer.version, dryRun: true }); continue; }
    try {
      await replace(pointer.pluginRoot, copy.root);
      report.refreshed.push({ ...base, from: id.version, version: copyIdentity(copy.root).version });
    } catch (error) {
      report.failed.push({ ...base, reason: `copy failed, left as it was: ${error.message}` });
    }
  }
  return report;
}

const row = (copy) => ({ host: copy.host, root: copy.root });
