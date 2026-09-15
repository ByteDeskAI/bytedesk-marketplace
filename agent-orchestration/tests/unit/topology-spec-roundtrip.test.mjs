import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { loadSpec, validateSpec } from "../../topology/lib/spec.mjs";

const execFile = promisify(execFileCallback);
const nestedSpec = () => ({
  name: "nested-roundtrip",
  agents: [
    { id: "conductor", role: "orchestrator", cli: "generic" },
    { id: "worker", cli: "generic", auto_approve: true },
    { id: "team", workflow: "child", inputs: { topic: "review" } },
  ],
});

test("nested workflow normalization survives raw and serialized roundtrips", () => {
  const raw = nestedSpec();
  const before = structuredClone(raw);
  const normalized = validateSpec(raw);
  assert.deepEqual(validateSpec(normalized), normalized);
  assert.deepEqual(validateSpec(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.equal(Object.hasOwn(normalized.agents[2], "auto_approve"), false);
  assert.equal(normalized.agents[0].auto_approve, false);
  assert.equal(normalized.agents[1].auto_approve, true);
  assert.deepEqual(raw, before, "normalization must not change the input agents");
});

test("workflow participants still reject explicit auto_approve values", () => {
  for (const value of [false, true, null, "false", 0]) {
    const raw = nestedSpec();
    raw.agents[2].auto_approve = value;
    assert.throws(() => validateSpec(raw), /auto_approve cannot be set on a workflow participant/);
  }
});

test("compose saves a nested workflow that loadSpec can read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ao-spec-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "source.json");
  const workflows = join(dir, "saved");
  await writeFile(source, JSON.stringify(nestedSpec()));
  const cli = fileURLToPath(new URL("../../topology/cli.mjs", import.meta.url));
  // Compose does not launch panes or activate supervision. All writes stay in this fixture.
  const { stdout } = await execFile(process.execPath, [cli, "compose", "--spec", source,
    "--save", workflows, "--consumer", dir, "--home", dir, "--json"], { timeout: 10000 });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  const { spec, path } = await loadSpec({ workflow: "nested-roundtrip", dirs: [workflows] });
  assert.equal(path, result.saved);
  assert.deepEqual(spec, validateSpec(nestedSpec()));
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(Object.hasOwn(saved.agents[2], "auto_approve"), false);
});
