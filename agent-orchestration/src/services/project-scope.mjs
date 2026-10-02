// The one predicate for "this repository enables a bytedesk plugin at project scope". The commit
// guard (scripts/check-no-project-plugin-installs.mjs) and the SessionStart warning both call it,
// so the warning a session sees is exactly what the guard would block on. Node built-ins only.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const DEFAULT_PLUGINS = Object.freeze(["agent-orchestration", "task-management"]);

/** `names` may contain `all` for every @bytedesk plugin. */
export function isGuardedPlugin(id, names = DEFAULT_PLUGINS) {
  return id.endsWith("@bytedesk") && (names.includes("all") || names.includes(id.slice(0, -"@bytedesk".length)));
}

/** `{ file, id }` for each guarded plugin `<repo>/.claude/settings.json` enables. Throws if the file is unreadable. */
export function projectPluginViolations(repoDir, names = DEFAULT_PLUGINS) {
  const file = join(resolve(repoDir), ".claude", "settings.json");
  if (!existsSync(file)) return [];
  const settings = JSON.parse(readFileSync(file, "utf8"));
  return Object.entries(settings.enabledPlugins ?? {}).filter(([id, on]) => isGuardedPlugin(id, names) && on !== false).map(([id]) => ({ file, id }));
}

/** The SessionStart warning, with the exact fix; null when the repository is clean or unreadable. */
export function projectScopeWarning(repoDir) {
  let found;
  try { found = projectPluginViolations(repoDir); } catch { return null; }
  if (!found.length) return null;
  const { file } = found[0];
  return [
    `agent-orchestration: ${file} enables ${found.map((v) => v.id).join(", ")} at project scope.`,
    `Every \`git commit\` in this repository will be blocked until it is removed. Fix: delete ${found.map((v) => `"${v.id}": true`).join(" and ")} from "enabledPlugins" in ${file}`,
    "(keep it in ~/.claude/settings.json, where these plugins are enabled for every project).",
  ].join("\n");
}
