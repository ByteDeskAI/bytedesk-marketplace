/**
 * Knowledge health: orphans, broken links, stale, drafts, missing descriptions.
 */
import { listConcepts } from "./store.mjs";
import { backlinks, brokenLinks, graphData } from "./graph.mjs";
import { isStale, trustTier } from "./validate.mjs";
import { paths } from "./paths.mjs";

export function lintBundle(p = paths(), { draftDays = 30 } = {}) {
  const issues = [];
  const concepts = listConcepts(p);
  const { edges } = graphData(p);
  const inbound = new Set(edges.filter((e) => !e.broken).map((e) => e.to));

  for (const c of concepts) {
    if (!c.description || !String(c.description).trim()) {
      issues.push({ severity: "warn", code: "no_description", id: c.id, message: "missing description" });
    }
    if (!inbound.has(c.id) && concepts.length > 1) {
      issues.push({ severity: "info", code: "orphan", id: c.id, message: "no inbound links" });
    }
    if (isStale(c.data)) {
      issues.push({
        severity: "warn",
        code: "stale",
        id: c.id,
        message: `stale_after ${c.data.stale_after} has passed`,
      });
    }
    if (c.status === "draft") {
      const gen = c.data.generated?.at;
      if (gen) {
        const age = (Date.now() - Date.parse(gen)) / (86400 * 1000);
        if (age > draftDays) {
          issues.push({
            severity: "info",
            code: "old_draft",
            id: c.id,
            message: `draft older than ${draftDays} days`,
          });
        }
      }
    }
    if (c.data.sources) {
      for (const s of c.data.sources) {
        if (!s?.resource) {
          issues.push({ severity: "warn", code: "source_no_resource", id: c.id, message: "sources entry missing resource" });
        }
      }
    }
    issues.push({
      severity: "info",
      code: "trust",
      id: c.id,
      message: `trust tier: ${trustTier(c.data)}`,
    });
  }

  for (const e of brokenLinks(p)) {
    issues.push({
      severity: "warn",
      code: "broken_link",
      id: e.from,
      message: `broken link to ${e.to}`,
    });
  }

  // Drop pure trust info lines unless --verbose; keep structural ones for default
  const structural = issues.filter((i) => i.code !== "trust");
  return {
    ok: !structural.some((i) => i.severity === "error"),
    issues: structural,
    trust: issues.filter((i) => i.code === "trust"),
    counts: {
      concepts: concepts.length,
      orphans: structural.filter((i) => i.code === "orphan").length,
      broken: structural.filter((i) => i.code === "broken_link").length,
      stale: structural.filter((i) => i.code === "stale").length,
    },
  };
}
