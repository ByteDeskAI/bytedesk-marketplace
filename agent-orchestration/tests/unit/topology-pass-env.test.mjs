// TM-375: workers inherit the secrets a repository's AO config names in `workers.passEnv`. The names
// are config; the values come from the launching environment and must reach the worker's process
// without ever being written to a launcher, record, log, journal, tmux environment or argv.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { launchRun, launcherScript, openRoleSession, passEnvFile, stagePassEnv } from "../../topology/lib/launch.mjs";
import { validateConfigShape } from "../../topology/lib/config.mjs";
import { normalizeAdapter } from "../../topology/lib/providers.mjs";
import { materializeSpec, validateSpec } from "../../topology/lib/spec.mjs";
import { isolatedTmux } from "../helpers/isolated-tmux.mjs";

const execFile = promisify(execFileCb);
const SENTINEL = `tm375-sentinel-${Date.now()}-do-not-write`;
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Every file under `root` whose bytes contain `needle`. */
async function filesContaining(root, needle) {
  const hits = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if ((await readFile(path, "utf8").catch(() => "")).includes(needle)) hits.push(path);
  }
  return hits;
}

async function waitForFile(path, ms = 10_000) {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((r) => setTimeout(r, 100))) {
    if (existsSync(path) && (await stat(path)).size > 0) return true;
  }
  return false;
}

test("config accepts workers.passEnv as names only and refuses anything else", () => {
  assert.deepEqual(validateConfigShape({ workers: { passEnv: ["TYPESAFE_API_KEY", "_X1"] } }, "t"), []);
  for (const bad of [{ workers: { passEnv: "TYPESAFE_API_KEY" } }, { workers: { passEnv: ["KEY=value"] } }, { workers: [] }]) {
    assert.equal(validateConfigShape(bad, "t").length, 1, JSON.stringify(bad));
  }
});

test("the launcher sources and deletes the staged file, and never contains a value", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ao-passenv-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const launcher = join(dir, "launch-0.sh");
  const script = launcherScript({ agent: { id: "w1", role: "worker", cwd: dir }, candidate: { cli: "sh" },
    argv: ["sh", "-c", 'printf %s "$TM375_SECRET" > seen; printf %s "${TM375_ABSENT-unset}" > absent'], env: { AO_AGENT_ID: "w1" }, envFile: passEnvFile(launcher) });
  await writeFile(launcher, script, { mode: 0o700 });
  // A value with quotes, a newline and $() must arrive verbatim and run nothing.
  const value = `${SENTINEL} 'q' "d" $(touch ${join(dir, "pwned")})\nline2`;
  const staged = await stagePassEnv(launcher, ["TM375_SECRET", "TM375_ABSENT"], { TM375_SECRET: value });
  assert.deepEqual([staged.passed, staged.missing], [["TM375_SECRET"], ["TM375_ABSENT"]]);
  assert.equal((await stat(staged.file)).mode & 0o777, 0o600);
  assert.ok(!script.includes(SENTINEL));
  await execFile("bash", [launcher], { env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(await readFile(join(dir, "seen"), "utf8"), value);
  assert.equal(await readFile(join(dir, "absent"), "utf8"), "unset");
  assert.equal(existsSync(staged.file), false, "the launcher deleted the staged file");
  assert.equal(existsSync(join(dir, "pwned")), false, "the value was data, not code");
});

test("a dry-run launch warns about a configured name the launching environment lacks, by name only", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "ao-passenv-repo-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  await mkdir(join(consumer, ".bytedesk", "agent-orchestration"), { recursive: true });
  await writeFile(join(consumer, ".bytedesk", "agent-orchestration", "config.json"), JSON.stringify({ workers: { passEnv: ["TM375_NEVER_SET_ANYWHERE"] } }));
  const spec = materializeSpec(validateSpec({ name: "passenv", agents: [{ id: "conductor", role: "orchestrator", cli: "generic" }, { id: "hand", role: "worker", cli: "generic" }] }), { runId: "r1", consumer, home: consumer, inputs: {} });
  const result = await launchRun({ spec, adapters: new Map([["generic", normalizeAdapter({ id: "generic" }, "generic")]]), skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });
  assert.ok(result.warnings.some((w) => w.includes("workers.passEnv: TM375_NEVER_SET_ANYWHERE is not set")), result.warnings.join("\n"));
});

const haveTmux = await execFile("tmux", ["-V"]).then(() => true, () => false);

test("a session's worker gets the configured secret in its environment, and the value is written nowhere", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const iso = isolatedTmux(t);
  const root = await mkdtemp(join(tmpdir(), "ao-passenv-role-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const xdg = join(root, "xdg");
  await mkdir(join(xdg, "agent-orchestration"), { recursive: true });
  await writeFile(join(xdg, "agent-orchestration", "config.json"), JSON.stringify({ workers: { passEnv: ["TM375_SECRET", "TM375_ABSENT"] } }));
  // The server starts from the env isolatedTmux captured, BEFORE the secret is set below: a tmux
  // server copies its first client's environment, and the operator's server predates any launch.
  await iso.tmux(["new-session", "-d", "-s", "keepalive", "sleep 120"]);
  const prior = process.env.TM375_SECRET;
  process.env.TM375_SECRET = SENTINEL; // the launching environment, as a lead's shell would hold it
  t.after(() => { if (prior === undefined) delete process.env.TM375_SECRET; else process.env.TM375_SECRET = prior; });
  delete process.env.TM375_ABSENT;
  const logs = [];
  await iso.within(async () => {
    const opened = await openRoleSession({
      agentsDir: join(root, "agents"),
      agentId: "pe375w01",
      adapter: normalizeAdapter({ id: "fake", command: "sh" }, "x"),
      // The worker hashes what it received; the hash, never the value, is what lands on disk.
      argv: ["sh", "-c", 'printf %s "$TM375_SECRET" | sha256sum > seen.sha; exec sleep 60'],
      env: { AO_AGENT_ID: "pe375w01", AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: xdg },
      role: "worker",
      log: (line) => logs.push(line),
    });
    const dir = join(root, "agents", "pe375w01");
    assert.ok(await waitForFile(join(dir, "seen.sha")), "the worker ran");
    assert.equal((await readFile(join(dir, "seen.sha"), "utf8")).split(" ")[0], sha(SENTINEL), "the worker's environment held the secret");
    assert.equal(existsSync(passEnvFile(opened.record.launcher)), false, "the staged file is gone once the worker started");
    assert.deepEqual(await filesContaining(root, SENTINEL), [], "no launcher, record, pane log or state file holds the value");
    const tmuxEnv = [(await iso.tmux(["show-environment", "-g"])).stdout, (await iso.tmux(["show-environment", "-t", opened.session])).stdout].join("\n");
    assert.ok(tmuxEnv.length > 0 && !tmuxEnv.includes(SENTINEL), "tmux's environment never carries it");
    const ps = (await execFile("ps", ["-eo", "args"])).stdout;
    assert.ok(ps.includes("sleep 60") && !ps.includes(SENTINEL), "no argv carries it");
    assert.ok(logs.some((line) => line.includes("TM375_ABSENT is not set")), logs.join("\n"));
    assert.ok(!logs.join("\n").includes(SENTINEL));
  });
});
