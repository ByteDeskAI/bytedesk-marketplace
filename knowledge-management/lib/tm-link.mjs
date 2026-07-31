/**
 * Soft links between knowledge concepts and task-management entities.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.mjs";
import { listConcepts, readConcept, writeConcept } from "./store.mjs";

function listTmFiles(tmBase) {
  const out = [];
  if (!existsSync(tmBase)) return out;
  for (const sub of ["tasks", "epics", "adrs"]) {
    const dir = join(tmBase, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".md") && !name.startsWith(".")) out.push(join(dir, name));
    }
  }
  return out;
}

function parseTmFrontmatter(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text };
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    try {
      data[key] = raw === "" ? "" : JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return { data, body: text.slice(end + 4).replace(/^\n/, "") };
}

function serializeTm(data, body) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function linkTaskToConcept(taskId, conceptPath, p = paths()) {
  const conceptId = String(conceptPath).replace(/^\/+/, "").replace(/\.md$/, "");
  const concept = readConcept(conceptId, p);
  if (!concept) throw new Error(`concept not found: ${conceptId}`);

  const tasks = new Set([...(concept.data.tasks || []), taskId]);
  writeConcept(concept.id, { ...concept.data, tasks: [...tasks] }, concept.body, p);

  if (p.tmBase && existsSync(p.tmBase)) {
    for (const file of listTmFiles(p.tmBase)) {
      const text = readFileSync(file, "utf8");
      const { data, body } = parseTmFrontmatter(text);
      if (data.id === taskId || file.includes(taskId)) {
        const knowledge = new Set([...(data.knowledge || []), concept.path || `/${conceptId}.md`]);
        data.knowledge = [...knowledge];
        writeFileSync(file, serializeTm(data, body));
        return { concept: concept.id, task: taskId, tmFile: file };
      }
    }
  }
  return { concept: concept.id, task: taskId, tmFile: null };
}

export function listConceptTaskLinks(p = paths()) {
  const links = [];
  for (const c of listConcepts(p)) {
    for (const t of c.data.tasks || []) {
      links.push({ concept: c.id, task: t });
    }
  }
  return links;
}
