import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { materializeSpec, resolveInputs, specSchemaSummary, validateSpec } from "../../topology/lib/spec.mjs";
import { agentsRoot, createAgent } from "../../topology/lib/agents.mjs";
import { mintId } from "../../topology/lib/identity.mjs";
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

test("inputs with options are validated, support multi, and reject unknown values", () => {
  const spec = validateSpec({
    ...minimal(),
    inputs: {
      scope: { options: ["product", "family"], default: "product" },
      deliverables: { options: [{ value: "mark", description: "svg" }, "lockup"], default: "mark", multi: true },
      cli: { options: ["claude", "codex"], required: true },
    },
  });
  assert.equal(spec.inputs.scope.required, false);
  assert.deepEqual(spec.inputs.deliverables.options[0], { value: "mark", description: "svg" });
  assert.deepEqual(resolveInputs(spec, { cli: "codex", deliverables: "mark,lockup" }), { scope: "product", deliverables: "mark,lockup", cli: "codex" });
  assert.throws(() => resolveInputs(spec, { cli: "gemini" }), /cli="gemini" is not allowed; cli \(options: claude \| codex\)/);
  assert.throws(() => resolveInputs(spec, { cli: "claude", deliverables: "mark,poster" }), /deliverables="mark,poster" is not allowed/);
  assert.throws(() => resolveInputs(spec, {}), /Missing required input\(s\):\n- cli \(options: claude \| codex\)/);
  assert.throws(() => validateSpec({ ...minimal(), inputs: { scope: { options: ["a"], default: "b" } } }), /default "b" is not one of its options/);
});

test("candidates give an ordered fallback chain, from arrays, strings, or inputs", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-chain-"));
  try {
    const spec = validateSpec({
      ...minimal(),
      inputs: { judge: { default: "claude:opus, codex:gpt-5" } },
      agents: [
        { id: "conductor", role: "orchestrator", candidates: ["claude:fable", "claude:opus", "codex"] },
        { id: "judge", role: "judge", candidates: "{{inputs.judge}}" },
        { id: "worker-a", role: "worker", cli: "grok" },
      ],
      workflow: [],
      gates: [],
    });
    assert.equal(spec.agents[0].cli, "claude");
    assert.equal(spec.agents[0].model, "fable");
    assert.deepEqual(spec.agents[0].candidates, [{ cli: "claude", model: "fable" }, { cli: "claude", model: "opus" }, { cli: "codex", model: undefined }]);
    const rendered = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: resolveInputs(spec, {}) });
    assert.deepEqual(rendered.agents[1].candidates, [{ cli: "claude", model: "opus" }, { cli: "codex", model: "gpt-5" }]);
    assert.equal(rendered.agents[1].cli, "claude");
    assert.deepEqual(rendered.agents[2].candidates, [{ cli: "grok", model: undefined }]);
    assert.throws(() => validateSpec({ ...minimal(), agents: [{ id: "conductor", role: "orchestrator", candidates: [] }] }), /candidates is empty/);
    assert.throws(() => validateSpec({ ...minimal(), agents: [{ id: "conductor", role: "orchestrator", candidates: [":opus"] }] }), /must look like "claude:fable"/);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
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
    assert.equal(rendered.run_dir, join(consumer, ".bytedesk", "agent-orchestration", "runs", "20260904-0101-abcd"));
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

test("a spec entry may reference a stored agent, and anything inline overrides the stored definition", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-library-"));
  try {
    const conductor = await createAgent(consumer, { role: "orchestrator", cli: "claude", skills: ["review"], mcp: ["filesystem"] });
    const reviewer = await createAgent(consumer, { role: "reviewer", cli: "claude", candidates: ["claude:opus", "codex"] });

    const spec = validateSpec({
      name: "library-run",
      agents: [
        { agent: conductor.id },
        { id: "second", agent: reviewer.full_name, cli: "codex", skills: [] },
      ],
    });
    // The reference survives validation untouched: nothing on disk is read until materialization.
    assert.equal(spec.agents[0].id, undefined, "an id is derived later, from the stored agent's name");
    assert.deepEqual(spec.agents[1]._inline.sort(), ["agent", "cli", "id", "skills"]);

    const rendered = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: {} });
    const [first, second] = rendered.agents;

    assert.equal(first.id, conductor.full_name.toLowerCase().replace(" ", "-"), "an id-less entry is named after the stored agent");
    assert.equal(first.role, "orchestrator", "the stored role stands");
    assert.equal(first.cli, "claude");
    assert.deepEqual(first.skills, ["review"], "stored skills are inherited");
    assert.deepEqual(first.mcp, ["filesystem"], "the mcp field survives materialization");
    assert.ok(first.instructions.includes(conductor.full_name), "the stored prompt.md becomes the agent's instructions");
    assert.equal(first._agent, conductor.id, "the materialized agent still points at its library identity");

    assert.equal(second.id, "second", "an explicit id wins over the derived one");
    assert.equal(second.role, "reviewer", "the stored role is used when the entry does not state one");
    assert.equal(second.cli, "codex", "an inline cli overrides the stored candidate chain");
    assert.deepEqual(second.skills, [], "an inline empty list is an override, not an absence");
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("an unknown agent reference fails with the roster and the search path", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-noagent-"));
  try {
    const known = await createAgent(consumer, { role: "orchestrator" });
    const spec = validateSpec({ name: "ghost-run", agents: [{ agent: known.id }, { id: "b", agent: "Nobody At All" }] });
    assert.throws(
      () => materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: {} }),
      (error) => {
        assert.equal(error.code, "TOPOLOGY_AGENT_NOT_FOUND");
        assert.match(error.message, /"Nobody At All"/);
        assert.ok(error.message.includes(known.full_name), "the roster must be named so the author can fix the reference");
        assert.ok(error.message.includes(join(consumer, ".bytedesk", "agent-orchestration", "agents")), "the search path must be shown");
        return true;
      },
    );
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("a system prompt can come from a file, and a missing one is fatal", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-prompt-"));
  try {
    await writeFile(join(consumer, "prompt.md"), "Ship {{inputs.thing}}, {{agent.id}}.\n", "utf8");
    const spec = validateSpec({
      name: "file-prompt",
      inputs: { thing: { default: "the vault" } },
      agents: [{ id: "conductor", role: "orchestrator", cli: "claude", instructions_file: "prompt.md", instructions: "Then stop." }],
    });
    const rendered = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: resolveInputs(spec, {}) });
    assert.equal(rendered.agents[0].instructions, "Ship the vault, conductor.\n\nThen stop.", "the file leads and inline instructions follow");

    const missing = validateSpec({ ...spec, agents: [{ id: "conductor", role: "orchestrator", cli: "claude", instructions_file: "nope.md" }] });
    assert.throws(
      () => materializeSpec(missing, { runId: "r", consumer, home: "/h", inputs: resolveInputs(spec, {}) }),
      (error) => error.code === "TOPOLOGY_INSTRUCTIONS_FILE_NOT_FOUND",
    );
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("mcp is part of the agent schema and is documented", () => {
  const spec = validateSpec({ ...minimal(), agents: [{ id: "conductor", role: "orchestrator", cli: "claude", mcp: ["task-management"] }], workflow: [], gates: [] });
  assert.deepEqual(spec.agents[0].mcp, ["task-management"]);
  assert.deepEqual(validateSpec(minimal()).agents[0].mcp, [], "absent mcp normalizes to an empty list");
  assert.throws(() => validateSpec({ ...minimal(), agents: [{ id: "conductor", role: "orchestrator", cli: "claude", mcp: "fs" }] }), /mcp must be an array/);
  const summary = specSchemaSummary();
  assert.match(summary.fields.agents, /mcp\?\[\]/);
  assert.ok(summary.fields["agents[].mcp"], "the mcp field must be documented for spec authors");
  assert.ok(summary.fields["agents[].agent"], "the library reference must be documented for spec authors");
});

test("a minted agent id is a valid spec agent id", () => {
  // The invariant that binds identity to the spec: an id is minted once and then used as a spec
  // agents[].id, a workflow reference, a tmux session name and a directory name. If the generator
  // can emit something this validator rejects, referencing stored agents from a spec breaks on a
  // coin toss. Many ids, because the failing shape (a leading digit) was intermittent.
  const ids = Array.from({ length: 500 }, () => mintId());
  const spec = validateSpec({
    name: "minted-ids",
    agents: [
      { id: ids[0], role: "orchestrator", cli: "claude" },
      { id: ids[1], role: "worker", cli: "codex" },
    ],
    workflow: [{ stage: "do-it", from: ids[0], to: [ids[1]] }],
  });
  assert.equal(spec.agents[0].id, ids[0]);
  assert.deepEqual(spec.workflow[0].to, [ids[1]]);
  for (const id of ids) {
    assert.doesNotThrow(
      () => validateSpec({ name: "minted-ids", agents: [{ id, role: "orchestrator", cli: "claude" }] }),
      `minted id ${id} must be usable as a spec agent id`,
    );
  }
});

test("a spec may not launch outside the repo that invoked it", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-contain-"));
  try {
    // Built by joining against the temp root rather than hardcoded, so the assertions do not depend
    // on /tmp being a real directory (it is a symlink to /private/tmp on macOS).
    const sibling = join(consumer, "..", "other-repo");
    const spec = (agent, rest = {}) => validateSpec({ name: "contain", agents: [{ id: "conductor", role: "orchestrator", cli: "claude", ...agent }], ...rest });
    const run = (built, context = {}) => materializeSpec(built, { runId: "r", consumer, home: os.homedir(), inputs: {}, ...context });
    const escapes = (built, field) =>
      assert.throws(() => run(built), (error) => {
        assert.equal(error.code, "TOPOLOGY_PATH_ESCAPES_REPO");
        assert.ok(error.message.startsWith(`${field} resolves to `), `the message must name the offending field:\n${error.message}`);
        assert.ok(error.message.includes(consumer), "the message must name the repo the path escaped");
        return true;
      }, `${field} must be contained`);

    for (const cwd of ["/", "~", join("..", "..", "other-repo")]) escapes(spec({}, { cwd }), "cwd");
    escapes(spec({}, { run_dir: join(sibling, "runs", "{{run_id}}") }), "run_dir");
    escapes(spec({ cwd: sibling }), "agents.conductor.cwd");

    // The escape hatch has to stay reachable: `--allow-outside` is the deliberate case, and a flag
    // that no longer reaches containPath fails open silently.
    for (const built of [spec({}, { cwd: "/" }), spec({}, { run_dir: join(sibling, "runs") }), spec({ cwd: sibling })]) {
      assert.doesNotThrow(() => run(built, { allowOutside: true }), "--allow-outside must still let a deliberate escape through");
    }
    assert.equal(run(spec({ cwd: sibling }), { allowOutside: true }).agents[0].cwd, resolve(sibling));

    // The ordinary case is untouched: no cwd means the consumer, and a relative one stays inside it.
    const ordinary = run(spec({}));
    assert.equal(ordinary.cwd, consumer);
    assert.equal(ordinary.agents[0].cwd, consumer);
    assert.equal(run(spec({ cwd: "sub/dir" })).agents[0].cwd, join(consumer, "sub", "dir"));
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("a library agent runs in its own directory; an inline agent still follows the spec cwd", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-cwd-"));
  try {
    const conductor = await createAgent(consumer, { role: "orchestrator" });
    const worker = await createAgent(consumer, { role: "worker" });
    const spec = validateSpec({
      name: "memory-scope",
      cwd: "{{consumer}}",
      agents: [
        { agent: conductor.id },
        { id: "pinned", agent: worker.id, cwd: "sub/dir" },
        { id: "inline", role: "worker", cli: "codex" },
      ],
    });
    const rendered = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: {} });
    const [fromLibrary, pinned, inline] = rendered.agents;

    // cwd is what scopes a CLI's memory, so a roster agent gets its own directory and its own memory.
    assert.equal(fromLibrary.cwd, conductor._dir, "a library agent defaults to its own agent directory");
    assert.notEqual(fromLibrary.cwd, consumer, "two library agents must not share the repo root as cwd");
    assert.ok(existsSync(fromLibrary.cwd), "the directory must exist before a launcher cd's into it");

    assert.equal(pinned.cwd, join(consumer, "sub", "dir"), "an explicit cwd on the entry still wins");
    assert.equal(inline.cwd, consumer, "an inline agent is unaffected — the shipped templates rely on this");
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test("a library agent found outside the consumer still works inside it", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-usercwd-"));
  const library = await mkdtemp(join(os.tmpdir(), "ao-topology-userlib-"));
  try {
    const shared = await createAgent(library, { role: "orchestrator" });
    const spec = validateSpec({ name: "shared-agent", agents: [{ agent: shared.id }] });
    const rendered = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: {}, agentDirs: [agentsRoot(library)] });
    // Memory is per project: a definition shared across repos must not give one repo's run a working
    // directory in another repo — and a cwd outside the consumer would not survive containment.
    assert.equal(rendered.agents[0].cwd, join(consumer, ".bytedesk", "agent-orchestration", "agents", shared.id));
    assert.ok(existsSync(rendered.agents[0].cwd));
    assert.ok(rendered.agents[0].instructions.includes(shared.full_name), "its prompt still comes from where it is stored");
  } finally {
    await rm(consumer, { recursive: true, force: true });
    await rm(library, { recursive: true, force: true });
  }
});

test("coordinates_only reaches the run agent, from the library or declared inline", async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-coord-"));
  try {
    const lead = await createAgent(consumer, { role: "lead" });
    const worker = await createAgent(consumer, { role: "implementer" });
    // A repo's lead appears in a run as the orchestrator — there is no lead role pack and a spec
    // must have exactly one orchestrator — so role cannot be the discriminator downstream.
    const spec = validateSpec({
      name: "coordination",
      agents: [
        { agent: lead.id, role: "orchestrator" },
        { agent: worker.id },
        { id: "inline-coord", role: "reviewer", cli: "codex", coordinates_only: true },
        { id: "inline-worker", role: "worker", cli: "codex" },
      ],
    });
    const [fromLead, fromWorker, inlineCoord, inlineWorker] = materializeSpec(spec, { runId: "r", consumer, home: "/h", inputs: {} }).agents;

    assert.equal(fromLead.role, "orchestrator", "the lead runs as the conductor");
    assert.equal(fromLead.coordinates_only, true, "a library coordinator stays a coordinator on the run agent");
    assert.equal(fromWorker.coordinates_only, false, "an implementer is not a coordinator");
    assert.equal(inlineCoord.coordinates_only, true, "a hand-written spec may declare it without a library record");
    assert.equal(inlineWorker.coordinates_only, false);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});
