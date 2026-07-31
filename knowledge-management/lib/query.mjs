/**
 * Concept search: words + field:value filters.
 */
import { listConcepts } from "./store.mjs";
import { isStale, trustTier } from "./validate.mjs";
import { paths } from "./paths.mjs";

export function parseQuery(tokens) {
  const words = [];
  const filters = [];
  for (const t of tokens) {
    const m = /^(-?)([a-z_]+):(.+)$/i.exec(t);
    if (m) {
      filters.push({ neg: m[1] === "-", field: m[2].toLowerCase(), value: m[3] });
    } else if (t) {
      words.push(t.toLowerCase());
    }
  }
  return { words, filters };
}

export function matchesQuery(concept, q) {
  const hay = `${concept.title}\n${concept.description}\n${concept.body}\n${concept.type}\n${(concept.tags || []).join(" ")}`.toLowerCase();
  for (const w of q.words) {
    if (!hay.includes(w)) return false;
  }
  const trust = trustTier(concept.data);
  const stale = isStale(concept.data);
  for (const f of q.filters) {
    let hit = false;
    switch (f.field) {
      case "type":
        hit = String(concept.type || "").toLowerCase() === f.value.toLowerCase();
        break;
      case "tag":
      case "tags":
        hit = (concept.tags || []).some((t) => String(t).toLowerCase() === f.value.toLowerCase());
        break;
      case "status":
        hit = String(concept.status || "stable").toLowerCase() === f.value.toLowerCase();
        break;
      case "trust":
        hit = trust === f.value.toLowerCase() || trust.startsWith(f.value.toLowerCase());
        break;
      case "stale":
        hit = f.value === "1" || f.value === "true" || f.value === "yes" ? stale : !stale;
        break;
      case "id":
        hit = concept.id.toLowerCase().includes(f.value.toLowerCase());
        break;
      default:
        hit = hay.includes(`${f.field}:${f.value}`.toLowerCase()) || hay.includes(f.value.toLowerCase());
    }
    if (f.neg ? hit : !hit) return false;
  }
  return true;
}

export function find(tokens, p = paths()) {
  const q = parseQuery(Array.isArray(tokens) ? tokens : String(tokens).split(/\s+/).filter(Boolean));
  return listConcepts(p).filter((c) => matchesQuery(c, q));
}

export function describeQuery(q) {
  return {
    words: q.words,
    filters: q.filters,
  };
}
