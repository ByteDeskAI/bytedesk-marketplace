/**
 * Where the knowledge bundle lives.
 *
 * Rules (mirror task-management):
 *   1. KM_ROOT wins.
 *   2. CLAUDE_PROJECT_DIR beats cwd.
 *   3. Canonicalize to main checkout via git --git-common-dir.
 *   4. Never create a store inside an *installed* copy of this plugin.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_VERSION = "0.1.0";

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function canonical(dir) {
  if (!dir || !existsSync(dir)) return null;
  const common = git(dir, ["rev-parse", "--git-common-dir"]);
  if (common) return dirname(real(resolve(dir, common)));
  return real(dir);
}

export function currentCheckout(cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  return git(cwd, ["rev-parse", "--show-toplevel"]) || real(cwd);
}

let installCache;
export function pluginInstallRoot() {
  if (installCache === undefined) {
    const dir = real(join(HERE, ".."));
    installCache = dir.includes(`${sep}.claude${sep}plugins${sep}`) ? dir : null;
  }
  return installCache;
}

function insidePluginInstall(dir) {
  const install = pluginInstallRoot();
  if (!install || !dir) return false;
  const d = real(dir);
  return d === install || d.startsWith(install + sep);
}

export function resolveRoot() {
  if (process.env.KM_ROOT && existsSync(process.env.KM_ROOT)) return process.env.KM_ROOT;
  for (const candidate of [process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
    if (insidePluginInstall(candidate)) continue;
    const root = canonical(candidate);
    if (root && !insidePluginInstall(root)) return root;
  }
  return null;
}

export function paths(root = resolveRoot()) {
  if (!root) {
    return {
      root: null,
      base: null,
      runtime: null,
      unavailable:
        "knowledge-management refuses to create a store inside an installed copy of itself — " +
        "/plugin update would wipe it. Run km from your project, or set KM_ROOT to it.",
    };
  }
  const base = join(root, ".bytedesk", "knowledge");
  const runtime = join(base, ".km");
  return {
    root,
    base,
    runtime,
    indexMd: join(base, "index.md"),
    logMd: join(base, "log.md"),
    events: join(runtime, "events.jsonl"),
    indexJson: join(runtime, "index.json"),
    state: join(runtime, "state.json"),
    config: join(runtime, "config.json"),
    tmBase: join(root, ".bytedesk", "task-management"),
  };
}

export function ensureDirs(p = paths()) {
  if (!p.base) throw new Error(p.unavailable || "no project root");
  for (const d of [
    p.base,
    p.runtime,
    join(p.base, "architecture"),
    join(p.base, "apis"),
    join(p.base, "runbooks"),
    join(p.base, "decisions"),
    join(p.base, "domain"),
    join(p.base, "references"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  return p;
}

export function isInitialized(p = paths()) {
  return !!(p.base && existsSync(p.base) && existsSync(p.indexMd));
}

export const DEFAULT_CONFIG = {
  okfVersion: "0.2",
  injectOnSessionStart: true,
  injectMaxConcepts: 12,
  captureDecisions: "smart",
  softTmLink: true,
  warnStaleOnStop: false,
  defaultType: "Reference",
  recommendedTypes: [
    "Architecture",
    "Decision",
    "API",
    "Module",
    "Runbook",
    "Onboarding",
    "Domain Concept",
    "Playbook",
    "Metric",
    "Reference",
    "Attested Computation",
  ],
};

export const RESERVED = new Set(["index.md", "log.md"]);
