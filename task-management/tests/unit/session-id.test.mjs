/**
 * Which environment variable carries the session id, and what happens to the claims written
 * before any of them did.
 *
 * `CLAUDE_CODE_SESSION_ID` is the name Claude Code sets. Every reader in the plugin except
 * `actor.mjs` asked for `CLAUDE_SESSION_ID`, which nothing sets — so in production every claim,
 * every gate and every event's `session` column resolved to null. Measured on this project's own
 * board before the fix: 830 events, 0 with a session; 340 subagent_stop, 0 attributed; 9 claims,
 * 0 with a session; `claim_stolen` never once emitted.
 *
 * Nine contract suites stayed green throughout, because they exported the variable production
 * never had. That is the part worth a test rather than a comment.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { sessionId } from "../../lib/actor.mjs";
import { claimTask, claimant } from "../../lib/claims.mjs";
import { create, readEvents, state, writeState } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

describe("sessionId", () => {
  it("reads the name Claude Code actually sets", () => {
    assert.equal(sessionId({ CLAUDE_CODE_SESSION_ID: "abc" }), "abc");
  });

  it("still accepts the documented override, for a harness driving tm outside Claude Code", () => {
    assert.equal(sessionId({ CLAUDE_SESSION_ID: "from-a-wrapper" }), "from-a-wrapper");
  });

  it("prefers the harness's own id when both are present", () => {
    // In a Claude Code session the harness is the authority on its id; a stale exported
    // CLAUDE_SESSION_ID must not silently rename the session under it.
    assert.equal(sessionId({ CLAUDE_CODE_SESSION_ID: "real", CLAUDE_SESSION_ID: "stale" }), "real");
  });

  it("is null when neither is set, rather than undefined", () => {
    // Claims and events compare against it and store it; `undefined` would serialise away and
    // make "no session" indistinguishable from "field absent".
    assert.equal(sessionId({}), null);
  });
});

describe("a claim written before sessions resolved", () => {
  /** Exactly what every store on disk contains: a live claim whose session is null. */
  function legacyClaim(p, id) {
    writeState({ claims: { [id]: { session: null, actor: "main", pid: process.pid, ts: new Date().toISOString() } } }, p);
  }

  it("does not lock the board out when a real session id starts flowing", () => {
    const p = store();
    const t = create("task", { title: "work already in progress", status: "in_progress" }, "", p);
    legacyClaim(p, t.id);

    const res = claimTask(t.id, { session: "a-real-session", actor: "main", p });

    // Before the guard: `null !== "a-real-session"` is true, so the holder of your own
    // in-progress task reads as a stranger and `tm start` refuses work you were resuming.
    assert.equal(res.ok, true, "upgrading the plugin must not refuse work the user already had");
    assert.equal(state(p).claims[t.id].session, "a-real-session", "and the claim is adopted, not left null forever");
  });

  it("is adopted quietly, not recorded as a theft from yourself", () => {
    const p = store();
    const t = create("task", { title: "mine already", status: "in_progress" }, "", p);
    legacyClaim(p, t.id);

    const res = claimTask(t.id, { session: "a-real-session", p });

    assert.equal(res.stolenFrom, null);
    assert.equal(readEvents(p).filter((e) => e.event === "claim_stolen").length, 0);
  });

  it("still refuses a claim genuinely held by another live session", () => {
    const p = store();
    const t = create("task", { title: "theirs", status: "in_progress" }, "", p);
    claimTask(t.id, { session: "session-one", actor: "main", p });

    const res = claimTask(t.id, { session: "session-two", p });

    // The whole point of fixing the variable: this refusal could never fire before, because
    // both sides were null and two nulls compare equal.
    assert.equal(res.ok, false);
    assert.match(res.reason, /claimed by/);
    assert.equal(claimant(t.id, p).session, "session-one");
  });

  it("records the theft when the second session insists", () => {
    const p = store();
    const t = create("task", { title: "contested", status: "in_progress" }, "", p);
    claimTask(t.id, { session: "session-one", p });

    const res = claimTask(t.id, { session: "session-two", steal: true, p });

    assert.equal(res.ok, true);
    assert.equal(res.stolenFrom, "session-one");
    const [stolen] = readEvents(p).filter((e) => e.event === "claim_stolen");
    assert.ok(stolen, "claim_stolen is advertised as a subscribable notification and had never once fired");
    assert.deepEqual([stolen.from, stolen.to], ["session-one", "session-two"]);
  });
});

describe("the event log's session column", () => {
  it("is populated, having been null on every event ever written", () => {
    const p = store();
    const before = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = "stamped-session";
    try {
      create("task", { title: "stamp me" }, "", p);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = before;
    }

    assert.equal(readEvents(p).at(-1).session, "stamped-session");
  });
});
