/**
 * OKF concept documents: real YAML frontmatter + markdown body.
 * Unknown keys are preserved on round-trip.
 */
// Vendored so /plugin install works without npm ci (node_modules is gitignored).
import { parse as yamlParse, stringify as yamlStringify } from "./vendor/yaml/dist/index.js";

const FRONTMATTER_KEYS = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "status",
  "stale_after",
  "generated",
  "verified",
  "sources",
  "usage_window",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
  "tasks",
  "okf_version",
];

export function parseDoc(text) {
  if (!text || !String(text).startsWith("---")) {
    return { data: {}, body: text || "" };
  }
  const raw = String(text);
  // Opening --- then optional newline; closing --- on its own line
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    // bare --- without proper close
    if (raw === "---\n" || raw.startsWith("---\n") && !raw.includes("\n---", 4)) {
      return { data: {}, body: raw };
    }
    return { data: {}, body: raw };
  }
  let data = {};
  try {
    const parsed = yamlParse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return { data, body: (m[2] || "").replace(/^\n/, "") };
}

export function serializeDoc(data = {}, body = "") {
  const ordered = {};
  for (const k of FRONTMATTER_KEYS) {
    if (data[k] !== undefined) ordered[k] = data[k];
  }
  for (const [k, v] of Object.entries(data)) {
    if (!(k in ordered) && v !== undefined) ordered[k] = v;
  }
  const yaml = yamlStringify(ordered, {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  }).trimEnd();
  const b = String(body || "").replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${b}`;
}

export function slug(s, max = 48) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max) || "untitled"
  );
}
