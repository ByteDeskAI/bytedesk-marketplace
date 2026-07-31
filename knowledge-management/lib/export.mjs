/**
 * Export the knowledge board as md/json.
 */
import { listConcepts, readEvents } from "./store.mjs";
import { trustTier } from "./validate.mjs";
import { paths } from "./paths.mjs";
import { writeFileSync } from "node:fs";

export function exportStore(format = "md", p = paths()) {
  const concepts = listConcepts(p);
  if (format === "json") {
    return JSON.stringify(
      {
        concepts: concepts.map((c) => ({
          id: c.id,
          type: c.type,
          title: c.title,
          description: c.description,
          tags: c.tags,
          status: c.status,
          trust: trustTier(c.data),
          data: c.data,
          body: c.body,
        })),
        events: readEvents(100, p),
      },
      null,
      2,
    );
  }
  // md
  let out = `# Knowledge export\n\n`;
  for (const c of concepts) {
    out += `## ${c.title}\n\n`;
    out += `- id: \`${c.id}\`\n- type: ${c.type}\n- trust: ${trustTier(c.data)}\n`;
    if (c.description) out += `- ${c.description}\n`;
    out += `\n${c.body}\n\n---\n\n`;
  }
  return out;
}

export function exportToFile(format, outPath, p = paths()) {
  const text = exportStore(format, p);
  writeFileSync(outPath, text);
  return outPath;
}
