import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { materializeSpec, resolveInputs, validateSpec } from "../../topology/lib/spec.mjs";
import { parseDuration, render, shellQuote } from "../../topology/lib/util.mjs";

const minimal = () => ({
  name: "Demo Run",
  agents: [
    { id: "conductor", role: "orchestrator", cli: "claude", model: "fable" },
    { id: "worker-a", role: "worker", cli: "codex" },
  ],
  workflow: [{ stage: "do-it", from: "conductor", to: ["worker-a"] }],
  gates: [{ after: "do-it", human: true }],
});

test("validateSpec normalizes a minimal spec", () => {
  const spec = validateSpec(minimal());
  assert.equal(spec.name, "demo-run");
  assert.equal(spec.layout, "main-vertical");
  assert.equal(spec.session, "{{name}}-{{run_id}}");
  assert.deepEqual(spec.agents[1].skills, []);
  assert.equal(spec.artifacts.dir, "artifacts");
});

test("validateSpec lists every problem at once", () => {
  const raw = minimal();
  raw.agents.push({ id: "worker-a", role: "worker", cli: "" });
  raw.workflow.push({ stage: "do-it", to: ["ghost"] });
  raw.gates.push({ after: "nope" });
  raw.layout = "circle";
  assert.throws(
    () => validateSpec(raw),
    (error) => {
      assert.equal(error.code, "TOPOLOGY_SPEC_INVALID");
      const text = error.message;
      for (const needle of ['"worker-a" is duplicated', "cli is required", '"do-it" is duplicated', 'unknown agent "ghost"', 'unknown stage "nope"', "layout must be one of"]) {
        assert.ok(text.includes(needle), `expected problem: ${needle}\n${text}`);
      }
      return true;
    },
  );
});

test("validateSpec requires exactly one orchestrator", () => {
  const raw = minimal();
  raw.agents[0].role = "worker";
  assert.throws(() => validateSpec(raw), /exactly one agent must have role "orchestrator"/);
});

test("resolveInputs applies defaults and reports missing required inputs", () => {
  const spec = validateSpec({ ...minimal(), inputs: { product: { description: "slug", required: true }, rounds: { default: "2" } } });
  assert.throws(() => resolveInputs(spec, {}), /Missing required input\(s\):\n- product — slug/);
  assert.deepEqual(resolveInputs(spec, { product: "vault" }), { product: "vault", rounds: "2" });
});

test("materializeSpec renders placeholders, run_dir, and per-agent cwd", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-consumer-"));
  try {
    const spec = validateSpec({
      ...minimal(),
      inputs: { product: { required: true } },
      session: "brand-{{inputs.product}}-{{run_id}}",
      agents: [
        { id: "conductor", role: "orchestrator", cli: "claude", instructions: "Product {{inputs.product}} as {{agent.id}}" },
        { id: "worker-a", role: "worker", cli: "codex", cwd: "sub/dir" },
      ],
    });
    const inputs = resolveInputs(spec, { product: "vault" });
    const rendered = materializeSpec(spec, { runId: "20260904-0101-abcd", consumer, home: "/home/x", inputs });
    assert.equal(rendered.session, "brand-vault-20260904-0101-abcd");
    assert.equal(rendered.run_dir, join(consumer, ".orchestration", "runs", "20260904-0101-abcd"));
    assert.equal(rendered.agents[0].instructions, "Product vault as conductor");
    assert.equal(rendered.agents[0].cwd, consumer);
    assert.equal(rendered.agents[1].cwd, join(consumer, "sub", "dir"));
    assert.deepEqual(rendered.inputs_resolved, { product: "vault" });
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("helpers: render leaves unknown placeholders visible, durations parse, shellQuote is safe", () => {
  assert.equal(render("a {{x}} {{missing}}", { x: 1 }), "a 1 {{missing}}");
  assert.equal(parseDuration("20m"), 1_200_000);
  assert.equal(parseDuration("90s"), 90_000);
  assert.equal(parseDuration(undefined, 5), 5);
  assert.throws(() => parseDuration("soon"), /Cannot parse duration/);
  assert.equal(shellQuote("plain-1.0"), "plain-1.0");
  assert.equal(shellQuote("it's here"), `'it'\\''s here'`);
});
