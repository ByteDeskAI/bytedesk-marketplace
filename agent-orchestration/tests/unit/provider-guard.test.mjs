// TM-290: the suite guard must actually fail a run that spawns a real provider CLI, and the shared
// temp-repo helper must produce a repository that is NOT enrolled.
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { PROVIDER_COMMANDS, installProviderShims, providerSpawns } from "../helpers/provider-guard.mjs";
import { initTempRepo } from "../helpers/temp-repo.mjs";
import { resolveEnrollment } from "../../topology/lib/repo-enrollment.mjs";

const execFile = promisify(execFileCallback);
const GUARD = fileURLToPath(new URL("../helpers/provider-guard.mjs", import.meta.url));

test("this run is guarded: every catalog provider command resolves to a shim", async () => {
  assert.ok(process.env.AO_TEST_PROVIDER_LOG, "run the suite through npm run test:unit so the guard is loaded");
  for (const command of PROVIDER_COMMANDS) {
    const { stdout } = await execFile("sh", ["-c", `command -v ${command}`]);
    assert.ok(stdout.trim().startsWith(`${join(process.env.AO_TEST_PROVIDER_LOG, "..")}/`), `${command} resolved to ${stdout.trim()}`);
  }
});

test("a shim records the spawn and refuses with 127", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ao-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { dir: shims, log } = installProviderShims(dir);
  const result = spawnSync(join(shims, "claude"), ["--print", "hi"], { env: { PATH: "/usr/bin:/bin", AO_TEST_FILE: "x.test.mjs" }, encoding: "utf8" });
  assert.equal(result.status, 127);
  assert.deepEqual(providerSpawns(log).map(({ file, command }) => ({ file, command })), [{ file: "x.test.mjs", command: "claude --print hi" }]);
});

test("a run that spawns a provider exits non-zero and names the test; a clean run exits 0", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ao-guard-run-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spawns = join(dir, "spawns.mjs"), clean = join(dir, "clean.mjs");
  await writeFile(spawns, `import { spawnSync } from "node:child_process"; spawnSync("codex", ["exec"]);\n`);
  await writeFile(clean, `console.log("no provider");\n`);
  // A fresh process with no inherited log, as the top of a real run is.
  const env = { ...process.env };
  delete env.AO_TEST_PROVIDER_LOG;
  const bad = spawnSync(process.execPath, ["--import", GUARD, spawns], { env, encoding: "utf8" });
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /provider guard: 1 real provider CLI spawn/);
  assert.match(bad.stderr, /spawns\.mjs: codex exec/);
  const good = spawnSync(process.execPath, ["--import", GUARD, clean], { env, encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
});

test("initTempRepo opts out of enrollment by default, and only by default", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-temp-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const off = await resolveEnrollment({ consumer: await initTempRepo(join(root, "off")), home, env: { ...process.env, HOME: home } });
  assert.deepEqual([off.enrolled, off.source], [false, "disabled"]);
  const on = await resolveEnrollment({ consumer: await initTempRepo(join(root, "on"), { enrolled: true }), home, env: { ...process.env, HOME: home } });
  assert.deepEqual([on.enrolled, on.source], [true, "default"]);
});
