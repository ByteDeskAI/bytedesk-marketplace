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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { planFindings } from "./plans.mjs";
import { missingFields } from "./completeness.mjs";
import { RESOLVED, config, list, logEvent, missingContractRules, reindex, removeConfigKey, reopenEpic, seedGitContract, state, boardIdentity, storeBoard, trackedHostFiles, untrackHostFiles, update, writeState } from "./store.mjs";
import { LINK_TYPES } from "./issue.mjs";
import { releaseClaim, staleClaims, sweepClaims } from "./claims.mjs";
import { KINDS, paths } from "./paths.mjs";
import {
  launcherStatus,
  legacyCodexHooks,
  legacyProjectLaunchers,
  ownedLegacyGlobalLinks,
  removeOwnedLegacyGlobalLinks,
  removeOwnedLegacyProjectLaunchers,
  rewriteLegacyCodexHooks,
  writeLaunchers,
} from "./launcher.mjs";

/**
 * error   — the store is lying: a read gives a wrong answer.
 * warning — the store is untidy: correct, but something will read oddly.
 */
const finding = (level, code, id, message, fix = null) => ({ level, code, id, message, fixable: Boolean(fix), fix });

/**
 * A URI, not a path. Two or more characters before the colon, because RFC 3986 allows a
 * one-letter scheme and `C:\evidence\proof.log` would otherwise read as one — a Windows
 * drive letter is the likelier thing to meet, and misreading it as a scheme would skip a
 * path that genuinely can be checked.
 */
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/**
 * Whether an evidence ref is a thing this process can look for on disk.
 *
 * Both writers — `tm evidence` and the `tm_evidence` tool — copy the file into the store and
 * record `evidence/<id>-<name>`, so every ref they produce is store-relative and checkable.
 * The third writer is a hand edit, which is not abuse: markdown files you can open and change
 * are the store's whole premise, and a person recording what proves a task reaches for
 * whatever is probative — the url of the PR, an absolute path to a log outside the repo, an
 * opaque handle to a browser session (`browser:019fb067-…`).
 *
 * A ref with a scheme is skipped rather than reported. Nothing here can resolve it, and a
 * finding no one can act on is noise — but the sharper reason is that this finding's `fix`
 * DELETES the ref. `join(root, "https://…/pull/69")` never exists, so the url that proves the
 * task was flagged as drift and `--fix` dropped it. Losing the provenance is a strictly worse
 * outcome than the untidiness the check was written to catch, and it happened silently, to the
 * one ref most worth keeping.
 */
const checkable = (ref) => typeof ref === "string" && ref.length > 0 && !URI.test(ref);

/**
 * An absolute ref is checked where it points. `join(root, "/var/log/build.log")` yields
 * `<root>/var/log/build.log`, which is not the file the ref names and does not exist — so an
 * absolute path that is present on disk read as missing, and got dropped for it.
 */
const evidenceTarget = (ref, p) => (isAbsolute(ref) ? ref : join(p.root, ref));




/**
 * The rule that keeps the store out of git, as `<file>:<line>:<pattern>`, or null.
 *
 * A blanket `.bytedesk/` in the repo root is the usual culprit — the tasks are then invisible to
 * every other clone and to CI, and nobody notices, because an ignored file makes no noise. The
 * store's own `.gitignore` never matches `tasks/`, so any match here is an ancestor overreaching.
 */
export function ignoreRule(p) {
  try {
    const out = execFileSync("git", ["check-ignore", "-v", "--no-index", join(p.base, "tasks")], {
      cwd: p.root,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    // `<source>:<line>:<pattern>\t<path>` — keep the part that tells you what to edit.
    return out ? out.split("\t")[0] : null;
  } catch {
    return null; // exit 1 = not ignored; no git / no repo = the question does not apply
  }
}

export function diagnose(p = paths()) {
  const tasks = list("task", { includeDeleted: true }, p);
  const live = tasks.filter((t) => t.status !== "deleted");
  /**
   * Two maps, because two questions.
   *
   * Dependencies and parents are between TASKS: a task cannot be blocked by a decision record, and
   * a subtask's parent is a task. Links cross kinds on purpose — `tm link <id> relates to ADR-0002`
   * is accepted, because `addLink` resolves any kind.
   *
   * One map served both for a while, which was wrong in both directions in turn. Tasks-only called
   * an accepted link dangling; everything-linkable stopped noticing `blockedBy: ["ADR-0002"]`,
   * which is a dependency on something that can never satisfy it. Widening the audit to fix the
   * first quietly loosened three checks that wanted the narrow set.
   */
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const linkable = new Map(
    [...tasks, ...list("epic", {}, p), ...list("adr", {}, p), ...list("capability", {}, p)].map((e) => [e.id, e]),
  );
  const epics = new Set(list("epic", {}, p).map((e) => e.id));
  const sprints = new Set(list("sprint", {}, p).map((s) => s.id));
  const cfg = config(p);
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
      const other = linkable.get(link.id);
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

    if (t.sprint && !sprints.has(t.sprint)) {
      out.push(
        finding("error", "dangling-sprint", t.id, `sprint ${t.sprint} does not exist`, () => {
          update(t.id, { sprint: undefined }, p);
          return `cleared ${t.id}.sprint`;
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

    /**
     * Completeness, audited after the fact.
     *
     * gateStart/gateDone refuse a task that is missing its required fields, but harness-mirror
     * transitions bypass the gates by design — a mirror must not fight the harness it reflects —
     * and `tm override` and hand edits go around them too. The gates keep the record complete at
     * write time; this is the net under everything that walked around them.
     *
     * Report-only, like done-unmet: doctor knows a field is absent, not what belongs in it.
     * Writing a body or an evidence ref it invented would be forging the record, and reopening a
     * closed task is a decision. A warning, never an error: these tasks are untidy, not lying,
     * and an error level would flip doctor's exit code to 1 over history nobody can rewrite.
     */
    if (t.status === "done") {
      const missing = missingFields(t, cfg.requireOnDone || [], p);
      if (missing.length) {
        out.push(
          finding(
            "warning",
            "incomplete-done",
            t.id,
            `done but missing ${missing.map((m) => m.field).join(", ")} — ${missing.map((m) => m.hint).join("; ")}`,
          ),
        );
      }
    } else if (t.status === "open" || t.status === "in_progress") {
      const missing = missingFields(t, cfg.requireOnStart || [], p);
      if (missing.length) {
        out.push(
          finding(
            "warning",
            "incomplete-open",
            t.id,
            `${t.status} but missing ${missing.map((m) => m.field).join(", ")} — ${missing.map((m) => m.hint).join("; ")}`,
          ),
        );
      }
    }

    for (const ref of t.evidence || []) {
      if (!checkable(ref)) continue;
      if (existsSync(evidenceTarget(ref, p))) continue;
      out.push(
        finding("warning", "missing-evidence", t.id, `evidence ${ref} is recorded but the file is gone`, () => {
          update(t.id, { evidence: (t.evidence || []).filter((e) => e !== ref) }, p);
          return `dropped ${ref} from ${t.id}.evidence`;
        }),
      );
    }
  }

  /**
   * The store's git contract.
   *
   * A board with no `.gitignore` leaves its cache, its session claims and a dashboard's pid sitting
   * in `git status` forever — and one `git add -A` later they are committed and conflicting on
   * every pull. Stores created before `tm init` seeded these files have no way to learn about them
   * except here.
   */
  for (const [key, name, why] of [
    ["gitignore", ".gitignore", "its cache, session claims and dashboard pid will land in git"],
    ["gitattributes", ".gitattributes", "every branch that adds events will conflict on events.jsonl"],
    ["bytedeskGitignore", ".bytedesk/.gitignore", "tm worktrees under .bytedesk/worktrees/ will land in git"],
  ]) {
    const missing = missingContractRules(p, key);
    if (!missing.length) continue;
    const absent = !existsSync(p[key]);
    out.push(
      finding(
        "warning",
        absent ? "no-git-contract" : "stale-git-contract",
        null,
        absent
          ? `the store has no ${name} — ${why}`
          : // A contract that exists is not a contract that is current. Rules added to the template
            // after a store was created never reached it, and the file's existence made doctor say
            // it was fine — which is how every pre-0.5.0 store kept committing port.assigned.
            `${name} predates ${missing.length} rule(s) this version ships: ${missing.join(", ")}`,
        () => {
          // Only its own file: two findings sharing one fix made the second report "nothing missing".
          const written = seedGitContract(p, key);
          return written.length ? `updated ${written.join(", ")}` : `${name} is already current`;
        },
      ),
    );
  }

  /**
   * Project-local command migration.
   *
   * Generated launchers are per-machine and gitignored (the store's `bin` entry), so a
   * clone re-bootstraps them with `tm init` rather than carrying them. A plugin update
   * may make an older generated body stale; that is safe to overwrite.
   * A file without our marker is somebody else's and is reported without a fix.
   */
  const launchers = launcherStatus(p.root);
  if (launchers.conflicts.length) {
    out.push(
      finding(
        "error",
        "project-launcher-conflict",
        null,
        `${launchers.conflicts.map((entry) => entry.file).join(", ")} exist but were not generated by task-management — refusing to overwrite them`,
      ),
    );
  } else if (!launchers.current) {
    out.push(
      finding(
        "warning",
        "project-launchers",
        null,
        `${launchers.pending.length} project launcher(s) are missing or stale under .bytedesk/task-management/bin`,
        () => {
          const written = writeLaunchers(p.root);
          return written.length ? `wrote ${written.length} project-local launchers` : "project-local launchers are current";
        },
      ),
    );
  }

  const oldLaunchers = legacyProjectLaunchers(p.root);
  if (oldLaunchers.owned.length) {
    out.push(
      finding(
        "warning",
        "legacy-project-launchers",
        null,
        `${oldLaunchers.owned.length} generated launcher(s) remain under the old .bytedesk/bin path`,
        () => `removed ${removeOwnedLegacyProjectLaunchers(p.root).length} old project launcher(s)`,
      ),
    );
  }
  if (oldLaunchers.foreign.length) {
    out.push(
      finding(
        "warning",
        "legacy-project-launcher-conflict",
        null,
        `${oldLaunchers.foreign.map((entry) => entry.file).join(", ")} use the old launcher path but are not task-management generated files — left untouched`,
      ),
    );
  }

  let hasLegacyAutolink = false;
  try {
    const stored = JSON.parse(readFileSync(p.config, "utf8"));
    hasLegacyAutolink = Object.prototype.hasOwnProperty.call(stored?.plugin || {}, "autolink");
  } catch {
    // Existing config diagnostics own malformed JSON; do not invent a destructive migration here.
  }

  // A real pre-migration board materialised plugin.autolink into config.json. Requiring that
  // provenance prevents an unrelated project's doctor run from claiming a machine-level command
  // merely because the same user once installed task-management elsewhere.
  const globalLinks = hasLegacyAutolink ? ownedLegacyGlobalLinks() : [];
  if (globalLinks.length) {
    out.push(
      finding(
        "warning",
        "legacy-global-links",
        null,
        `${globalLinks.length} task-management PATH link(s) remain from the global command model`,
        () => `removed ${removeOwnedLegacyGlobalLinks().length} owned global link(s); foreign PATH commands were not touched`,
      ),
    );
  }

  if (hasLegacyAutolink) {
    out.push(
      finding(
        "warning",
        "legacy-autolink-config",
        null,
        "config.json still declares plugin.autolink, which no longer has a global PATH target",
        () => (removeConfigKey("plugin.autolink", p) ? "removed plugin.autolink and preserved its sibling settings" : "plugin.autolink was already absent"),
      ),
    );
  }

  const codexHooks = legacyCodexHooks(p.root);
  if (codexHooks.count) {
    out.push(
      finding(
        "warning",
        "legacy-codex-hooks",
        null,
        `${codexHooks.count} Codex hook command(s) still invoke a global or old-path tm-hook`,
        () => `rewrote ${rewriteLegacyCodexHooks(p.root)} Codex hook command(s) to .bytedesk/task-management/bin/tm-hook`,
      ),
    );
  }

  /**
   * The stored identity no longer matches git.
   *
   * A repo gets renamed or moved between owners, and the board would otherwise re-label itself
   * without a word — every entity created before the move keeps the old id and starts reading as
   * foreign. Saying it is the whole fix: which of the two is right is a decision, not a repair.
   */
  const identity = boardIdentity(p);
  if (identity.drifted) {
    out.push(
      finding(
        "warning",
        "board-renamed",
        null,
        `git says this project is ${identity.id}, but the store recorded ${identity.stored} — ` +
          `entities created before the move still carry the old board. ` +
          `\`.bytedesk/task-management/bin/tm config boardId\` cannot fix it: identity is derived, not declared.`,
      ),
    );
  }

  /**
   * An entity filed on another board.
   *
   * Not hypothetical: the write path had no such check, so a session whose store resolved to one
   * repo while its shell sat in another could file work into the wrong project entirely. The write
   * is refused now, but stores already carrying a stray have to be able to find it.
   */
  // The store's own history counts as its own, including the name it had before a rename.
  const ours = new Set([identity.id, identity.stored].filter(Boolean));
  const board = identity.id;
  if (board) {
    for (const t of [...live, ...list("epic", {}, p)]) {
      if (!t.board || ours.has(t.board)) continue;
      out.push(
        finding(
          "error",
          "foreign-entity",
          t.id,
          `belongs to ${t.board}, but this store is ${board} — it was filed here by a write that crossed repos`,
        ),
      );
    }
  }

  // The other half of the contract: the store has to actually reach git.
  const ignored = ignoreRule(p);
  if (ignored) {
    out.push(
      finding(
        "error",
        "store-ignored",
        null,
        `the store is ignored by git — ${ignored} keeps the tasks out of every clone and out of CI. ` +
          `Narrow that rule so .bytedesk/task-management/ is committed; the store's own .gitignore ` +
          `already excludes the per-machine files.`,
      ),
    );
  }

  // Being ignored is no help once a file is already tracked: git keeps carrying it.
  // The fix is `git rm --cached`, not a hint — SessionStart and `tm init` run the
  // same repair so a plugin update untracks host files without anyone typing it.
  for (const rel of trackedHostFiles(p)) {
    const name = basename(rel);
    out.push(
      finding(
        "warning",
        "tracked-cache",
        null,
        `${name} is tracked by git — it is per-machine, so it will conflict on every pull`,
        () => {
          const gone = untrackHostFiles(p, [rel]);
          return gone.length ? `untracked ${name}` : `${name} is already untracked`;
        },
      ),
    );
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

  // An epic marked done with live children, and a closed date on open work. Both are what a
  // reopen used to leave behind, and both survive a hand edit or a merge, so they are checked
  // rather than merely prevented. This is the first check that needs an epic's status and not
  // just its id.
  for (const e of list("epic", {}, p)) {
    if (e.status !== "done") continue;
    const live = list("task", { epic: e.id }, p).filter((t) => !RESOLVED.has(t.status));
    if (!live.length) continue;
    out.push(
      finding(
        "error",
        "epic-done-open-children",
        e.id,
        `epic is done but ${live.length} of its tasks are not: ${live.map((t) => t.id).join(", ")}`,
        () => {
          reopenEpic(e.id, p);
          return `reopened ${e.id}`;
        },
      ),
    );
  }
  for (const t of live.filter((x) => x.closed && !RESOLVED.has(x.status))) {
    out.push(
      finding(
        "warning",
        "closed-on-open-task",
        t.id,
        `carries closed: ${t.closed} while its status is ${t.status} — exports report a resolution date on open work`,
        () => {
          update(t.id, { closed: undefined }, p);
          return `dropped closed from ${t.id}`;
        },
      ),
    );
  }

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

  // Report-only: a missing epic.plan file, or a file in plans/ no epic points at.
  // Never delete — the plan may be the only copy of the approved work.
  out.push(...planFindings(p, finding));

  // The cache is disposable, but a stale one makes the dashboard and the CLI disagree.
  const drift = indexDrift(p, live);
  if (drift) {
    out.push(
      finding("warning", "index-drift", null, drift, () => {
        const idx = reindex(p);
        return `reindexed ${idx.epics.length} epics, ${idx.tasks.length} tasks, ${idx.adrs.length} adrs, ${(idx.sprints || []).length} sprints, ${idx.capabilities.length} capabilities`;
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
    if (fixable) out.push(`${fixable} of ${findings.length} can be repaired automatically — \`.bytedesk/task-management/bin/tm doctor --fix\``);
  }
  return out.join("\n").trimEnd();
}
