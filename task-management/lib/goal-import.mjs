/**
 * Goal docs and `*.plan.json` manifests become tasks and epics.
 *
 * Lifted out of `bin/tm goal import` so `POST /api/goal/import` and `tm_goal_import` land the same
 * records with the same refusals. Errors carry `status`: 409 for a refusal the caller could argue
 * with (no criteria, a closed gate), 400 for input that cannot be read.
 *
 * Refusing a doc with no parseable criteria is the point: a task created with an empty acceptance
 * list passes `tm done` unchallenged, so a silent import would have the gate certify a goal nobody
 * verified. A manifest skips such docs and names them rather than losing the other nineteen.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { gateTaskCreate } from "./enforce.mjs";
import { goalBody, manifestGoalTitle, parseGoalDoc, parseManifest, refusal } from "./goals.mjs";
import { paths } from "./paths.mjs";
import { create, logEvent, mutate, read, state, writeState } from "./store.mjs";

const err = (message, status) => Object.assign(new Error(message), { status });

/** Repo-relative when the path is inside the project, else as given. */
export function relativeToRoot(file, p) {
  return p.root && file.startsWith(`${p.root}/`) ? file.slice(p.root.length + 1) : file;
}

export function importGoalDoc(text, { source = "goal", epic = null, stamp = {} } = {}, p = paths()) {
  const parsed = parseGoalDoc(text);
  if (!parsed.title) {
    throw err(`${source} has no \`# Goal:\` heading and no \`**Objective:**\` line — cannot name the task.`, 400);
  }
  if (!parsed.criteria.length) throw err(refusal(source), 409);

  const gate = gateTaskCreate(p);
  if (!gate.allow) throw err(gate.reason, 409);

  const rel = relativeToRoot(source, p);
  const task = create(
    "task",
    {
      title: parsed.title,
      epic: epic || state(p).activeEpic || null,
      acceptance: parsed.criteria.map((t) => ({ text: t, done: false })),
      goalDoc: rel,
      evidence: [],
      commits: [],
      blockedBy: [],
      blocks: [],
      ...stamp,
    },
    goalBody(parsed, rel),
    p,
  );
  logEvent("goal_imported", { id: task.id, doc: rel, criteria: parsed.criteria.length, shape: parsed.shape }, p);
  return { task, parsed, doc: rel };
}

/**
 * A whole program: one epic (made active), one task per goal with a parseable gate, `dependsOn`
 * wired as blockedBy after every task exists — a manifest lists goals in planning order and
 * dependsOn points forward freely.
 */
export function importManifest(path, { stamp = {} } = {}, p = paths()) {
  if (!existsSync(path)) throw err(`no such file: ${path}`, 400);
  const m = parseManifest(readFileSync(path, "utf8"));
  if (m.error) throw err(`${path}: ${m.error}`, 400);
  if (!m.goals.length) throw err(`${path}: the manifest lists no usable goals (each needs an id and a doc)`, 400);

  const rel = (f) => relativeToRoot(f, p);
  const manifestDir = dirname(path);
  const epicBody = [
    m.definitionOfDone ? `**Definition of done:** ${m.definitionOfDone}` : "",
    m.gate ? `**Integration gate:** \`${m.gate}\`` : "",
    m.autoMergeTo ? `**Auto-merges to:** ${m.autoMergeTo}` : "",
    m.jiraEpicKey ? `Jira: ${m.jiraEpicKey}` : "",
    `Imported from ${rel(path)}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const epic = create("epic", { title: m.epicTitle, plan: rel(path), ...stamp }, epicBody, p);
  writeState({ activeEpic: epic.id }, p);

  const made = new Map(); // manifest goal id → tm task id
  const skipped = [];
  for (const g of m.goals) {
    // A manifest doc path is relative to the repo the manifest lives in, not to the store.
    const docPath = isAbsolute(g.doc) ? g.doc : resolve(manifestDir, g.doc.replace(/^docs\/goals\//, ""));
    const fallback = resolve(manifestDir, g.doc);
    const found = existsSync(docPath) ? docPath : existsSync(fallback) ? fallback : null;
    if (!found) {
      skipped.push({ id: g.id, why: `doc not found: ${g.doc}` });
      continue;
    }
    const parsed = parseGoalDoc(readFileSync(found, "utf8"));
    if (!parsed.criteria.length) {
      skipped.push({ id: g.id, why: `no parseable success criteria in ${g.doc}` });
      continue;
    }
    const t = create(
      "task",
      {
        title: manifestGoalTitle(g, parsed),
        epic: epic.id,
        acceptance: parsed.criteria.map((text) => ({ text, done: false })),
        goalDoc: rel(found),
        goalId: g.id,
        // The manifest declares these; nothing else ever wrote the field it feeds.
        touches: g.touches.length ? g.touches : undefined,
        labels: [g.mode, g.needsHumanGate ? "human-gate" : null].filter(Boolean),
        evidence: [],
        commits: [],
        blockedBy: [],
        blocks: [],
        ...stamp,
      },
      goalBody(parsed, rel(found)),
      p,
    );
    made.set(g.id, t.id);
  }

  let edges = 0;
  const danglingDeps = [];
  for (const g of m.goals) {
    const mine = made.get(g.id);
    if (!mine) continue;
    const deps = g.dependsOn.map((d) => made.get(d)).filter(Boolean);
    const lost = g.dependsOn.filter((d) => !made.has(d));
    if (lost.length) danglingDeps.push({ id: g.id, task: mine, on: lost });
    if (!deps.length) continue;
    mutate(mine, (doc) => ({
      blockedBy: [...new Set([...(doc.blockedBy || []), ...deps])],
      status: doc.status === "open" ? "blocked" : doc.status,
    }), p);
    for (const d of deps) mutate(d, (doc) => ({ blocks: [...new Set([...(doc.blocks || []), mine])] }), p);
    edges += deps.length;
  }

  logEvent("goal_imported", { id: epic.id, doc: rel(path), goals: made.size, skipped: skipped.length, edges }, p);
  const touched = [...made.values()].filter((id) => (read(id, p).touches || []).length).length;
  return { epic, manifest: m, tasks: [...made.values()], made, skipped, edges, danglingDeps, touched };
}
