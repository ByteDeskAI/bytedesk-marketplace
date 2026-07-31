/**
 * Markdown-first OKF store. Concepts are .md files; .km/ is runtime only.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { DEFAULT_CONFIG, RESERVED, ensureDirs, isInitialized, paths } from "./paths.mjs";
import { parseDoc, serializeDoc, slug } from "./yaml-doc.mjs";
import { humanActor, now, pluginActor, sessionId } from "./actor.mjs";

const isEntityFile = (name) => name.endsWith(".md") && !name.startsWith(".");

function writeAtomic(file, text) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.km-tmp-${process.pid}-${basename(file)}`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  writeAtomic(file, JSON.stringify(obj, null, 2) + "\n");
}

export function config(p = paths()) {
  return { ...DEFAULT_CONFIG, ...readJson(p.config, {}) };
}

export function writeConfig(cfg, p = paths()) {
  ensureDirs(p);
  writeJson(p.config, { ...DEFAULT_CONFIG, ...cfg });
}

export function state(p = paths()) {
  return readJson(p.state, {});
}

export function writeState(s, p = paths()) {
  ensureDirs(p);
  writeJson(p.state, s);
}

export function logEvent(kind, payload = {}, p = paths()) {
  if (!p.events) return;
  ensureDirs(p);
  const row = {
    ts: now(),
    kind,
    session: sessionId(),
    ...payload,
  };
  appendFileSync(p.events, JSON.stringify(row) + "\n");
}

export function readEvents(limit = 50, p = paths()) {
  if (!p.events || !existsSync(p.events)) return [];
  return readFileSync(p.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Walk concept .md files under base, excluding .km and reserved names. */
export function listConceptFiles(p = paths()) {
  if (!p.base || !existsSync(p.base)) return [];
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".km") continue;
        walk(full);
      } else if (ent.isFile() && isEntityFile(ent.name)) {
        if (RESERVED.has(ent.name)) continue;
        out.push(full);
      }
    }
  };
  walk(p.base);
  return out.sort();
}

export function conceptIdFromPath(file, p = paths()) {
  const rel = relative(p.base, file).split(sep).join("/");
  return rel.replace(/\.md$/, "");
}

export function pathForConceptId(id, p = paths()) {
  const clean = String(id).replace(/^\/+/, "").replace(/\.md$/, "");
  return join(p.base, ...clean.split("/")) + ".md";
}

export function readConcept(idOrPath, p = paths()) {
  let file = idOrPath;
  if (!existsSync(file)) {
    file = pathForConceptId(idOrPath, p);
  }
  if (!existsSync(file) && String(idOrPath).endsWith(".md")) {
    file = join(p.base, String(idOrPath).replace(/^\/+/, ""));
  }
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const { data, body } = parseDoc(text);
  const id = conceptIdFromPath(file, p);
  return {
    id,
    file,
    path: "/" + id + ".md",
    data,
    body,
    text,
    type: data.type,
    title: data.title || basename(id),
    description: data.description || "",
    tags: data.tags || [],
    status: data.status || "stable",
    resource: data.resource,
  };
}

export function writeConcept(id, data, body, p = paths()) {
  ensureDirs(p);
  const file = pathForConceptId(id, p);
  mkdirSync(dirname(file), { recursive: true });
  const text = serializeDoc(data, body);
  writeAtomic(file, text);
  logEvent("concept_write", { id, type: data.type }, p);
  return readConcept(id, p);
}

export function createConcept(
  {
    type,
    title,
    description = "",
    dir = "",
    resource,
    tags = [],
    body = "",
    extra = {},
  },
  p = paths(),
) {
  ensureDirs(p);
  const t = type || config(p).defaultType || "Reference";
  const s = slug(title);
  const relDir = String(dir || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/");
  let id = relDir ? `${relDir}/${s}` : s;
  let file = pathForConceptId(id, p);
  let n = 2;
  while (existsSync(file)) {
    id = relDir ? `${relDir}/${s}-${n}` : `${s}-${n}`;
    file = pathForConceptId(id, p);
    n++;
  }
  const data = {
    type: t,
    title,
    description: description || title,
    ...(resource ? { resource } : {}),
    ...(tags?.length ? { tags } : {}),
    status: "stable",
    generated: { by: pluginActor(), at: now() },
    ...extra,
  };
  const doc = writeConcept(id, data, body || `# ${title}\n\n${description || ""}\n`, p);
  appendLogMd("Creation", `Established [${title}](/${id}.md).`, p);
  return doc;
}

export function appendLogMd(verb, prose, p = paths()) {
  if (!p.logMd) return;
  ensureDirs(p);
  const day = now().slice(0, 10);
  let existing = existsSync(p.logMd) ? readFileSync(p.logMd, "utf8") : "# Knowledge Update Log\n\n";
  const entry = `* **${verb}**: ${prose}\n`;
  const heading = `## ${day}\n`;
  if (existing.includes(heading)) {
    existing = existing.replace(heading, heading + entry);
  } else {
    // newest first after title
    const parts = existing.split(/\n(?=## )/);
    const head = parts[0].endsWith("\n") ? parts[0] : parts[0] + "\n";
    const rest = parts.slice(1).join("\n");
    existing = `${head}\n${heading}${entry}\n${rest}`.replace(/\n{3,}/g, "\n\n");
  }
  writeAtomic(p.logMd, existing);
}

export function initBundle(p = paths()) {
  ensureDirs(p);
  const cfg = { ...DEFAULT_CONFIG };
  writeJson(p.config, cfg);
  writeJson(p.state, {});
  if (!existsSync(p.events)) writeFileSync(p.events, "");
  const indexBody = `# Knowledge Bundle

* [architecture/](architecture/) - system design concepts
* [apis/](apis/) - API and interface concepts
* [runbooks/](runbooks/) - operational playbooks
* [decisions/](decisions/) - architecture and product decisions
* [domain/](domain/) - domain concepts
* [references/](references/) - mirrored sources and references
`;
  writeAtomic(
    p.indexMd,
    serializeDoc({ okf_version: "0.2", type: "Index", title: "Knowledge Index" }, indexBody).replace(
      /^---\n[\s\S]*?\n---\n\n/,
      "---\nokf_version: \"0.2\"\n---\n\n",
    ),
  );
  // Root index.md MAY carry okf_version only (OKF §8/§12) — keep minimal
  writeAtomic(p.indexMd, `---\nokf_version: "0.2"\n---\n\n${indexBody}`);
  if (!existsSync(p.logMd)) {
    writeAtomic(p.logMd, `# Knowledge Update Log\n\n## ${now().slice(0, 10)}\n* **Initialization**: Created foundational directory structure.\n`);
  }
  writeJson(p.indexJson, { concepts: [], generatedAt: now() });
  logEvent("init", {}, p);
  return p;
}

export function listConcepts(p = paths()) {
  return listConceptFiles(p)
    .map((f) => readConcept(f, p))
    .filter(Boolean);
}

export { now, parseDoc, serializeDoc, slug, isInitialized, writeAtomic };
