/**
 * The offline write queue's arithmetic: what supersedes what, in what order it
 * replays, and what a server refusal does to an entry.
 *
 * Pure — no IndexedDB here. The storage wrapper in queue.mjs is plumbing over
 * exactly these functions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyResult, enqueue, pending, replayOrder, taskIdOf } from "../../dashboard/src/pwa/queue.mjs";

const w = (url, body = {}, extra = {}) => ({ method: "POST", url, body, ...extra });

test("a write's task id comes out of its url", () => {
  assert.equal(taskIdOf("/api/task/TM-001/transition"), "TM-001");
  assert.equal(taskIdOf("/api/task/TM-001"), "TM-001");
  assert.equal(taskIdOf("/api/task/TM%2D001/assign"), "TM-001");
  assert.equal(taskIdOf("/api/task"), null);
  assert.equal(taskIdOf("/api/bulk"), null);
});

test("enqueue stamps an entry with an id, a time and queued status", () => {
  const [entry] = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  assert.equal(entry.status, "queued");
  assert.equal(entry.ts, 10);
  assert.equal(entry.taskId, "TM-001");
  assert.ok(entry.key);
});

test("entries replay oldest first", () => {
  let q = [];
  q = enqueue(q, w("/api/task/TM-001/comment", { text: "one" }), 10);
  q = enqueue(q, w("/api/task/TM-002/comment", { text: "two" }), 20);
  q = enqueue(q, w("/api/task/TM-003/comment", { text: "three" }), 15);
  assert.deepEqual(
    replayOrder(q).map((e) => e.taskId),
    ["TM-001", "TM-003", "TM-002"],
  );
});

test("a later transition on the same task supersedes the earlier one", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "in_progress" }), 10);
  q = enqueue(q, w("/api/task/TM-001/transition", { status: "done" }), 20);
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].body, { status: "done" });
  assert.equal(q[0].ts, 20, "the replacement keeps the queue position of the write it replaced");
});

test("coalescing is per task and per action", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = enqueue(q, w("/api/task/TM-002/transition", { status: "done" }), 20);
  q = enqueue(q, w("/api/task/TM-001/assign", { assignee: "ryan" }), 30);
  assert.equal(q.length, 3);
});

test("comments and acceptance criteria accumulate — each one is its own fact", () => {
  let q = enqueue([], w("/api/task/TM-001/comment", { text: "one" }), 10);
  q = enqueue(q, w("/api/task/TM-001/comment", { text: "two" }), 20);
  q = enqueue(q, w("/api/task/TM-001/ac", { text: "proven" }), 30);
  assert.equal(q.length, 3);
});

test("a failed entry is not superseded silently — the refusal stays visible", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = applyResult(q, q[0].key, { status: 409, error: "unmet acceptance criteria" });
  q = enqueue(q, w("/api/task/TM-001/transition", { status: "parked" }), 20);
  assert.equal(q.length, 2);
  assert.equal(q.filter((e) => e.status === "failed").length, 1);
});

test("a successful replay removes the entry", () => {
  const q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  assert.deepEqual(applyResult(q, q[0].key, { status: 200 }), []);
});

test("a server refusal marks the entry failed and keeps the reason", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = applyResult(q, q[0].key, { status: 409, error: "unmet acceptance criteria" });
  assert.equal(q[0].status, "failed");
  assert.equal(q[0].error, "unmet acceptance criteria");
  assert.equal(q[0].code, 409);
});

test("a failed entry does not replay again", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = applyResult(q, q[0].key, { status: 409, error: "nope" });
  assert.deepEqual(replayOrder(q), []);
});

test("a write that never reached the server stays queued for the next attempt", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = applyResult(q, q[0].key, { offline: true });
  assert.equal(q[0].status, "queued");
  assert.equal(replayOrder(q).length, 1);
});

test("applyResult on an unknown key changes nothing", () => {
  const q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  assert.deepEqual(applyResult(q, "nope", { status: 200 }), q);
});

test("pending() reports per-task state for the cards", () => {
  let q = enqueue([], w("/api/task/TM-001/transition", { status: "done" }), 10);
  q = enqueue(q, w("/api/task/TM-002/assign", { assignee: "ryan" }), 20);
  q = applyResult(q, q[0].key, { status: 409, error: "unmet acceptance criteria" });
  const state = pending(q);
  assert.equal(state.get("TM-001").status, "failed");
  assert.equal(state.get("TM-001").error, "unmet acceptance criteria");
  assert.equal(state.get("TM-002").status, "queued");
  assert.equal(state.get("TM-003"), undefined);
});

test("a failure outranks a queued write on the same card", () => {
  let q = enqueue([], w("/api/task/TM-001/comment", { text: "one" }), 10);
  q = enqueue(q, w("/api/task/TM-001/transition", { status: "done" }), 20);
  q = applyResult(q, q[1].key, { status: 409, error: "nope" });
  assert.equal(pending(q).get("TM-001").status, "failed");
});
