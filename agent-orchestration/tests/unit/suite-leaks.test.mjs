// TM-298: the suite-end leak check must be able to report finding something.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { escapedSessions, markedProcesses, serviceManagersUnder } from "../helpers/suite-leaks.mjs";

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

// TM-330: a stand-in `process-compose` under /tmp/ao-*/, with the argv shape the real one has.
function fakeServiceManager(dir) {
  const bin = join(dir, "bin", "process-compose-v0.0.0");
  // exec -a gives the process the fake binary's name in argv[0], which is what /proc/<pid>/cmdline reports.
  return spawn("sh", ["-c", `exec -a ${bin} sleep 30`], { stdio: "ignore", detached: true });
}

test("serviceManagersUnder finds a process-compose under /tmp/ao-*, skips ignored pids and other paths", { skip: process.platform !== "linux" && "reads /proc" }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ao-leakprobe-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "zz-leakprobe-"));
  const mine = fakeServiceManager(dir);
  const other = spawn("sh", ["-c", `exec -a ${join(elsewhere, "process-compose")} sleep 30`], { stdio: "ignore", detached: true });
  t.after(() => { mine.kill("SIGKILL"); other.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); });
  await Promise.all([mine, other].map((child) => new Promise((resolve) => child.once("spawn", resolve))));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const found = serviceManagersUnder(tmpdir());
  console.log("found:", JSON.stringify(found.filter((m) => m.pid === mine.pid || m.pid === other.pid)));
  assert.ok(found.some((m) => m.pid === mine.pid), "the /tmp/ao-* service manager is reported");
  assert.ok(!found.some((m) => m.pid === other.pid), "a process-compose outside /tmp/ao-* is not");
  assert.ok(!serviceManagersUnder(tmpdir(), { ignore: new Set([mine.pid]) }).some((m) => m.pid === mine.pid), "an ignored pid is not");
});

test("the suite-end check fails a run that leaves a service manager behind, and passes one that does not", { skip: process.platform !== "linux" && "reads /proc", timeout: 60_000 }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ao-leakrun-"));
  const guard = fileURLToPath(new URL("../helpers/suite-leaks.mjs", import.meta.url));
  const script = (leak) => `import ${JSON.stringify(guard)};
import { spawn } from "node:child_process";
${leak ? `const c = spawn("sh", ["-c", "exec -a ${join(dir, "bin", "process-compose")} sleep 30"], { stdio: "ignore", detached: true, env: { PATH: process.env.PATH } }); /* scrubbed env, as the managed services run: no AO_TEST_RUN marker */ c.unref(); console.log("LEAKED_PID=" + c.pid); await new Promise(r => c.once("spawn", r)); await new Promise(r => setTimeout(r, 200));` : ""}
`;
  const leaked = [];
  t.after(() => { for (const pid of leaked) { try { process.kill(pid, "SIGKILL"); } catch {} } rmSync(dir, { recursive: true, force: true }); });
  const env = { ...process.env, AO_TEST_RUN: "" };
  delete env.AO_TEST_RUN;
  const run = (leak) => {
    const file = join(dir, `run-${leak}.mjs`);
    writeFileSync(file, script(leak));
    const result = spawnSync(process.execPath, [file], { env, encoding: "utf8" });
    const pid = /LEAKED_PID=(\d+)/.exec(result.stdout)?.[1];
    if (pid) leaked.push(Number(pid));
    return result;
  };
  const bad = run(true);
  console.log("leaking run: exit", bad.status, bad.stderr.trim().split("\n").slice(0, 3).join(" | "));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /process-compose/);
  const good = run(false);
  console.log("clean run: exit", good.status, JSON.stringify(good.stderr));
  assert.equal(good.status, 0);
});
