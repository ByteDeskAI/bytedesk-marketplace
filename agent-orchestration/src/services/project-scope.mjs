// The one predicate for "this repository makes a per-project install of a bytedesk plugin". The commit
// guard (scripts/check-no-project-plugin-installs.mjs) and the SessionStart warning both call it,
// so the warning a session sees is exactly what the guard would block on. Node built-ins only.
//
// TM-370: ~/.agents/AGENTS.md ("Claude Code plugins from a local marketplace") REQUIRES a repo that uses a
// plugin to register the marketplace in .claude/settings.json by relative path (extraKnownMarketplaces) and
// declare it under enabledPlugins. That declaration is allowed. What is blocked is a per-project install:
//   - an enabled guarded plugin whose marketplace the repo does not register (what
//     `claude plugin install --scope project` writes, and a clone that points at nothing);
//   - the bytedesk marketplace registered by absolute or home-relative path (bakes one machine into a shared repo);
//   - a plugin cache committed into the repo under .claude/plugins/ (machine-local; must be gitignored).
import { safeGitSync } from "../../topology/lib/safe-git.mjs";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const DEFAULT_PLUGINS = Object.freeze(["agent-orchestration", "task-management"]);
export const RULE = '~/.agents/AGENTS.md, "Claude Code plugins from a local marketplace"';

/** `names` may contain `all` for every @bytedesk plugin. */
export function isGuardedPlugin(id, names = DEFAULT_PLUGINS) {
  return id.endsWith("@bytedesk") && (names.includes("all") || names.includes(id.slice(0, -"@bytedesk".length)));
}

/** True when a marketplace source names a machine-specific local path. */
function machinePath(source) {
  if (source?.source !== "directory" && source?.source !== "file") return false;
  const path = String(source.path ?? "");
  return path.startsWith("~") || isAbsolute(path);
}

/**
 * `{ file, id, problem, fix }` for each per-project install in `repoDir`; `id` is the plugin, marketplace
 * or path concerned. Throws if .claude/settings.json is unreadable.
 */
export function projectPluginViolations(repoDir, names = DEFAULT_PLUGINS) {
  const root = resolve(repoDir);
  const file = join(root, ".claude", "settings.json");
  const found = [];
  if (existsSync(file)) {
    const settings = JSON.parse(readFileSync(file, "utf8"));
    const markets = settings.extraKnownMarketplaces ?? {};
    for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) {
      if (!isGuardedPlugin(id, names) || on === false || markets.bytedesk?.source) continue;
      found.push({ file, id, problem: `enables ${id} but does not register the "bytedesk" marketplace`,
        fix: `add "extraKnownMarketplaces": {"bytedesk": {"source": {"source": "directory", "path": "../bytedesk-marketplace"}}} (a path relative to the repository), or delete "${id}": true from "enabledPlugins"` });
    }
    if (machinePath(markets.bytedesk?.source)) {
      found.push({ file, id: "bytedesk", problem: `registers the "bytedesk" marketplace by machine-specific path ${markets.bytedesk.source.path}`,
        fix: 'make "path" relative to the repository, for example "../bytedesk-marketplace"' });
    }
  }
  const tracked = safeGitSync(root, ["ls-files", "--", ".claude/plugins"], { timeout: 5_000 });
  if (tracked.status === 0 && tracked.stdout.trim()) {
    found.push({ file: join(root, ".claude", "plugins"), id: ".claude/plugins", problem: "is a plugin cache committed into the repository",
      fix: "run `git rm -r --cached .claude/plugins` and add `.claude/plugins/` to .gitignore" });
  }
  return found;
}

/** The SessionStart warning, with the exact fix; null when the repository is clean or unreadable. */
export function projectScopeWarning(repoDir) {
  let found;
  try { found = projectPluginViolations(repoDir); } catch { return null; }
  if (!found.length) return null;
  return [
    "agent-orchestration: this repository makes a per-project bytedesk plugin install.",
    "Every `git commit` in this repository will be blocked until it is fixed.",
    ...found.map((v) => `${v.file} ${v.problem}. Fix: ${v.fix}.`),
    `Rule: ${RULE}. Registering the marketplace by relative path and declaring enabledPlugins is allowed.`,
  ].join("\n");
}
