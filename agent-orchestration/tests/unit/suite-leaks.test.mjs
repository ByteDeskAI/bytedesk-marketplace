// TM-298: the suite-end leak check must be able to report finding something.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { escapedSessions, markedProcesses } from "../helpers/suite-leaks.mjs";

test("markedProcesses names a live process carrying the marker, and only that one", { skip: process.platform !== "linux" && "reads /proc" }, async (t) => {
  const marker = `AO_TEST_RUN=leak-${process.pid}-${Date.now()}`;
  const marked = spawn("sleep", ["30"], { env: { ...process.env, AO_TEST_RUN: marker.split("=")[1] }, stdio: "ignore" });
  const unmarked = spawn("sleep", ["31"], { env: { ...process.env, AO_TEST_RUN: "other" }, stdio: "ignore" });
  t.after(() => { marked.kill("SIGKILL"); unmarked.kill("SIGKILL"); });
  await Promise.all([marked, unmarked].map((child) => new Promise((resolve) => child.once("spawn", resolve))));
  assert.deepEqual(markedProcesses(marker), [{ pid: marked.pid, command: "sleep 30" }]);
  marked.kill("SIGKILL");
  await new Promise((resolve) => marked.once("exit", resolve));
  assert.deepEqual(markedProcesses(marker), []);
});

test("escapedSessions reports only new operator sessions started under the temp directory", () => {
  const before = new Map([["/s\tmine", ["/home/op/repo"]]]);
  const after = new Map([
    ["/s\tmine", ["/home/op/repo"]],
    ["/s\tnew-operator", ["/home/op/other"]],
    ["/s\tlead--cyrus", ["/tmp/ao-topology-stuck-X"]],
  ]);
  assert.deepEqual(escapedSessions(before, after, "/tmp"), [{ server: "/s", session: "lead--cyrus", cwd: "/tmp/ao-topology-stuck-X" }]);
});
