/**
 * The plugin's own skill catalog, read off `skills/<name>/SKILL.md` frontmatter.
 *
 * The board shows what to run; it does not run anything. The name is the directory name and
 * never a request parameter, so nothing outside the plugin's own tree is ever read.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Skill frontmatter, not store frontmatter: the keys are hyphenated (`user-invokable`,
 * `argument-hint`), which `store.parseDoc` — written for the store's own `[A-Za-z0-9_]` keys —
 * silently drops. Values are JSON when they parse and raw text otherwise, the same rule.
 */
function frontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    try {
      data[m[1]] = m[2] === "" ? "" : JSON.parse(m[2]);
    } catch {
      data[m[1]] = m[2];
    }
  }
  return data;
}

export function listSkills(root = PLUGIN_ROOT) {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const data = frontmatter(readFileSync(file, "utf8"));
    const invokable = data["user-invokable"];
    out.push({
      name: String(data.name || name),
      description: String(data.description || "").trim(),
      userInvokable: invokable === true || invokable === "true",
      argumentHint: data["argument-hint"] ? String(data["argument-hint"]) : null,
      command: `/task-management:${data.name || name}`,
    });
  }
  return out;
}
