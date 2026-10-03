// Regression test for the storage-routing flake (TM-326 round 2): a read cut off by the server dying
// must be retried once after the connection is seen closed; a write must never be retried.
import test from "node:test";
import assert from "node:assert/strict";
import { runWithReadRetry } from "../../lib/storage/retry-read.mjs";

const timeout = () => Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" });

test("a read that fails while the connection is closed is retried once and returns the offline answer", async () => {
  let calls = 0;
  const fn = async () => { calls += 1; if (calls === 1) throw timeout(); return { offline: true }; };
  const out = await runWithReadRetry("list", fn, [], () => true);
  console.log(`read: calls=${calls} result=${JSON.stringify(out)}`);
  assert.equal(calls, 2);
  assert.deepEqual(out, { offline: true });
});

test("a read that fails while the connection is still open is NOT retried (a real error stays an error)", async () => {
  let calls = 0;
  const fn = async () => { calls += 1; throw timeout(); };
  await assert.rejects(runWithReadRetry("get", fn, [], () => false), /TIMEOUT/);
  console.log(`open connection: calls=${calls}`);
  assert.equal(calls, 1);
});

test("a write is never retried, even when the connection is closed", async () => {
  for (const method of ["put", "create", "delete", "blobPut", "appendEvent", "stateCreate"]) {
    let calls = 0;
    const fn = async () => { calls += 1; throw timeout(); };
    await assert.rejects(runWithReadRetry(method, fn, [], () => true), /TIMEOUT/);
    assert.equal(calls, 1, `${method} was retried`);
  }
  console.log("writes: put/create/delete/blobPut/appendEvent/stateCreate each called once");
});

test("a read is retried at most once", async () => {
  let calls = 0;
  const fn = async () => { calls += 1; throw timeout(); };
  await assert.rejects(runWithReadRetry("info", fn, [], () => true), /TIMEOUT/);
  assert.equal(calls, 2);
});
