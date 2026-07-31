/**
 * Which store events are worth interrupting a human for.
 *
 * Pure: the notification decision is a function of the event, the user's
 * category choices, what they are watching, and what this tab just did.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, notificationFor, recordSelfWrite } from "../../dashboard/src/pwa/notify.mjs";

const ALL = new Set(Object.keys(CATEGORIES));
const base = { me: "ryan", watching: new Set(["TM-001"]), categories: ALL, self: [], now: 1_000_000 };
const at = (extra = {}) => ({ ...base, ...extra });

test("every category has a human-readable label", () => {
  for (const [key, label] of Object.entries(CATEGORIES)) {
    assert.equal(typeof label, "string", key);
    assert.ok(label.length > 0, key);
  }
  assert.deepEqual(Object.keys(CATEGORIES).sort(), ["assigned", "blocked", "claim", "epic", "gate"]);
});

test("a watched task moving to blocked notifies", () => {
  const n = notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at());
  assert.equal(n?.category, "blocked");
  assert.match(n.title, /TM-001/);
});

test("an unwatched task moving to blocked does not notify", () => {
  assert.equal(notificationFor({ event: "update", id: "TM-999", status: "blocked" }, at()), null);
});

test("a watched task moving to any other status does not notify", () => {
  assert.equal(notificationFor({ event: "update", id: "TM-001", status: "in_progress" }, at()), null);
});

test("a stolen claim on a watched task notifies", () => {
  const n = notificationFor({ event: "claim_stolen", id: "TM-001", from: "s1", to: "s2" }, at());
  assert.equal(n?.category, "claim");
  assert.match(n.body, /s2/);
});

test("a gate refusal notifies regardless of what is watched", () => {
  const n = notificationFor({ event: "gate_refused", id: "TM-042", reason: "unmet acceptance criteria" }, at());
  assert.equal(n?.category, "gate");
  assert.match(n.body, /unmet acceptance criteria/);
});

test("the stop gate counts as a gate refusal", () => {
  assert.equal(notificationFor({ event: "stop_gate_blocked", tasks: "TM-001" }, at())?.category, "gate");
});

test("an epic auto-close notifies", () => {
  const n = notificationFor({ event: "epic_auto_closed", id: "TM-E1", tasks: 4 }, at());
  assert.equal(n?.category, "epic");
  assert.match(n.title, /TM-E1/);
});

test("a task assigned to me notifies", () => {
  assert.equal(notificationFor({ event: "assign", id: "TM-500", assignee: "ryan" }, at())?.category, "assigned");
});

test("a watched task assigned away from me notifies", () => {
  const n = notificationFor({ event: "assign", id: "TM-001", assignee: "someone-else" }, at());
  assert.equal(n?.category, "assigned");
  assert.match(n.body, /someone-else/);
});

test("an assignment between two other people is not my business", () => {
  assert.equal(notificationFor({ event: "assign", id: "TM-777", assignee: "someone-else" }, at()), null);
});

test("with no identity set, assignment notifications stay quiet", () => {
  assert.equal(notificationFor({ event: "assign", id: "TM-500", assignee: "ryan" }, at({ me: null })), null);
});

test("a disabled category never fires", () => {
  const only = new Set(["epic"]);
  assert.equal(notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at({ categories: only })), null);
  assert.ok(notificationFor({ event: "epic_auto_closed", id: "TM-E1" }, at({ categories: only })));
});

test("uninteresting events are ignored", () => {
  for (const e of [{ event: "create", id: "TM-001" }, { event: "comment", id: "TM-001" }, { event: "rank" }, {}]) {
    assert.equal(notificationFor(e, at()), null, e.event);
  }
});

test("a change this tab just made does not notify itself", () => {
  const self = recordSelfWrite([], "TM-001", base.now);
  assert.equal(notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at({ self })), null);
});

test("self-suppression expires, so a later change by someone else still fires", () => {
  const self = recordSelfWrite([], "TM-001", 0);
  const n = notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at({ self }));
  assert.equal(n?.category, "blocked");
});

test("self-suppression is per task", () => {
  const self = recordSelfWrite([], "TM-002", base.now);
  assert.ok(notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at({ self })));
});

test("recordSelfWrite drops entries that can no longer suppress anything", () => {
  const self = recordSelfWrite([{ id: "TM-OLD", ts: 0 }], "TM-001", base.now);
  assert.deepEqual(self, [{ id: "TM-001", ts: base.now }]);
});

test("notifications carry a tag so repeats replace rather than stack", () => {
  const a = notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at());
  const b = notificationFor({ event: "update", id: "TM-001", status: "blocked" }, at({ now: base.now + 60_000 }));
  assert.equal(a.tag, b.tag);
  assert.notEqual(a.tag, notificationFor({ event: "claim_stolen", id: "TM-001", to: "x" }, at()).tag);
});
