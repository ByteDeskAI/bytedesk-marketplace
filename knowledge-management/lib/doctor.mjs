/**
 * Diagnose + repair unambiguous index drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { listConcepts, writeConcept } from "./store.mjs";
import { reindex } from "./index.mjs";
import { validateBundle } from "./validate.mjs";
import { brokenLinks } from "./graph.mjs";
import { paths } from "./paths.mjs";

export function diagnose(p = paths()) {
  const problems = [];
  if (!p.base || !existsSync(p.base)) {
    problems.push({ code: "no_bundle", message: "no knowledge bundle — run km init", fixable: false });
    return { problems };
  }
  if (!existsSync(p.indexJson)) {
    problems.push({ code: "no_index", message: "missing .km/index.json", fixable: true });
  }
  if (!existsSync(p.indexMd)) {
    problems.push({ code: "no_index_md", message: "missing index.md", fixable: true });
  }
  for (const c of listConcepts(p)) {
    if (!c.description && c.title) {
      problems.push({ code: "empty_description", id: c.id, message: `${c.id}: empty description`, fixable: true });
    }
  }
  for (const e of brokenLinks(p)) {
    problems.push({
      code: "broken_link",
      id: e.from,
      message: `${e.from} → missing ${e.to}`,
      fixable: false,
    });
  }
  const v = validateBundle(p);
  for (const err of v.errors) {
    problems.push({ code: "validate", message: err, fixable: false });
  }
  return { problems, validate: v };
}

export function repairAll(p = paths()) {
  const d = diagnose(p);
  const fixed = [];
  if (!p.base || !existsSync(p.base)) return { fixed, remaining: d.problems };

  reindex(p);
  fixed.push("reindex");

  for (const c of listConcepts(p)) {
    if (!c.description && c.title) {
      writeConcept(c.id, { ...c.data, description: c.title }, c.body, p);
      fixed.push(`description:${c.id}`);
    }
  }

  const after = diagnose(p);
  return { fixed, remaining: after.problems.filter((x) => !x.fixable || x.code === "broken_link") };
}

export function renderDoctor(report) {
  if (!report.problems?.length) return "no problems found";
  return report.problems.map((p) => `- [${p.fixable ? "fixable" : "manual"}] ${p.message}`).join("\n");
}
