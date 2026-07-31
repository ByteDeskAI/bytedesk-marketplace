/**
 * Best-effort OKF v0.1 → v0.2 migration.
 * - timestamp → generated.at
 * - body # Citations list → sources[]
 */
import { listConcepts, writeConcept } from "./store.mjs";
import { paths } from "./paths.mjs";
import { pluginActor, now } from "./actor.mjs";

function parseCitations(body) {
  const lines = body.split("\n");
  const sources = [];
  let inCitations = false;
  const kept = [];
  for (const line of lines) {
    if (/^#+\s*Citations\s*$/i.test(line.trim())) {
      inCitations = true;
      continue;
    }
    if (inCitations) {
      if (/^#+\s+/.test(line)) {
        inCitations = false;
        kept.push(line);
        continue;
      }
      const m = /^\s*[-*]\s+(\S.+)\s*$/.exec(line);
      if (m) {
        const raw = m[1].trim();
        const url = raw.replace(/^<|>$/g, "");
        sources.push({ resource: url, title: url });
        continue;
      }
      if (!line.trim()) continue;
      continue;
    }
    kept.push(line);
  }
  return { body: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", sources };
}

export function migrateConcept(concept) {
  const data = { ...concept.data };
  let body = concept.body;
  let changed = false;

  if (data.timestamp && !data.generated) {
    data.generated = { by: pluginActor(), at: data.timestamp };
    delete data.timestamp;
    changed = true;
  } else if (data.timestamp && data.generated) {
    delete data.timestamp;
    changed = true;
  }

  if (/^#+\s*Citations\s*$/im.test(body) && !data.sources) {
    const parsed = parseCitations(body);
    if (parsed.sources.length) {
      data.sources = parsed.sources;
      body = parsed.body;
      changed = true;
    }
  }

  if (!data.generated) {
    data.generated = { by: pluginActor(), at: now() };
    changed = true;
  }

  return { data, body, changed };
}

export function migrateBundle(p = paths()) {
  const results = [];
  for (const c of listConcepts(p)) {
    const { data, body, changed } = migrateConcept(c);
    if (changed) {
      writeConcept(c.id, data, body, p);
      results.push({ id: c.id, migrated: true });
    } else {
      results.push({ id: c.id, migrated: false });
    }
  }
  return results;
}
