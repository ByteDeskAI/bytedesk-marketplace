/**
 * Store integrity: what is actually inconsistent, and which of it is safe to repair.
 *
 * The store's whole design is markdown files as the source of truth, one per entity,
 * committed to git. That is what makes it readable and mergeable — and it is also why
 * it drifts. A file gets hand-edited, a merge resolves one side of a two-sided link,
 * a task is deleted while three others still name it as a blocker, a session dies
 * holding a claim. `tm reindex` does not help: it rebuilds the cache FROM the files,
 * so it faithfully reproduces whatever is wrong with them.
 *
 * Every finding says what it is, whether it can be fixed automatically, and what the
 * fix would do. `--fix` applies only the ones that are unambiguous; a dependency
 * cycle and a done task with unmet criteria are decisions, not typos, so they are
 * reported and left alone.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RESOLVED, list, logEvent, reindex, state, update, writeState } from "./store.mjs";
import { LINK_TYPES } from "./issue.mjs";
import { releaseClaim, staleClaims, sweepClaims } from "./claims.mjs";
import { KINDS, paths } from "./paths.mjs";

/**
 * error   — the store is lying: a read gives a wrong answer.
 * warning — the store is untidy: correct, but something will read oddly.
 */
const finding = (level, code, id, message, fix = null) => ({ level, code, id, message, fixable: Boolean(fix), fix });

export function diagnose(p = paths()) {
  const tasks = list("task", { includeDeleted: true }, p);
  const live = tasks.filter((t) => t.status !== "deleted");
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const epics = new Set(list("epic", {}, p).map((e) => e.id));
  const out = [];

  for (const t of live) {
    // A blockedBy pointing at nothing makes `tm why`/`tm next` treat the task as
    // waiting forever on a task that cannot ever complete.
    const dangling = (t.blockedBy || []).filter((d) => !byId.has(d));
    if (dangling.length) {
      out.push(
        finding("error", "dangling-dep", t.id, `blockedBy names ${dangling.join(", ")}, which does not exist`, () => {
          update(t.id, { blockedBy: (t.blockedBy || []).filter((d) => byId.has(d)) }, p);
          return `dropped ${dangling.join(", ")} from ${t.id}.blockedBy`;
        }),
      );
    }

    // Half a dependency edge: the graph reads correctly from one end and not the other.
    for (const dep of (t.blockedBy || []).filter((d) => byId.has(d))) {
      const other = byId.get(dep);
      if (!(other.blocks || []).includes(t.id)) {
        out.push(
          finding("warning", "one-sided-dep", t.id, `${t.id} is blocked by ${dep}, but ${dep} does not list it in blocks`, () => {
            update(dep, { blocks: [...new Set([...(other.blocks || []), t.id])] }, p);
            return `added ${t.id} to ${dep}.blocks`;
          }),
        );
      }
    }
    for (const blocked of (t.blocks || []).filter((d) => byId.has(d))) {
      const other = byId.get(blocked);
      if (!(other.blockedBy || []).includes(t.id)) {
        out.push(
          finding("warning", "one-sided-dep", t.id, `${t.id} blocks ${blocked}, but ${blocked} does not list it in blockedBy`, () => {
            update(blocked, { blockedBy: [...new Set([...(other.blockedBy || []), t.id])] }, p);
            return `added ${t.id} to ${blocked}.blockedBy`;
          }),
        );
      }
    }

    // Jira-shaped links are mirrored on write; a merge can drop one side.
    for (const link of t.links || []) {
      const mirror = LINK_TYPES[link.type];
      if (!mirror) {
        out.push(finding("warning", "unknown-link-type", t.id, `link type "${link.type}" is not one the store knows`));
        continue;
      }
      const other = byId.get(link.id);
      if (!other) {
        out.push(
          finding("error", "dangling-link", t.id, `links to ${link.id}, which does not exist`, () => {
            update(t.id, { links: (t.links || []).filter((l) => l.id !== link.id) }, p);
            return `dropped the link to ${link.id} from ${t.id}`;
          }),
        );
        continue;
      }
      if (!(other.links || []).some((l) => l.type === mirror && l.id === t.id)) {
        out.push(
          finding("warning", "one-sided-link", t.id, `${t.id} "${link.type}" ${link.id}, but ${link.id} has no "${mirror}" back`, () => {
            update(link.id, { links: [...(other.links || []), { type: mirror, id: t.id }] }, p);
            return `added "${mirror} ${t.id}" to ${link.id}`;
          }),
        );
      }
    }

    if (t.epic && !epics.has(t.epic)) {
      out.push(
        finding("error", "orphan-epic", t.id, `epic ${t.epic} does not exist`, () => {
          update(t.id, { epic: null }, p);
          return `cleared ${t.id}.epic`;
        }),
      );
    }

    if (t.parent && !byId.has(t.parent)) {
      out.push(
        finding("error", "orphan-parent", t.id, `parent ${t.parent} does not exist`, () => {
          update(t.id, { parent: undefined }, p);
          return `detached ${t.id} from ${t.parent}`;
        }),
      );
    }

    // Blocked, no written reason, and every blocker finished: unblockDependents should
    // have reopened this. If the blocker was closed by hand it never ran.
    const depsResolved = (t.blockedBy || []).every((d) => !byId.has(d) || RESOLVED.has(byId.get(d).status));
    if (t.status === "blocked" && !t.blockedReason && depsResolved && !dangling.length) {
      out.push(
        finding("warning", "stuck-blocked", t.id, "blocked with no reason and every blocker is finished", () => {
          update(t.id, { status: "open" }, p);
          return `reopened ${t.id}`;
        }),
      );
    }

    if (t.status === "done" && (t.acceptance || []).some((a) => !a.done)) {
      const open = (t.acceptance || []).filter((a) => !a.done).length;
      // Reachable through `tm override` or a hand edit. Ticking them would be forging
      // evidence; reopening might be wrong. The operator decides.
      out.push(finding("warning", "done-unmet", t.id, `done with ${open} acceptance criterion/criteria still unticked`));
    }

    for (const ref of t.evidence || []) {
      if (!existsSync(join(p.root, ref))) {
        out.push(
          finding("warning", "missing-evidence", t.id, `evidence ${ref} is recorded but the file is gone`, () => {
            update(t.id, { evidence: (t.evidence || []).filter((e) => e !== ref) }, p);
            return `dropped ${ref} from ${t.id}.evidence`;
          }),
        );
      }
    }
  }

  // Two tasks mirroring one native task means every TaskUpdate lands on whichever
  // one `find` returns first.
  const nativeSeen = new Map();
  for (const t of live.filter((x) => x.nativeId)) {
    if (nativeSeen.has(t.nativeId)) {
      out.push(finding("error", "duplicate-native", t.id, `shares nativeId ${t.nativeId} with ${nativeSeen.get(t.nativeId)}`));
    } else {
      nativeSeen.set(t.nativeId, t.id);
    }
  }

  // Two files claiming one id. `fileFor` resolves an id with the FIRST directory entry
  // matching it, so the other file is permanently unaddressable: `tm show`, `tm start`
  // and `tm done` can never reach it. Worse, this used to be invisible here — the only
  // symptom doctor saw was index-drift, which `--fix` reindexed away, leaving the
  // duplicate on disk and reporting "no problems found" over the top of it.
  out.push(...duplicateIds(p));

  // The residue of a write that died between writeFileSync and renameSync. Harmless now
  // that fileFor requires .md — but before that it was a phantom entity, and its presence
  // still means a process was killed mid-write, which is worth saying out loud.
  out.push(...strayTemps(p));

  out.push(...cycles(live, (t) => t.blockedBy || [], "dep-cycle"));
  out.push(...cycles(live, (t) => (t.parent ? [t.parent] : []), "subtask-cycle"));

  // A claim whose session or worktree is gone hides the task from `tm parallel`.
  const dead = staleClaims(p);
  if (dead.length) {
    out.push(
      finding("warning", "dead-claim", null, `${dead.length} expired claim(s): ${dead.map((c) => c.id).join(", ")}`, () => {
        const freed = sweepClaims(p);
        return `released ${freed.join(", ")}`;
      }),
    );
  }

  // A claim on a task nobody is running, or a running task nobody claimed: either way
  // the two records disagree about what is happening.
  const claims = state(p).claims || {};
  for (const [id, claim] of Object.entries(claims)) {
    const t = byId.get(id);
    if (!t) {
      out.push(
        finding("error", "claim-orphan", id, "a claim is held on a task that does not exist", () => dropClaim(id, p)),
      );
    } else if (t.status !== "in_progress" && !RESOLVED.has(t.status)) {
      // Parked or blocked while still claimed: `tm parallel` skips it and nobody
      // can see why. Every exit from in_progress is supposed to release.
      out.push(
        finding("warning", "claim-stale-status", id, `claimed but its status is ${t.status}, not in_progress`, () =>
          dropClaim(id, p),
        ),
      );
    } else if (RESOLVED.has(t.status)) {
      out.push(
        finding("warning", "claim-on-closed", id, `claimed but already ${t.status}`, () => dropClaim(id, p)),
      );
    }
  }
  for (const t of live.filter((x) => x.status === "in_progress")) {
    if (!claims[t.id]) {
      out.push(finding("warning", "unclaimed-wip", t.id, "in_progress with no claim — another session could take it"));
    }
  }

  // The cache is disposable, but a stale one makes the dashboard and the CLI disagree.
  const drift = indexDrift(p, live);
  if (drift) {
    out.push(
      finding("warning", "index-drift", null, drift, () => {
        const idx = reindex(p);
        return `reindexed ${idx.epics.length} epics, ${idx.tasks.length} tasks, ${idx.adrs.length} adrs`;
      }),
    );
  }

  return out;
}

/**
 * Drop one claim, leaving the task alone. Goes through the store's own locked
 * writeState, so a doctor run cannot race a session that is claiming something.
 */
/**
 * Temp files left behind by an interrupted write.
 *
 * Reported, never auto-deleted: a temp file is the only surviving copy of whatever that write
 * was carrying, and the entity it was destined for may be missing or stale. Deleting it is a
 * decision that needs eyes on the contents, so doctor names the path and stops.
 */
function strayTemps(p = paths()) {
  const out = [];
  for (const spec of Object.values(KINDS)) {
    const dir = p[spec.dir];
    if (!dir || !existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      // Both shapes: the current `.tm-tmp-<pid>-<name>` and the pre-0.4 `<name>.<pid>.tmp`,
      // because an existing store can be carrying either.
      if (!file.startsWith(".tm-tmp-") && !file.endsWith(".tmp")) continue;
      out.push(
        finding(
          "warning",
          "stray-temp",
          null,
          `${join(spec.dir, file)} is a temp file from an interrupted write — inspect it, then delete it or rename it into place`,
        ),
      );
    }
  }
  return out;
}

/**
 * Ids with more than one file behind them. Deliberately NOT auto-fixable: choosing
 * which file keeps the id, and what the loser is renamed to, changes an identity that
 * commits, links and dependencies already point at. That is a judgement, not a typo,
 * so doctor names both paths and stops.
 */
function duplicateIds(p = paths()) {
  const out = [];
  for (const [kind, spec] of Object.entries(KINDS)) {
    const dir = p[spec.dir];
    if (!dir || !existsSync(dir)) continue;
    const byId = new Map();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const id = (file.match(new RegExp(`^(${spec.prefix}-\\d+)`)) || [])[1];
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(file);
    }
    for (const [id, files] of byId) {
      if (files.length < 2) continue;
      out.push(
        finding(
          "error",
          "duplicate-id",
          id,
          `${files.length} ${kind} files claim ${id} — only ${files.sort()[0]} is reachable; ${files
            .slice(1)
            .join(", ")} cannot be addressed at all`,
        ),
      );
    }
  }
  return out;
}

function dropClaim(id, p) {
  // releaseClaim owns this: it reads and writes inside withLock. The hand-rolled version here
  // read state(p).claims OUTSIDE the lock and then called the locking writeState, which is the
  // stale-read-then-locked-write shape — the one that looks safe and is not.
  const released = releaseClaim(id, p);
  if (released) logEvent("doctor_release", { id }, p);
  return released ? `released the claim on ${id}` : `no claim on ${id}`;
}

/**
 * Cycles over a multi-valued edge, found by depth-first search.
 *
 * Walking only the first blocker would miss A→B, A→C, C→A entirely — the loop that
 * hangs a graph render is rarely down the first edge.
 */
function cycles(tasks, edge, code) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = new Set();
  const seen = new Set();
  const found = [];

  const visit = (id, path) => {
    if (done.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    for (const next of edge(node)) {
      if (!byId.has(next)) continue;
      if (path.includes(next)) {
        const loop = [...path.slice(path.indexOf(next)), next];
        const key = [...loop].sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);
          found.push(finding("error", code, loop[0], `cycle: ${loop.join(" → ")}`));
        }
        continue;
      }
      visit(next, [...path, next]);
    }
    done.add(id);
  };

  for (const t of tasks) visit(t.id, [t.id]);
  return found;
}

function indexDrift(p, live) {
  try {
    if (!existsSync(p.index)) return "index.json is missing";
    const index = JSON.parse(readFileSync(p.index, "utf8"));
    const indexed = new Set((index.tasks || []).map((t) => t.id));
    const actual = new Set(live.map((t) => t.id));
    const missing = [...actual].filter((id) => !indexed.has(id));
    const extra = [...indexed].filter((id) => !actual.has(id));
    if (!missing.length && !extra.length) return null;
    return `index.json disagrees with the files: ${missing.length} missing, ${extra.length} stale`;
  } catch {
    return "index.json is unreadable";
  }
}

/**
 * Repair until the store stops changing.
 *
 * One pass is not enough, and the reason is structural: dropping a dangling blocker
 * can leave a task `blocked` with nothing blocking it, which is a *different* finding
 * that only exists once the first is fixed. A single pass would print the repairs it
 * made and then a fresh "[fixable]" warning underneath — which reads exactly like the
 * fix having failed.
 *
 * Bounded rather than while(true): a pair of checks that each "fix" into the other's
 * territory would spin forever, and a doctor that hangs is worse than one that stops
 * early and says there is more to do.
 */
export function repairAll(p = paths(), { passes = 5 } = {}) {
  const applied = [];
  for (let i = 0; i < passes; i += 1) {
    const findings = diagnose(p);
    if (!findings.some((f) => f.fixable)) break;
    const round = repair(findings, p);
    if (!round.length) break;
    applied.push(...round);
  }
  return applied;
}

/** Apply every fixable finding, in the order they were reported. One pass. */
export function repair(findings, p = paths()) {
  const applied = [];
  for (const f of findings) {
    if (!f.fixable) continue;
    try {
      applied.push({ code: f.code, id: f.id, did: f.fix() });
    } catch (err) {
      applied.push({ code: f.code, id: f.id, error: err.message });
    }
  }
  if (applied.length) logEvent("doctor_fix", { count: applied.length, codes: [...new Set(applied.map((a) => a.code))] }, p);
  return applied;
}

const MARK = { error: "✗", warning: "!" };

export function render(findings, { fixed = null } = {}) {
  // "no problems found" only when there is genuinely nothing to say. After a repair
  // there IS: swallowing the list of what changed is the one output a fix must never
  // produce, because the operator cannot review a change they were not shown.
  if (!findings.length && !fixed?.length) return "no problems found";
  const out = [];
  for (const level of ["error", "warning"]) {
    const rows = findings.filter((f) => f.level === level);
    if (!rows.length) continue;
    out.push(`## ${level}${rows.length === 1 ? "" : "s"} (${rows.length})`);
    for (const f of rows) {
      out.push(`${MARK[level]} ${(f.id || "—").padEnd(9)} ${f.code.padEnd(20)} ${f.message}${f.fixable ? "  [fixable]" : ""}`);
    }
    out.push("");
  }
  if (fixed) {
    out.push(fixed.length ? `## fixed (${fixed.length})` : "## fixed (nothing was fixable)");
    for (const a of fixed) out.push(`  ${a.error ? `FAILED ${a.code}: ${a.error}` : a.did}`);
    out.push("");
  } else {
    const fixable = findings.filter((f) => f.fixable).length;
    if (fixable) out.push(`${fixable} of ${findings.length} can be repaired automatically — \`tm doctor --fix\``);
  }
  return out.join("\n").trimEnd();
}
