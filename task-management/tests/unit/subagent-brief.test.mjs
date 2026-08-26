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
import { subagentBrief } from "../../lib/render.mjs";
import { create, state, writeState } from "../../lib/store.mjs";

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
