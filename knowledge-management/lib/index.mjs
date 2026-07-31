/**
 * Derived .km/index.json + regenerate root index.md sections.
 */
import { existsSync, readFileSync } from "node:fs";
import { listConcepts, now, writeAtomic, writeJson } from "./store.mjs";
import { paths } from "./paths.mjs";
import { isStale, trustTier } from "./validate.mjs";

export function buildIndex(p = paths()) {
  const concepts = listConcepts(p).map((c) => ({
    id: c.id,
    path: c.path,
    type: c.type,
    title: c.title,
    description: c.description,
    tags: c.tags,
    status: c.status,
    trust: trustTier(c.data),
    stale: isStale(c.data),
    resource: c.resource,
  }));
  const payload = { generatedAt: now(), concepts };
  writeJson(p.indexJson, payload);
  return payload;
}

export function regenerateIndexMd(p = paths()) {
  const concepts = listConcepts(p);
  const byDir = new Map();
  for (const c of concepts) {
    const dir = c.id.includes("/") ? c.id.split("/").slice(0, -1).join("/") : "(root)";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(c);
  }
  let body = `# Knowledge Bundle\n\n`;
  const dirs = [...byDir.keys()].sort();
  for (const dir of dirs) {
    body += `## ${dir}\n\n`;
    for (const c of byDir.get(dir).sort((a, b) => a.title.localeCompare(b.title))) {
      const desc = c.description ? ` - ${c.description}` : "";
      body += `* [${c.title}](${c.path})${desc}\n`;
    }
    body += "\n";
  }
  if (!concepts.length) {
    body += `*Empty — add concepts with \`km concept new\`.*\n`;
  }
  writeAtomic(p.indexMd, `---\nokf_version: "0.2"\n---\n\n${body}`);
  return body;
}

export function reindex(p = paths()) {
  const idx = buildIndex(p);
  regenerateIndexMd(p);
  return idx;
}

export function loadIndexSync(p = paths()) {
  if (p.indexJson && existsSync(p.indexJson)) {
    try {
      return JSON.parse(readFileSync(p.indexJson, "utf8"));
    } catch {
      /* fall through */
    }
  }
  return buildIndex(p);
}
