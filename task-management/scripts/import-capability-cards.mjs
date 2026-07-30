#!/usr/bin/env node
/**
 * Import a legacy `docs/capabilities/` store (INDEX.yaml + CAP-*.md) into the task store.
 *
 * That layout was the capability backlog before capabilities became a store kind: a YAML
 * registry, one markdown card per capability, a `next_id` counter and a python script whose
 * whole job was checking the registry and the cards still agreed. All of it is what the store
 * already does, so this reads the old shape once and never needs to run again.
 *
 * Ids are preserved — CAP-0046 stays CAP-0046, so every reference in a commit message,
 * changelog or PR still resolves.
 *
 *   node scripts/import-capability-cards.mjs [--dir docs/capabilities] [--dry-run]
 *
 * Idempotent: a capability whose id already exists in the store is skipped, not duplicated.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { paths } from "../lib/paths.mjs";
import { create, read } from "../lib/store.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const DRY = argv.includes("--dry-run");
const P = paths();
if (!P.root) {
  process.stderr.write(`${P.unavailable}\n`);
  process.exit(1);
}
const DIR = resolve(P.root, flag("dir", "docs/capabilities"));

/**
 * Just enough YAML for this one known shape: a `capabilities:` list of `- id: ...` blocks
 * with flat scalars and two string lists. A parser dependency for a file that is read once,
 * in a script that is run once, would outlive its own reason to exist.
 */
function parseIndex(text) {
  const rows = [];
  let cur = null;
  let listKey = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.trimStart().startsWith("#")) continue;
    const item = /^ {2}- (\w+): (.*)$/.exec(line);
    if (item) {
      if (cur) rows.push(cur);
      cur = { [item[1]]: unquote(item[2]) };
      listKey = null;
      continue;
    }
    if (!cur) continue;
    const nested = /^ {6}- (.*)$/.exec(line);
    if (nested && listKey) {
      cur[listKey].push(unquote(nested[1]));
      continue;
    }
    const field = /^ {4}(\w+): ?(.*)$/.exec(line);
    if (field) {
      const [, key, value] = field;
      if (value === "" || value === "[]") {
        cur[key] = [];
        listKey = value === "" ? key : null;
        if (value === "[]") cur[key] = [];
      } else {
        cur[key] = unquote(value);
        listKey = null;
      }
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

const unquote = (s) => s.trim().replace(/^["'](.*)["']$/, "$1");

/** Legacy lifecycle → store status. `parked`/`accepted`/`planned` are all still open work. */
const STATUS = {
  shipped: "done",
  in_progress: "in_progress",
  rejected: "deleted",
  dropped: "deleted",
};

/** The card body, minus the `# CAP-…` heading and the front matter table the fields replace. */
function cardBody(file) {
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l, i) => i > 0 && l.startsWith("## "));
  return start === -1 ? "" : `${lines.slice(start).join("\n").trim()}\n`;
}

function main() {
  const indexFile = join(DIR, "INDEX.yaml");
  if (!existsSync(indexFile)) {
    process.stderr.write(`no INDEX.yaml under ${DIR}\n`);
    process.exit(1);
  }
  const files = readdirSync(DIR).filter((f) => /^CAP-\d+/.test(f));
  const rows = parseIndex(readFileSync(indexFile, "utf8"));
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.id) continue;
    if (read(row.id, P)) {
      skipped += 1;
      continue;
    }
    const card = files.find((f) => f.startsWith(`${row.id}-`));
    const fields = {
      id: row.id,
      title: row.title,
      status: STATUS[row.status] || "open",
      area: row.area || "product",
      impact: row.impact || "M",
      effort: row.effort || "M",
      confidence: "M",
      source: row.source || "gap-backlog",
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
      related: Array.isArray(row.related) ? row.related : [],
      // The legacy vocabulary was richer than the store's four statuses; keep the original
      // word so `proposed` vs `parked` vs `accepted` is not silently flattened to "open".
      legacyStatus: row.status,
      ...(row.legacy_id ? { legacyId: row.legacy_id } : {}),
      ...(row.shipped_at ? { shipped: row.shipped_at } : {}),
    };
    if (DRY) {
      process.stdout.write(`would import ${row.id} [${fields.status}] ${row.title}\n`);
    } else {
      create("capability", fields, card ? cardBody(join(DIR, card)) : "", P);
      process.stdout.write(`${row.id} [${fields.status}] ${row.title}\n`);
    }
    imported += 1;
  }

  const orphans = files.filter((f) => !rows.some((r) => f.startsWith(`${r.id}-`)));
  if (orphans.length) process.stdout.write(`\n${orphans.length} card(s) not in INDEX.yaml, not imported:\n  ${orphans.join("\n  ")}\n`);
  process.stdout.write(`\n${DRY ? "would import" : "imported"} ${imported}, already present ${skipped}\n`);
}

main();
