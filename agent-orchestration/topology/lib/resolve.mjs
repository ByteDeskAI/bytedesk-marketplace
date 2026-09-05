// Resolve skill names and role packs to files on disk. Search order: explicit dirs, the consumer
// checkout, the user's home, then the plugin. Nothing is copied or symlinked into the consumer —
// agents are told which SKILL.md files to read.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { absolutize, consumerResourceDirs, exists, isDirectory } from "./util.mjs";

export function skillDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) {
    dirs.push(...consumerResourceDirs(consumer, "skills"));
    dirs.push(join(consumer, ".claude", "skills"));
    dirs.push(join(consumer, ".agents", "skills"));
    dirs.push(join(consumer, "plugin", "skills"));
    dirs.push(join(consumer, "skills"));
  }
  if (home) {
    dirs.push(join(home, ".claude", "skills"));
    dirs.push(join(home, ".agents", "skills"));
    dirs.push(join(home, ".codex", "skills"));
    dirs.push(join(home, ".config", "agent-orchestration", "skills"));
  }
  if (pluginRoot) dirs.push(join(pluginRoot, "skills"));
  return dirs;
}

/** Returns { name, path } with path = the SKILL.md, or { name, path: null, searched } when missing. */
export async function resolveSkill(name, dirs) {
  const direct = absolutize(name);
  if (name.includes("/") || name.includes("\\")) {
    if (await exists(direct)) {
      const path = (await isDirectory(direct)) ? join(direct, "SKILL.md") : direct;
      if (await exists(path)) return { name, path };
    }
  }
  for (const dir of dirs) {
    const candidate = join(dir, name, "SKILL.md");
    if (await exists(candidate)) return { name, path: candidate, dir };
  }
  return { name, path: null, searched: dirs };
}

export function roleDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(...consumerResourceDirs(consumer, "roles"));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", "roles"));
  if (pluginRoot) dirs.push(join(pluginRoot, "roles"));
  return dirs;
}

/** Load a role pack (Markdown). Unknown roles fall back to `worker` with a note. */
export async function loadRole(role, dirs) {
  for (const dir of dirs) {
    const path = join(dir, `${role}.md`);
    if (await exists(path)) return { role, path, text: await readFile(path, "utf8"), fallback: false };
  }
  for (const dir of dirs) {
    const path = join(dir, "worker.md");
    if (await exists(path)) return { role, path, text: await readFile(path, "utf8"), fallback: true };
  }
  return { role, path: null, text: `# Role: ${role}\n\nNo role pack was found; follow the run instructions below.\n`, fallback: true };
}
