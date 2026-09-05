/**
 * The governed operations a planning session may propose, and the only way it may apply them.
 *
 * Three properties, and each exists because the alternative is a real failure:
 *
 *   1. **An allowlist, not an interpreter.** A planner proposes operations by NAME from the table
 *      below. It never supplies a function, a path, or a store call. Anything not in the table is
 *      refused, so the blast radius of a model that has read an untrusted attachment is the set of
 *      things listed here rather than the set of things `lib/` can do.
 *   2. **Preview and apply are the same code.** `previewOps` runs the validation half; `applyOps`
 *      runs it again and then writes. An approval card that describes something other than what
 *      lands is worse than no approval card, so the description cannot come from a second
 *      implementation that might drift.
 *   3. **Approval is bound to the exact operations.** `applyOps` takes the digest the operator
 *      approved and recomputes it. Approving five tasks and applying six is the failure this
 *      closes, and it is invisible without the check.
 *
 * Writes go through the store's own functions and gates — `create`, `update`, `mutate`,
 * `dependencies`, `gateTaskCreate` — never the filesystem. A refusal is passed through verbatim
 * because the operator is entitled to the store's own wording, not a paraphrase of it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { consumeOverride, gateTaskCreate } from "./enforce.mjs";
import { dependencies } from "./issue.mjs";
import { paths } from "./paths.mjs";
import { create, fileFor, kindOf, list as listRecords, logEvent, read, reindex, state, withLock, write, writeState } from "./store.mjs";

const err = (message, status) => Object.assign(new Error(message), { status });

const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

/**
 * Every operation a planner may propose.
 *
 * `describe` is what the operator reads on the approval card, so it names the real consequence in
 * words rather than restating the arguments. `check` is the validation, and it may only READ.
 * `apply` does the write, and receives the ids minted earlier in the same proposal so a task can
 * be attached to an epic this proposal is creating.
 *
 * Deliberately absent, and each for a reason: nothing deletes, nothing transitions a task to done,
 * nothing dispatches or spawns a worker, and nothing writes config or state beyond the active
 * epic. A planning conversation proposes work; it does not complete work, and it does not decide
 * what this machine is allowed to run.
 */
export const OPERATIONS = {
  "epic.create": {
    summary: "Create an epic",
    creates: true,
    kind: "epic",
    describe: (a) => `Adds a new independently reviewable epic "${str(a.title)}" to the shared task store.`,
    check(args) {
      if (!str(args.title)) return "an epic needs a title";
      if (str(args.title).length > 200) return "an epic title is a line, not a paragraph";
      return null;
    },
    apply(args, ctx) {
      const epic = create("epic", { title: str(args.title), ...ctx.stamp }, str(args.body), ctx.p);
      ctx.mint(args.ref, epic.id);
      return { id: epic.id, kind: "epic", title: epic.title };
    },
  },

  "epic.activate": {
    summary: "Make an epic active",
    describe: (a) => `Makes ${a.epic || "the new epic"} the active epic, so new work lands under it.`,
    check(args, ctx) {
      const id = ctx.resolve(args.epic);
      if (!id) return "epic.activate needs an epic id or a ref to one this proposal creates";
      return epicMustExist(id, ctx);
    },
    apply(args, ctx) {
      const id = ctx.resolve(args.epic);
      // Last line of defence. `activeEpic` is read by every later create, on this surface and off
      // it, so writing an unresolved ref there poisons the board rather than failing one operation.
      if (kindOf(id) !== "epic") {
        throw err(`epic.activate resolved "${args.epic}" to "${id}", which is not an epic id`, 409);
      }
      ctx.rememberActiveEpic();
      writeState({ activeEpic: id }, ctx.p);
      return { id, kind: "epic", activated: true };
    },
  },

  "task.create": {
    summary: "Create a task",
    creates: true,
    kind: "task",
    describe: (a) => {
      const n = list(a.acceptance).length;
      return `Creates "${str(a.title)}" with ${n} acceptance ${n === 1 ? "criterion" : "criteria"}` +
        `${a.epic ? ` under ${a.epic}` : " with no epic"}. It is gated on ${n === 1 ? "it" : "them"} and cannot be closed without ${n === 1 ? "it" : "them"}.`;
    },
    check(args, ctx) {
      if (!str(args.title)) return "a task needs a title";
      if (!str(args.body)) return "a task needs a body — the gate requires one at create";
      if (!list(args.acceptance).length) {
        // The store's own rule, stated here so the refusal arrives at preview rather than at apply:
        // a task with an empty acceptance list passes `tm done` unchallenged.
        return "a task needs acceptance criteria — without them the gate certifies work nobody verified";
      }
      const epic = args.epic ? ctx.resolve(args.epic) : null;
      if (args.epic && !epic) return `unknown epic reference: ${args.epic}`;
      // An id that exists is not the same as an epic. Without the kind check a task could be
      // parented to another TASK — the board would accept it and the hierarchy would be quietly
      // wrong, which nothing downstream is built to notice.
      const epicProblem = epic ? epicMustExist(epic, ctx) : null;
      if (epicProblem) return epicProblem;
      // The board's own create gate, with the real draft, so its wording is what the operator sees.
      //
      // Every refusal it gives is honoured EXCEPT the one that says there is no active epic, and
      // only when this proposal supplies an epic itself — a proposal that creates its own epic and
      // files tasks under it is not the situation that rule is about.
      //
      // It used to discard the refusal whenever an epic existed, which quietly let the planner
      // walk past the WIP limit and the required-field checks: the board refused, the card said
      // "validated", and the task was created anyway. A governed surface that ignores the gates
      // the ungoverned CLI obeys is not governed.
      // `consume: false`, and it is load-bearing. `check` is documented read-only, and it was not:
      // `gateTaskCreate` SPENDS the operator's one-shot override at each of its refusal points, so
      // merely previewing a proposal wrote board state and logged `override_used` — the one write
      // the read-only planner profile exists to make impossible. It also broke every proposal that
      // needed the override: the preview ate the token, the card said "validated", and the apply
      // then refused, or rolled back mid-way. And the page re-proposes on every load, so a refresh
      // burnt it. The token is spent at APPLY now, inside the lock, once per operation that needed
      // it.
      const gate = gateTaskCreate(
        ctx.p,
        { body: str(args.body), acceptance: list(args.acceptance).map((text) => ({ text, done: false })) },
        // `haveEpic` rather than reading the refusal text and forgiving it. The active-epic check
        // RETURNS, so suppressing its message at this end meant the completeness and WIP gates
        // below it were never reached: with no active epic, a proposal naming an existing epic
        // validated past both. Telling the gate the epic is supplied lets it skip that one rule
        // and run the rest.
        { consume: false, haveEpic: Boolean(epic) },
      );
      if (gate.allow && gate.override) ctx.owesOverride = true;
      return gate.allow ? null : gate.reason;
    },
    apply(args, ctx) {
      const task = create(
        "task",
        {
          title: str(args.title),
          // NEVER `state(ctx.p).activeEpic` as a fallback. `resolveDestinations` has already made
          // an implicit destination explicit, using the active epic as it stood when the card was
          // written. Reading live state here re-opened the hole that was supposed to close: with
          // no active epic at preview the card said "with no epic", and an `epic.activate` earlier
          // in the same approved set then sent the task somewhere the operator was never shown.
          epic: args.epic ? ctx.resolve(args.epic) : null,
          acceptance: list(args.acceptance).map((text) => ({ text, done: false })),
          touches: list(args.touches).length ? list(args.touches) : undefined,
          labels: list(args.labels),
          evidence: [],
          commits: [],
          blockedBy: [],
          blocks: [],
          ...ctx.stamp,
        },
        str(args.body),
        ctx.p,
      );
      ctx.mint(args.ref, task.id);
      return { id: task.id, kind: "task", title: task.title };
    },
  },

  "task.depends": {
    summary: "Order two tasks",
    describe: (a) => `Blocks ${a.task} on ${list(a.on).join(", ")}, so it cannot start until they are done.`,
    check(args, ctx) {
      const mine = ctx.resolve(args.task);
      if (!mine) return "task.depends needs a task";
      const on = list(args.on).map((d) => ctx.resolve(d)).filter(Boolean);
      if (!on.length) return "task.depends needs at least one blocker that exists in this proposal or on the board";
      if (on.includes(mine)) return `${mine} cannot depend on itself`;
      // Every id named here has to be real, and it has to be real NOW. Without this the preview
      // said "ok", showed the operator a consequence naming a task that does not exist, and only
      // failed once the write was under way — so the approval was granted against a description
      // the apply could not honour. A preview that disagrees with the apply is worse than none.
      for (const id of [mine, ...on]) {
        if (ctx.pending.has(id)) continue;
        if (kindOf(id) !== "task") return `${id} is not a task id`;
        if (!read(id, ctx.p)) return `no such task: ${id}`;
      }
      // `dependencies()` refuses an edge that closes a loop, and this operation used to write its
      // edges with a raw `mutate` that walked straight past that refusal — so a proposal could
      // land a cycle the CLI would not accept, and `tm doctor` deliberately will not repair one
      // because which edge to cut is a judgement. Checked here, at preview, against the board's
      // edges AND the ones earlier operations in this same proposal add, so the operator is never
      // asked to approve a set that the apply is going to refuse halfway through.
      const cycle = wouldCycle(mine, on, ctx, ctx.p);
      if (cycle) return cycle;
      ctx.edges.set(mine, [...(ctx.edges.get(mine) || []), ...on]);
      return null;
    },
    apply(args, ctx) {
      const mine = ctx.resolve(args.task);
      const on = [...new Set(list(args.on).map((d) => ctx.resolve(d)).filter(Boolean))];
      // Both sides of the edge are written, so both are snapshotted first — including any that
      // this proposal did not create and must therefore be put back exactly as it was.
      for (const id of [mine, ...on]) ctx.touch(id);
      // The store's own writer, not a hand-rolled pair of mutates: it refuses a cycle, writes both
      // ends of every edge, moves an open task to blocked, and logs `dep`. Every one of those was
      // reimplemented here except the refusal and the log, which is exactly the sort of divergence
      // that lets a governed surface do what the CLI will not.
      const blockedBy = dependencies(mine, { add: on }, ctx.p);
      return { id: mine, kind: "task", blockedBy };
    },
  },
};

/**
 * Where a landing in progress records what it has done so far.
 *
 * Lives under `planner/`, which the store already keeps out of git — this is machine-local
 * recovery state, not board history.
 */
export function journalPath(p = paths()) {
  return join(p.base, "planner", "apply-journal.json");
}

/**
 * Undo a landing from the record of what it did: remove what it created, put back what it
 * modified, restore the active epic.
 *
 * Taken out of the catch block so a landing that never REACHED its catch — a kill, a power cut —
 * can be undone by the next process from the journal instead. The two callers must do the same
 * thing or "all of it or none of it" is only true for the failures that happen to throw.
 */
function undoLanding({ created = [], touched = [], previousActiveEpic }, p) {
  for (const id of [...created].reverse()) {
    try {
      const file = fileFor(id, p);
      if (file && existsSync(file)) unlinkSync(file);
    } catch {
      /* best effort; the rollback event records what was meant to go */
    }
  }
  // Records this proposal MODIFIED go back as they were. Removing what was created while leaving
  // edits to what already existed is the half-undo that makes a board look fine and be wrong — a
  // pre-existing task left blocked on an id that was just deleted.
  for (const doc of touched) {
    try {
      // WITH its `file`. Stripping it made `write` derive a path from the title instead, and a
      // task whose title had been edited since its file was named then restored to a SECOND file:
      // two files for one id, the index counting both, and the original left carrying the edit
      // this rollback exists to undo. A restore has to go back where it came from.
      write(doc, p);
    } catch {
      /* best effort, same as above; the rollback event names what was touched */
    }
  }
  try {
    if (previousActiveEpic !== undefined) writeState({ activeEpic: previousActiveEpic }, p);
    reindex(p);
  } catch {
    /* the index is a cache; `tm reindex` recovers it */
  }
}

/**
 * Undo a landing that never finished, from the journal it left behind.
 *
 * The compensation in `applyOps` runs in a `catch`, so it covers a landing that THROWS and nothing
 * else. Kill the process after the epic is activated and the first task written and those records
 * survived for ever: half an approved proposal on the board, no error anywhere, and a session
 * marked "applying" that could say nothing about what had already landed. Records are written one
 * file at a time and nothing makes that a single atomic act, so the honest fix is to write down
 * the intent first and undo it on the next run rather than to claim a transaction the filesystem
 * is not giving us.
 *
 * Called before any new landing and by the route that reopens a stranded session, so recovery
 * happens at the next attempt rather than needing a daemon.
 */
export function recoverInterruptedApply(p = paths()) {
  const file = journalPath(p);
  if (!existsSync(file)) return null;
  let journal = null;
  try {
    journal = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* an unreadable journal still has to go, or every later apply trips over it */
  }
  try {
    unlinkSync(file);
  } catch {
    /* if it cannot be removed the undo below would repeat; the log says what happened */
  }
  if (!journal || !Array.isArray(journal.created)) return null;

  // The journal is rewritten AFTER each operation, so a kill in the window between a record being
  // written and the journal naming it would leave one orphan behind. It is findable: the landing
  // held the store lock, so nothing else created anything while it ran, and every record stamped
  // at or after the moment the journal was opened belongs to it.
  const orphans = journal.started
    // `listRecords`, not the local `list` — that one coerces a value to an array of strings, and
    // calling it here silently returned the kind names themselves and swept nothing.
    ? ["epic", "task"]
        .flatMap((kind) => listRecords(kind, {}, p))
        .filter((row) => row.created && row.created >= journal.started)
        .map((row) => row.id)
        .filter((id) => !journal.created.includes(id))
    : [];
  undoLanding({ ...journal, created: [...journal.created, ...orphans] }, p);
  logEvent(
    "planner_apply_recovered",
    { session: journal.session ?? null, digest: journal.digest ?? null, removed: journal.created.length + orphans.length, ids: [...journal.created, ...orphans] },
    p,
  );
  const ids = [...journal.created, ...orphans];
  return { removed: ids.length, ids, session: journal.session ?? null };
}

/**
 * Would blocking `task` on `on` close a dependency loop?
 *
 * Walks what each blocker is itself waiting on — through the board and through the edges this
 * proposal has already declared — and reports the first path that arrives back at `task`. Same
 * search `dependencies()` runs, extended to the operations that have not been written yet.
 */
function wouldCycle(task, on, ctx, p) {
  const waitsOn = (id) => [...(read(id, p)?.blockedBy || []), ...(ctx.edges.get(id) || [])];
  for (const start of on) {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === task) return `${task} depending on ${start} would create a dependency cycle`;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...waitsOn(cur));
    }
  }
  return null;
}

/**
 * An epic reference resolves to an epic that exists — or to one this proposal is creating.
 *
 * Both halves matter. `read()` alone would accept any id that happens to be on the board, and the
 * board holds tasks, ADRs and sprints too.
 */
function epicMustExist(id, ctx) {
  if (ctx.pending.has(id)) {
    // A ref this proposal declares, but declared by WHAT? `pending` used to be a bare set of
    // names, so `{op:"task.create",args:{ref:"parent"}}` followed by `{op:"task.create",
    // args:{epic:"parent"}}` previewed as valid and put "under parent." on the card. It failed in
    // the lock once the id was minted — safe, but the operator had already approved a set the
    // server called valid, which is the thing a preview exists to prevent.
    const kind = ctx.pending.get(id);
    return kind === "epic" ? null : `${id} is created by this proposal as a ${kind || "non-epic"}, not an epic`;
  }
  if (kindOf(id) !== "epic") return `${id} is not an epic id`;
  if (!read(id, ctx.p)) return `no such epic: ${id}`;
  return null;
}

/**
 * A stable digest of exactly what is being proposed.
 *
 * It is what binds an approval to a set of operations. Recomputed at apply and compared with the
 * digest the operator approved, so a proposal cannot be edited between the confirmation dialog and
 * the write. Key order is normalised, because `{a,b}` and `{b,a}` are the same proposal and must
 * not produce different digests.
 */
export function digestOps(ops) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(norm(ops))).digest("hex");
}

/** Shared context for check and apply: ref resolution, minted ids, the stamp. */
function makeContext(ops, p, stamp) {
  const minted = new Map();
  const touched = new Map(); // id -> the document as it was before this proposal changed it
  // Refs a proposal declares for itself, known before anything is created so `check` can resolve
  // a forward reference the same way `apply` will.
  // ref -> the kind the operation that declares it creates. A Set lost that, so an epic reference
  // pointing at a ref declared by `task.create` passed preview ("…under parent.") and only failed
  // in the lock, once the id was minted — the operator had already approved a set the server had
  // called valid.
  const pending = new Map(
    ops
      .filter((op) => str(op.args?.ref))
      .map((op) => [str(op.args.ref), OPERATIONS[str(op.op)]?.kind ?? null]),
  );
  // Edges this proposal adds, so a cycle check at preview sees the whole picture rather than only
  // what is already on disk. Keyed by the blocked task; values may be refs, which is fine — an
  // unresolvable ref simply has no edges of its own on the board.
  const edges = new Map();
  // Set by a `check` that only came out `allow` because the operator holds a one-shot override.
  // `check` no longer spends it; the apply loop does, inside the lock, once per operation that
  // needed it — so a preview costs nothing and an approved set pays exactly what it uses.
  let owesOverride = false;
  let previousActiveEpic;
  return {
    p,
    stamp,
    pending,
    minted,
    edges,
    resolve(ref) {
      const r = str(ref);
      if (!r) return null;
      return minted.get(r) || (pending.has(r) ? r : r);
    },
    mint(ref, id) {
      if (str(ref)) minted.set(str(ref), id);
    },
    rememberActiveEpic() {
      if (previousActiveEpic === undefined) previousActiveEpic = state(p).activeEpic ?? null;
    },
    /**
     * Snapshot a record this proposal is about to MODIFY but did not create.
     *
     * Rollback used to remove created records and stop there, so an operation that edited an
     * existing task left that edit behind: `task.depends` writes both sides of an edge, and a
     * later failure deleted the new task while the pre-existing one stayed blocked on an id that
     * no longer resolved. Undoing half a transaction is worse than not having one, because the
     * board looks fine and is wrong.
     */
    touch(id) {
      if (!id || minted.has(id) || [...minted.values()].includes(id) || touched.has(id)) return;
      const doc = read(id, p);
      if (doc) touched.set(id, doc);
    },
    get touched() {
      return touched;
    },
    get previousActiveEpic() {
      return previousActiveEpic;
    },
    get owesOverride() {
      return owesOverride;
    },
    set owesOverride(v) {
      owesOverride = Boolean(v);
    },
  };
}

function normalizeOps(ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw err("a proposal needs at least one operation", 400);
  if (ops.length > 100) throw err("a proposal of more than 100 operations is not one reviewable decision", 400);
  // A ref must be declared by a CREATING operation, and declared before it is used. Neither held
  // before: `pending` was every `ref` in the proposal regardless of which operation owned it, and
  // regardless of order — so `[epic.activate {epic:"E"}, epic.create {ref:"E"}]` passed preview,
  // and apply wrote the literal string "E" into `activeEpic` because nothing had minted it yet.
  // Every task created afterwards, by the planner or the CLI or the board, then inherited an epic
  // that does not exist.
  const declared = new Set();
  ops.forEach((op, i) => {
    const name = str(op?.op);
    const ref = str(op?.args?.ref);
    const spec = OPERATIONS[name];
    if (ref && !spec?.creates) {
      throw err(`operation ${i + 1}: only an operation that creates something may declare a ref.`, 400);
    }
    if (ref) declared.add(ref);
    for (const [field, value] of Object.entries(op?.args ?? {})) {
      if (field === "ref") continue;
      for (const used of (Array.isArray(value) ? value : [value])) {
        const u = str(used);
        // A value is a forward reference only if some later operation declares it. Anything else
        // is a board id and is checked by the operation's own `check`.
        if (!u || declared.has(u)) continue;
        const laterOwner = ops.findIndex((o, j) => j > i && str(o?.args?.ref) === u);
        if (laterOwner !== -1) {
          throw err(
            `operation ${i + 1}: "${u}" is created by operation ${laterOwner + 1}, which runs after it. Order a proposal so nothing refers to something that does not exist yet.`,
            400,
          );
        }
      }
    }
  });
  return ops.map((op, i) => {
    const name = str(op?.op);
    if (!OPERATIONS[name]) {
      throw err(
        `operation ${i + 1}: "${name || "(none)"}" is not a governed planning operation. Allowed: ${Object.keys(OPERATIONS).join(", ")}.`,
        400,
      );
    }
    const args = op.args && typeof op.args === "object" ? op.args : {};
    // A ref is a name local to this proposal, and it must not look like a board id. `ref: "EP-001"`
    // would shadow the real EP-001 for the rest of the proposal — every later reference resolves to
    // the newly minted one — so the operator reads "under EP-001" on the card and something else
    // happens. Ambiguity here is worth refusing outright rather than resolving cleverly.
    if (str(args.ref) && kindOf(str(args.ref))) {
      throw err(`operation ${i + 1}: ref "${args.ref}" is shaped like a board id; a ref is a local name for something this proposal creates.`, 400);
    }
    return { op: name, args };
  });
}

/**
 * What this proposal would do, and whether it would be allowed — without doing any of it.
 *
 * Every operation gets a verdict, so an operator sees the whole set rather than only the first
 * problem. `ok` is the answer to "may this be applied", and it is false if any single operation is
 * invalid: a proposal is one reviewable decision and lands whole or not at all.
 */
/**
 * Make every implicit destination explicit, before the proposal is digested or described.
 *
 * `task.create` with no `epic` used to mean "wherever the active epic points WHEN THIS IS
 * APPLIED" — so approving a task under EP-001 and landing it under EP-002 required nothing more
 * than the active epic moving in between, and the digest did not change because the destination
 * was never in the operations. Resolving it here puts it inside what is digested, named on the
 * card, and applied.
 */
function resolveDestinations(ops, p) {
  const active = state(p).activeEpic || null;
  return ops.map((op) => {
    if (op.op !== "task.create") return op;
    // Already explicit, or there is nothing to be explicit about.
    if (str(op.args.epic) || !active) return op;
    return { ...op, args: { ...op.args, epic: active } };
  });
}

export function previewOps(ops, p = paths()) {
  const normalized = resolveDestinations(normalizeOps(ops), p);
  const ctx = makeContext(normalized, p, {});
  const operations = normalized.map((op, index) => {
    const spec = OPERATIONS[op.op];
    let problem = null;
    try {
      problem = spec.check(op.args, ctx) || null;
    } catch (e) {
      problem = e.message;
    }
    return {
      index: index + 1,
      op: op.op,
      summary: spec.summary,
      // The words the operator reads. Named consequence, not a restatement of the arguments.
      consequence: spec.describe(op.args),
      args: op.args,
      valid: !problem,
      // Verbatim. The store's own refusal, not a paraphrase of it.
      refusal: problem,
    };
  });
  return {
    digest: digestOps(normalized),
    ok: operations.every((o) => o.valid),
    operations,
    // What was actually judged, with implicit destinations filled in. A caller that stores a
    // proposal must store THIS, not what it was handed — otherwise the digest covers one thing
    // and the operations say another.
    resolved: normalized,
  };
}

/**
 * Apply an approved proposal, all of it or none of it.
 *
 * `approvedDigest` is required and is recomputed here. Without it, "approve five, apply six" is
 * invisible: the confirmation names one set and the write performs another, and every audit record
 * afterwards agrees with the write.
 *
 * Rollback follows the same discipline as a manifest import. One lock across the landing so
 * nothing interleaves; every created id remembered and removed on failure; the active epic put
 * back; the index rebuilt rather than restored, because it is a cache `reindex` derives from the
 * files. The event log is never rewound — it is append-only and a concurrent writer may have
 * appended since — so a failure appends `planner_apply_rolled_back` naming what it removed.
 */
export function applyOps(ops, { approvedDigest, session = null, stamp = {} } = {}, p = paths()) {
  // Resolved the same way the preview did. A proposal stored from `preview.resolved` already has
  // its destinations explicit, so this is a no-op for it — and a caller that passes raw operations
  // still gets a digest computed over the same shape rather than a mismatch.
  const normalized = resolveDestinations(normalizeOps(ops), p);
  const digest = digestOps(normalized);
  if (!approvedDigest) throw err("applying a proposal needs the digest the operator approved", 400);
  if (approvedDigest !== digest) {
    throw err(
      "this proposal is not the one that was approved — it changed after approval, so nothing was applied. Review it again.",
      409,
    );
  }

  const preview = previewOps(normalized, p);
  if (!preview.ok) {
    const first = preview.operations.find((o) => !o.valid);
    throw err(`operation ${first.index} (${first.op}) cannot be applied: ${first.refusal}`, 409);
  }

  return withLock(p, () => {
    // A landing that was killed rather than thrown out of leaves its journal behind; undo it
    // before starting another, so the board is never carrying half of an older proposal.
    recoverInterruptedApply(p);

    const ctx = makeContext(normalized, p, stamp);
    const created = [];
    const results = [];
    // The intent, written BEFORE the first record. Files are written one at a time and nothing
    // makes that atomic, so the only way "all of it or none of it" survives a kill is to leave
    // behind enough to undo it: what has been created so far, and the originals of everything
    // modified. Rewritten after each operation, removed when the landing settles either way.
    const journal = () => {
      try {
        mkdirSync(dirname(journalPath(p)), { recursive: true });
        writeFileSync(
          journalPath(p),
          `${JSON.stringify({ session, digest, started: new Date().toISOString(), created, touched: [...ctx.touched.values()], previousActiveEpic: ctx.previousActiveEpic })}\n`,
        );
      } catch {
        /* a journal we cannot write is not a reason to refuse the write the operator approved */
      }
    };
    journal();
    try {
      for (const op of normalized) {
        const spec = OPERATIONS[op.op];
        ctx.owesOverride = false;
        const problem = spec.check(op.args, ctx);
        // Re-checked inside the lock: the board may have moved between preview and here, and a
        // proposal validated against a board that no longer exists is not validated.
        if (problem) throw err(`${op.op}: ${problem}`, 409);
        // A check that only passed on the strength of an override spends it HERE — at the write,
        // in the lock, one token per operation. If it is gone, the board has changed since the
        // approval and the whole set rolls back rather than landing half of it.
        if (ctx.owesOverride && !consumeOverride(p)) {
          throw err(`${op.op}: the one-shot override this proposal relied on is already spent — review it again`, 409);
        }
        const result = spec.apply(op.args, ctx);
        // ONLY an operation that declares `creates` registers an id here, and this is load-bearing.
        // `created` is the rollback list, so an operation that merely touches an existing record —
        // `task.depends` names the task it blocks — would otherwise put a task that was already on
        // the board onto the list of things to delete. A failed proposal would then destroy work
        // nobody proposed changing.
        if (spec.creates && result?.id) created.push(result.id);
        results.push({ op: op.op, ...result });
        journal();
      }
      logEvent("planner_applied", { session, digest, operations: normalized.length, created }, p);
      return { digest, applied: results, created };
    } catch (cause) {
      undoLanding({ created, touched: [...ctx.touched.values()], previousActiveEpic: ctx.previousActiveEpic }, p);
      logEvent(
        "planner_apply_rolled_back",
        { session, digest, removed: created.length, ids: created, restored: [...ctx.touched.keys()], why: cause?.message || String(cause) },
        p,
      );
      throw cause;
    } finally {
      try {
        if (existsSync(journalPath(p))) unlinkSync(journalPath(p));
      } catch {
        /* a journal that outlives its landing is undone by the next one, which is the safe way round */
      }
    }
  });
}
