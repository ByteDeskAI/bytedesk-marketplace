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
import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { gateTaskCreate } from "./enforce.mjs";
import { dependencies } from "./issue.mjs";
import { goalBody, manifestGoalTitle, parseGoalDoc, parseManifest, refusal } from "./goals.mjs";
import { paths } from "./paths.mjs";
import { create, fileFor, logEvent, read, reindex, state, withLock, writeState } from "./store.mjs";

const err = (message, status) => Object.assign(new Error(message), { status });

/**
 * The real path of `file`, or null when it resolves outside the repository.
 *
 * `realpathSync` rather than a prefix compare: a string check passes a symlink that lives inside
 * the repo and points anywhere, which is the same class of bug `servableEvidencePath` already
 * fails closed on.
 */
export function insideRepo(file, p) {
  if (!p.root) return null;
  try {
    const real = realpathSync(file);
    const root = realpathSync(p.root);
    return real === root || real.startsWith(root + sep) ? real : null;
  } catch {
    return null;
  }
}

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
 * Everything a manifest import decides BEFORE it writes anything: parse the manifest, resolve and
 * read every goal doc, work out which goals are skipped and which dependency edges exist.
 *
 * Pure with respect to the store — it reads the filesystem and returns a value. Splitting this out
 * is what makes the import atomic, because it moves every likely failure (a missing manifest, an
 * unparseable one, a goal doc that is not where it says it is, a doc with no criteria) to before
 * the first record is created. What is left in the write phase is disk failure, which the rollback
 * in `applyManifestPlan` covers.
 *
 * It is exported because a caller that wants to SHOW what an import would do — a preview, an
 * approval card, a diff — needs exactly this and must not write to find out.
 */
export function planManifest(path, p = paths()) {
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

  const goals = [];
  const skipped = [];
  for (const g of m.goals) {
    // A manifest doc path is relative to the repo the manifest lives in, not to the store.
    const docPath = isAbsolute(g.doc) ? g.doc : resolve(manifestDir, g.doc.replace(/^docs\/goals\//, ""));
    const fallback = resolve(manifestDir, g.doc);
    const candidate = existsSync(docPath) ? docPath : existsSync(fallback) ? fallback : null;
    if (!candidate) {
      skipped.push({ id: g.id, why: `doc not found: ${g.doc}` });
      continue;
    }
    // The manifest's own path is confined to the repository, and the docs it NAMES were not — so
    // `{"doc": "/etc/passwd.md"}`, or a relative walk out, read any file the board process could
    // read and wrote its contents into a task body on a shared board. Confinement is on the
    // resolved real path, not the string, so a symlink inside the repo pointing out is refused
    // too.
    const found = insideRepo(candidate, p);
    if (!found) {
      skipped.push({ id: g.id, why: `doc is outside this repository: ${g.doc}` });
      continue;
    }
    const parsed = parseGoalDoc(readFileSync(found, "utf8"));
    if (!parsed.criteria.length) {
      skipped.push({ id: g.id, why: `no parseable success criteria in ${g.doc}` });
      continue;
    }
    goals.push({
      goalId: g.id,
      title: manifestGoalTitle(g, parsed),
      acceptance: parsed.criteria.map((text) => ({ text, done: false })),
      body: goalBody(parsed, rel(found)),
      goalDoc: rel(found),
      // The manifest declares these; nothing else ever wrote the field it feeds.
      touches: g.touches.length ? g.touches : undefined,
      labels: [g.mode, g.needsHumanGate ? "human-gate" : null].filter(Boolean),
      dependsOn: g.dependsOn,
    });
  }

  // Two goals sharing an id created two tasks while the goal -> task map kept only the second, so
  // the import reported one of them and pointed BOTH goals' dependencies at it. Refused here: an
  // id is how a manifest refers to its own goals, and one that names two things names neither.
  const seen = new Set();
  const duplicates = [...new Set(goals.map((g) => g.goalId).filter((id) => (seen.has(id) ? true : (seen.add(id), false))))];
  if (duplicates.length) {
    throw err(`${path}: goal id${duplicates.length > 1 ? "s" : ""} ${duplicates.join(", ")} appear${duplicates.length > 1 ? "" : "s"} more than once — an id has to name one goal.`, 400);
  }

  const landing = new Set(goals.map((g) => g.goalId));
  const danglingDeps = [];
  let edges = 0;
  for (const g of goals) {
    const lost = g.dependsOn.filter((d) => !landing.has(d));
    if (lost.length) danglingDeps.push({ id: g.goalId, on: lost });
    edges += g.dependsOn.filter((d) => landing.has(d)).length;
  }

  // A manifest can describe A -> B -> A, or A -> A. The edges used to be written with raw mutates,
  // which walk past the refusal in `dependencies()`, so the import landed work that was blocked
  // for ever — and `tm doctor` finds a cycle but deliberately will not repair one, because which
  // edge to cut is a judgement. Refused while this is still a plan and nothing has been written.
  const waits = new Map(goals.map((g) => [g.goalId, g.dependsOn.filter((d) => landing.has(d))]));
  for (const g of goals) {
    for (const start of waits.get(g.goalId) || []) {
      const walked = new Set();
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === g.goalId) {
          throw err(`${path}: ${g.goalId} depending on ${start} closes a dependency cycle — nothing in it could ever start.`, 400);
        }
        if (walked.has(cur)) continue;
        walked.add(cur);
        stack.push(...(waits.get(cur) || []));
      }
    }
  }

  return { manifest: m, source: path, doc: rel(path), epic: { title: m.epicTitle, plan: rel(path), body: epicBody }, goals, skipped, edges, danglingDeps };
}

/**
 * Land a planned manifest, all of it or none of it.
 *
 * Before this, the import was N+1 separate `create` calls plus 2M `mutate` calls, each taking and
 * releasing the store lock on its own, with no enclosing transaction. A throw partway through left
 * the epic created, `activeEpic` pointed at it, and a partial set of tasks carrying a partial
 * dependency graph — a board state nobody asked for and only `tm doctor` could find.
 *
 * Two things make it atomic now. One lock is held across the whole landing, so no other writer
 * interleaves and the compensation cannot race a concurrent change. And every record created is
 * remembered, so a failure removes exactly what this import made and puts `activeEpic` back.
 *
 * The index is rebuilt rather than restored: `patchIndex` already treats it as a cache that
 * `reindex` can regenerate from the entity files, so once the files are gone the truthful index is
 * the derived one.
 *
 * The event log is NOT rewound. It is append-only, `logEvent` is deliberately outside the lock, and
 * a concurrent writer may have appended since — truncating it would delete somebody else's history
 * to tidy up our own. A rollback appends `goal_import_rolled_back` naming what it removed, which is
 * how an append-only log is supposed to record a compensation.
 */
export function applyManifestPlan(plan, { stamp = {} } = {}, p = paths()) {
  return withLock(p, () => {
    const createdIds = [];
    const previousActiveEpic = state(p).activeEpic ?? null;
    let activeEpicChanged = false;

    const rollback = (cause) => {
      for (const id of createdIds.reverse()) {
        try {
          const file = fileFor(id, p);
          if (file) unlinkSync(file);
        } catch {
          /* best effort: a file we cannot remove is reported below, not a reason to stop undoing */
        }
      }
      try {
        if (activeEpicChanged) writeState({ activeEpic: previousActiveEpic }, p);
        reindex(p);
      } catch {
        /* the index is a cache; `tm reindex` recovers it */
      }
      logEvent(
        "goal_import_rolled_back",
        { doc: plan.doc, removed: createdIds.length, ids: createdIds, why: cause?.message || String(cause) },
        p,
      );
    };

    try {
      const epic = create("epic", { title: plan.epic.title, plan: plan.epic.plan, ...stamp }, plan.epic.body, p);
      createdIds.push(epic.id);
      // Set BEFORE the write, not after: a `writeState` that throws part-way through leaves the
      // state file changed and the flag false, and rollback then skips the one thing it exists to
      // put back. A flag that is optimistically true costs a redundant restore; a flag that is
      // pessimistically false costs the board its active epic.
      activeEpicChanged = true;
      writeState({ activeEpic: epic.id }, p);

      const made = new Map(); // manifest goal id → tm task id
      for (const g of plan.goals) {
        const t = create(
          "task",
          {
            title: g.title,
            epic: epic.id,
            acceptance: g.acceptance,
            goalDoc: g.goalDoc,
            goalId: g.goalId,
            touches: g.touches,
            labels: g.labels,
            evidence: [],
            commits: [],
            blockedBy: [],
            blocks: [],
            ...stamp,
          },
          g.body,
          p,
        );
        createdIds.push(t.id);
        made.set(g.goalId, t.id);
      }

      // Second pass, after every task exists: a manifest lists goals in planning order and
      // `dependsOn` points forward freely.
      let edges = 0;
      const danglingDeps = [];
      for (const g of plan.goals) {
        const mine = made.get(g.goalId);
        const deps = g.dependsOn.map((d) => made.get(d)).filter(Boolean);
        const lost = g.dependsOn.filter((d) => !made.has(d));
        if (lost.length) danglingDeps.push({ id: g.goalId, task: mine, on: lost });
        if (!deps.length) continue;
        // `dependencies()`, not raw mutates: it refuses a cycle, writes both ends of every edge,
        // moves an open task to blocked and logs `dep`. `planManifest` has already refused a
        // manifest that describes a loop, so this is the belt behind that brace — the same
        // divergence that let the planner's `task.depends` land what the CLI would not.
        dependencies(mine, { add: deps }, p);
        edges += deps.length;
      }

      logEvent(
        "goal_imported",
        { id: epic.id, doc: plan.doc, goals: made.size, skipped: plan.skipped.length, edges },
        p,
      );
      const touched = [...made.values()].filter((id) => (read(id, p).touches || []).length).length;
      return { epic, manifest: plan.manifest, tasks: [...made.values()], made, skipped: plan.skipped, edges, danglingDeps, touched };
    } catch (cause) {
      rollback(cause);
      throw cause;
    }
  });
}

/**
 * A whole program: one epic (made active), one task per goal with a parseable gate, `dependsOn`
 * wired as blockedBy after every task exists.
 *
 * Plan first, then land it under one lock. Either the whole program is on the board or none of it
 * is — see `applyManifestPlan` for what "none of it" costs and what it deliberately does not undo.
 */
export function importManifest(path, { stamp = {} } = {}, p = paths()) {
  return applyManifestPlan(planManifest(path, p), { stamp }, p);
}
