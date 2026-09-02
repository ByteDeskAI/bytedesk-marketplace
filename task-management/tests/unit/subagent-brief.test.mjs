/**
 * The briefing a subagent gets when it starts.
 *
 * Claude Code fires SubagentStart with the PARENT's `session_id` and lets a hook return
 * `additionalContext`, which reaches the agent prefixed "SubagentStart hook additional context: ".
 * Both facts were established by spawning a real agent against a probe hook — the agent quoted back
 * a token that appeared nowhere in its prompt — rather than inferred from the payload schema.
 *
 * Before this, a spawned agent knew nothing about the board: not which task its parent was working,
 * not what "done" meant for it. SessionStart fires once per session, not per agent.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { subagentBrief, workerBrief, briefFor } from "../../lib/render.mjs";
import { create, mutate, state, writeState } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** Claim `id` for `session`, the way `tm start` does. */
function claim(p, id, session) {
  const claims = { ...state(p).claims, [id]: { session, actor: "main", pid: 1, ts: new Date().toISOString() } };
  writeState({ claims }, p);
}

const SESSION = "parent-abc";

describe("when there is nothing to say", () => {
  it("says nothing rather than 'no tasks are claimed'", () => {
    const p = store();
    create("task", { title: "unclaimed" }, "", p);
    // Padding every spawned agent with an empty status line costs tokens on every fan-out and
    // tells the agent nothing it can act on.
    assert.equal(subagentBrief(SESSION, p), "");
  });

  it("says nothing when the session is unknown", () => {
    // Belt and braces: sessionId() can still resolve to null outside Claude Code.
    assert.equal(subagentBrief(null, store()), "");
  });

  it("says nothing about another session's claims", () => {
    const p = store();
    const t = create("task", { title: "someone else's" }, "", p);
    claim(p, t.id, "a-different-session");
    assert.equal(subagentBrief(SESSION, p), "");
  });

  it("survives a claim whose task file is gone", () => {
    const p = store();
    claim(p, "TM-404", SESSION);
    // A stale claim must not throw inside a hook — the hook contract is that a bug never bricks
    // the session.
    assert.equal(subagentBrief(SESSION, p), "");
  });
});

describe("the brief", () => {
  function claimed(extra = {}) {
    const p = store();
    const e = create("epic", { title: "Payments" }, "", p);
    const t = create(
      "task",
      {
        title: "wire the vendor SDK",
        epic: e.id,
        acceptance: [
          { text: "the token refresh path is covered by a test", done: false },
          { text: "the SDK version is pinned", done: true },
        ],
        ...extra,
      },
      "",
      p,
    );
    claim(p, t.id, SESSION);
    return { p, t, e };
  }

  it("names the task the parent is holding", () => {
    const { p, t, e } = claimed();
    const out = subagentBrief(SESSION, p);
    assert.match(out, new RegExp(t.id));
    assert.match(out, /wire the vendor SDK/);
    assert.match(out, new RegExp(e.id), "the epic is the one bit of surrounding context worth a line");
  });

  it("carries the unmet acceptance criteria, which is what 'done' means", () => {
    const { p } = claimed();
    const out = subagentBrief(SESSION, p);
    assert.match(out, /the token refresh path is covered by a test/);
  });

  it("drops the criteria already met, because the job is what is left", () => {
    const { p } = claimed();
    assert.equal(subagentBrief(SESSION, p).includes("the SDK version is pinned"), false);
  });

  it("tells the agent not to move the task through its lifecycle", () => {
    const { p } = claimed();
    const out = subagentBrief(SESSION, p);
    // The failure this prevents: an agent decides the work is done and records it, bypassing the
    // parent's judgement and the acceptance gate.
    assert.match(out, /\.bytedesk\/task-management\/bin\/tm start/);
    for (const verb of ["done", "park", "block"]) {
      assert.ok(out.includes(`\`${verb}\``), `the brief must name ${verb} as off limits`);
    }
  });

  it("still points at the additive writes, so reporting back has a route", () => {
    const { p } = claimed();
    const out = subagentBrief(SESSION, p);
    assert.match(out, /\.bytedesk\/task-management\/bin\/tm comment/);
    assert.match(out, /`evidence`/);
  });

  it("opens with a heading of its own", () => {
    const { p } = claimed();
    // Observed against the real harness: every SubagentStart hook's additionalContext is
    // concatenated into ONE block under a single prefix, so a brief with no heading runs straight
    // into whatever the previous hook emitted. In the live spawn this text landed directly after
    // another plugin's multi-page instructions.
    assert.match(subagentBrief(SESSION, p), /^## task-management/);
  });

  it("is not the handoff dossier", () => {
    const { p, t } = claimed();
    const out = subagentBrief(SESSION, p);
    // `handoff()` ends with "Resume with: tm start <id>", which is exactly wrong here — the parent
    // already holds the claim, and following that advice earns a refusal.
    assert.equal(out.includes(`Resume with: tm start ${t.id}`), false);
  });
});

describe("it stays small, because every spawned agent pays for it", () => {
  function manyClaims(n, criteria = 1) {
    const p = store();
    for (let i = 0; i < n; i += 1) {
      const t = create(
        "task",
        {
          title: `task number ${i} with a reasonably long title to take up room`,
          acceptance: Array.from({ length: criteria }, (_, j) => ({ text: `criterion ${j} on task ${i}`, done: false })),
        },
        "",
        p,
      );
      claim(p, t.id, SESSION);
    }
    return p;
  }

  it("caps how many claimed tasks it lists, and says how many it left out", () => {
    const out = subagentBrief(SESSION, manyClaims(8));
    assert.match(out, /and \d+ more claimed/, "a silent truncation reads as 'that is everything'");
  });

  it("caps the criteria per task", () => {
    const out = subagentBrief(SESSION, manyClaims(1, 12));
    assert.ok(out.split("- [ ]").length - 1 <= 5, "one task with forty criteria must not become the agent's whole context");
  });

  it("caps the whole thing, visibly", () => {
    const out = subagentBrief(SESSION, manyClaims(3, 5));
    assert.ok(out.length <= 1200, `brief was ${out.length} chars`);
  });
});

describe("the dispatched worker", () => {
  /** Claim for SESSION and stamp the task the way dispatch() (lib/dispatch/index.mjs) does. */
  function dispatched(extra = {}) {
    const p = store();
    const t = create(
      "task",
      {
        title: "port the renderer",
        acceptance: [
          { text: "the snapshot suite passes", done: false },
          { text: "the old path is deleted", done: true },
        ],
        ...extra,
      },
      "",
      p,
    );
    claim(p, t.id, SESSION);
    mutate(t.id, () => ({ dispatched: { backend: "tmux", run: `tmux:tm-${t.id}`, session: SESSION, at: new Date().toISOString() } }), p);
    return { p, t };
  }

  it("gets told it owns the lifecycle, with the verbs to run on ITS task", () => {
    const { p, t } = dispatched();
    const out = workerBrief(t.id, p);
    assert.match(out, /you own this task's lifecycle/);
    // The classic brief forbids exactly these verbs; the worker brief must GRANT them, named with
    // the task id, or the worker walks away and the task strands in_progress.
    assert.match(out, new RegExp(`tm accept ${t.id}`));
    assert.match(out, new RegExp(`tm evidence ${t.id}`));
    assert.match(out, new RegExp(`tm done ${t.id}`));
    assert.match(out, new RegExp(`tm block ${t.id} "reason"`));
    assert.match(out, /Never leave the task in_progress/);
    assert.match(out, /touches/, "the worker should know its edits are recorded");
  });

  it("carries the unmet criteria and drops the met ones, same as the classic brief", () => {
    const { p, t } = dispatched();
    const out = workerBrief(t.id, p);
    assert.match(out, /the snapshot suite passes/);
    assert.equal(out.includes("the old path is deleted"), false);
  });

  it("mirrors the handoff's 'When you finish' contract, so both surfaces agree", () => {
    const { p, t } = dispatched();
    const out = workerBrief(t.id, p);
    assert.match(out, /When you finish:/);
    assert.match(out, /Tick each criterion only once verified/);
    assert.match(out, /Attach proof, not claims/);
  });

  it("says nothing for a task that does not exist", () => {
    assert.equal(workerBrief("TM-404", store()), "");
  });

  it("stays inside the same size cap", () => {
    const { p, t } = dispatched({
      acceptance: Array.from({ length: 12 }, (_, j) => ({ text: `criterion ${j} with some length to it`, done: false })),
    });
    const out = workerBrief(t.id, p);
    assert.ok(out.length <= 1200, `brief was ${out.length} chars`);
    assert.ok(out.split("- [ ]").length - 1 <= 5);
  });
});

describe("briefFor — the hook cannot tell a helper from a worker, the board can", () => {
  it("gives the worker brief when everything the session holds is dispatched", () => {
    const p = store();
    const t = create("task", { title: "port the renderer" }, "", p);
    claim(p, t.id, SESSION);
    mutate(t.id, () => ({ dispatched: { backend: "tmux", run: "tmux:x", session: SESSION, at: new Date().toISOString() } }), p);
    const out = briefFor(SESSION, p);
    assert.match(out, /you own this task's lifecycle/);
    assert.equal(out.includes("do not run"), false, "a worker forbidden the lifecycle verbs strands its task");
  });

  it("gives the classic brief the moment ANY held task is ordinarily claimed", () => {
    const p = store();
    const d = create("task", { title: "dispatched work" }, "", p);
    claim(p, d.id, SESSION);
    mutate(d.id, () => ({ dispatched: { backend: "tmux", run: "tmux:x", session: SESSION, at: new Date().toISOString() } }), p);
    const mine = create("task", { title: "the parent's own work" }, "", p);
    claim(p, mine.id, SESSION);
    const out = briefFor(SESSION, p);
    // A helper reading the worker wording could conclude it may close work its parent owns.
    assert.match(out, /do not run/);
    assert.equal(out.includes("you own this task's lifecycle"), false);
  });

  it("is silent when the session holds nothing, whichever mode it would be", () => {
    assert.equal(briefFor(SESSION, store()), "");
    assert.equal(briefFor(null, store()), "");
  });
});
