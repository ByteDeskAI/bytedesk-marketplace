/**
 * OKF v0.2 conformance (§11) + soft checks for trust/lifecycle families.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { RESERVED, paths } from "./paths.mjs";
import { listConceptFiles, readConcept } from "./store.mjs";
import { parseDoc } from "./yaml-doc.mjs";

const STATUS_OK = new Set(["draft", "stable", "deprecated"]);

function walkAllMd(base) {
  const out = [];
  if (!existsSync(base)) return out;
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".km") continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(base);
  return out;
}

export function trustTier(data = {}) {
  const v = data.verified;
  if (v == null) return "unverified";
  const list = Array.isArray(v) ? v : [v];
  if (list.some((e) => e && String(e.by || "").startsWith("human:"))) return "human-reviewed";
  if (list.length && list.every((e) => e && e.by)) return "machine-confirmed";
  return "unverified";
}

export function isStale(data, today = new Date().toISOString().slice(0, 10)) {
  if (!data?.stale_after) return false;
  return String(today) >= String(data.stale_after);
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateBundle(p = paths()) {
  const errors = [];
  const warnings = [];
  if (!p.base || !existsSync(p.base)) {
    return { ok: false, errors: ["bundle missing: run km init"], warnings };
  }

  const files = walkAllMd(p.base);
  for (const file of files) {
    const name = basename(file);
    const rel = relative(p.base, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");

    if (RESERVED.has(name)) {
      if (name === "index.md") {
        // no required frontmatter except optional root okf_version
        if (rel === "index.md" || rel.endsWith("/index.md")) {
          if (text.startsWith("---")) {
            const { data } = parseDoc(text);
            if (data.okf_version && !["0.1", "0.2", 0.1, 0.2, "0.2"].map(String).includes(String(data.okf_version))) {
              warnings.push(`${rel}: unknown okf_version ${data.okf_version}`);
            }
          }
        }
        continue;
      }
      if (name === "log.md") {
        // soft: prefer date headings
        if (text.trim() && !/^#/m.test(text)) {
          warnings.push(`${rel}: log.md should start with a heading`);
        }
        continue;
      }
    }

    // Concept documents
    if (!text.startsWith("---")) {
      errors.push(`${rel}: missing YAML frontmatter`);
      continue;
    }
    const { data } = parseDoc(text);
    if (!data || typeof data !== "object") {
      errors.push(`${rel}: unparseable frontmatter`);
      continue;
    }
    if (!data.type || String(data.type).trim() === "") {
      errors.push(`${rel}: frontmatter requires non-empty type`);
    }

    // Soft checks
    if (data.status && !STATUS_OK.has(data.status)) {
      warnings.push(`${rel}: status should be draft|stable|deprecated (got ${data.status})`);
    }
    if (data.stale_after && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.stale_after))) {
      warnings.push(`${rel}: stale_after should be YYYY-MM-DD`);
    }
    if (data.generated) {
      if (!data.generated.by) warnings.push(`${rel}: generated.by missing`);
    }
    if (data.verified) {
      const list = Array.isArray(data.verified) ? data.verified : [data.verified];
      for (const e of list) {
        if (!e?.by) warnings.push(`${rel}: verified entry missing by`);
      }
    }
    if (data.sources) {
      const srcs = Array.isArray(data.sources) ? data.sources : [];
      for (const s of srcs) {
        if (!s?.resource) warnings.push(`${rel}: sources entry missing resource`);
      }
    }
    if (String(data.type) === "Attested Computation") {
      if (!data.runtime) {
        warnings.push(`${rel}: Attested Computation should declare runtime`);
      }
    }
  }

  // Runtime dir must not appear as concepts
  const concepts = listConceptFiles(p);
  for (const f of concepts) {
    if (f.includes(`${sep}.km${sep}`) || f.includes("/.km/")) {
      errors.push(`runtime file treated as concept: ${f}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, conceptCount: concepts.length };
}

export function normalizeVerified(data) {
  if (!data?.verified) return data;
  if (!Array.isArray(data.verified) && typeof data.verified === "object") {
    return { ...data, verified: [data.verified] };
  }
  return data;
}
