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
import { existsSync, unlinkSync } from "node:fs";
import { gateTaskCreate } from "./enforce.mjs";
import { paths } from "./paths.mjs";
import { create, fileFor, kindOf, logEvent, mutate, read, reindex, state, withLock, writeState } from "./store.mjs";

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
      ctx.rememberActiveEpic();
      writeState({ activeEpic: id }, ctx.p);
      return { id, kind: "epic", activated: true };
    },
  },

  "task.create": {
    summary: "Create a task",
    creates: true,
    describe: (a) => {
      const n = list(a.acceptance).length;
      return `Creates "${str(a.title)}" with ${n} acceptance ${n === 1 ? "criterion" : "criteria"}` +
        `${a.epic ? ` under ${a.epic}` : ""}. It is gated on ${n === 1 ? "it" : "them"} and cannot be closed without ${n === 1 ? "it" : "them"}.`;
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
      const gate = gateTaskCreate(ctx.p, { body: str(args.body), acceptance: list(args.acceptance).map((text) => ({ text, done: false })) });
      if (!gate.allow && !epic && !state(ctx.p).activeEpic) return gate.reason;
      return null;
    },
    apply(args, ctx) {
      const task = create(
        "task",
        {
          title: str(args.title),
          epic: args.epic ? ctx.resolve(args.epic) : state(ctx.p).activeEpic || null,
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
      return null;
    },
    apply(args, ctx) {
      const mine = ctx.resolve(args.task);
      const on = [...new Set(list(args.on).map((d) => ctx.resolve(d)).filter(Boolean))];
      mutate(mine, (doc) => ({
        blockedBy: [...new Set([...(doc.blockedBy || []), ...on])],
        status: doc.status === "open" ? "blocked" : doc.status,
      }), ctx.p);
      for (const d of on) mutate(d, (doc) => ({ blocks: [...new Set([...(doc.blocks || []), mine])] }), ctx.p);
      return { id: mine, kind: "task", blockedBy: on };
    },
  },
};

/**
 * An epic reference resolves to an epic that exists — or to one this proposal is creating.
 *
 * Both halves matter. `read()` alone would accept any id that happens to be on the board, and the
 * board holds tasks, ADRs and sprints too.
 */
function epicMustExist(id, ctx) {
  if (ctx.pending.has(id)) return null;
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
  // Refs a proposal declares for itself, known before anything is created so `check` can resolve
  // a forward reference the same way `apply` will.
  const pending = new Set(ops.map((op) => str(op.args?.ref)).filter(Boolean));
  let previousActiveEpic;
  return {
    p,
    stamp,
    pending,
    minted,
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
    get previousActiveEpic() {
      return previousActiveEpic;
    },
  };
}

function normalizeOps(ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw err("a proposal needs at least one operation", 400);
  if (ops.length > 100) throw err("a proposal of more than 100 operations is not one reviewable decision", 400);
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
export function previewOps(ops, p = paths()) {
  const normalized = normalizeOps(ops);
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
  const normalized = normalizeOps(ops);
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
    const ctx = makeContext(normalized, p, stamp);
    const created = [];
    const results = [];
    try {
      for (const op of normalized) {
        const spec = OPERATIONS[op.op];
        const problem = spec.check(op.args, ctx);
        // Re-checked inside the lock: the board may have moved between preview and here, and a
        // proposal validated against a board that no longer exists is not validated.
        if (problem) throw err(`${op.op}: ${problem}`, 409);
        const result = spec.apply(op.args, ctx);
        // ONLY an operation that declares `creates` registers an id here, and this is load-bearing.
        // `created` is the rollback list, so an operation that merely touches an existing record —
        // `task.depends` names the task it blocks — would otherwise put a task that was already on
        // the board onto the list of things to delete. A failed proposal would then destroy work
        // nobody proposed changing.
        if (spec.creates && result?.id) created.push(result.id);
        results.push({ op: op.op, ...result });
      }
      logEvent("planner_applied", { session, digest, operations: normalized.length, created }, p);
      return { digest, applied: results, created };
    } catch (cause) {
      for (const id of created.reverse()) {
        try {
          const file = fileFor(id, p);
          if (file && existsSync(file)) unlinkSync(file);
        } catch {
          /* best effort; the rollback event records what was meant to go */
        }
      }
      try {
        if (ctx.previousActiveEpic !== undefined) writeState({ activeEpic: ctx.previousActiveEpic }, p);
        reindex(p);
      } catch {
        /* the index is a cache; `tm reindex` recovers it */
      }
      logEvent(
        "planner_apply_rolled_back",
        { session, digest, removed: created.length, ids: created, why: cause?.message || String(cause) },
        p,
      );
      throw cause;
    }
  });
}
