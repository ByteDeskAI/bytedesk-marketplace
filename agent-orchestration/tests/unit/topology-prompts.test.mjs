import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../../topology/lib/config.mjs";
import { composePrompt, generatedPrompt, promptStatePath, readPromptState } from "../../topology/lib/prompts.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

const scratch = () => mkdtemp(join(tmpdir(), "ao-prompts-"));

const AGENT = {
  id: "abc12345",
  full_name: "Mira Thorne",
  first_name: "Mira",
  last_name: "Thorne",
  title: "Engineering Lead",
  role: "lead",
  instructions: "",
};

async function setup(t) {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, "plugin");
  const home = join(root, "home");
  const consumer = join(root, "consumer");
  const xdg = join(root, "xdg");
  const gdir = join(xdg, "agent-orchestration");
  await writeFile(join(plugin, "lead-default.md"), "TEMPLATE LAYER\n", { encoding: "utf8", flag: "w" }).catch(() => {});
  await writeJson(join(plugin, "config.defaults.json"), {
    templates: { "lead-default": { role: "lead", cli: "claude", prompt: "./lead-default.md" } },
  });
  await writeFile(join(plugin, "lead-default.md"), "TEMPLATE LAYER\n", "utf8");
  await writeJson(join(gdir, "config.json"), { prompts: { common: "./common.md", roles: { lead: "./lead.md" } } });
  await writeFile(join(gdir, "common.md"), "GLOBAL COMMON\n", "utf8");
  await writeFile(join(gdir, "lead.md"), "GLOBAL LEAD ROLE\n", "utf8");
  await writeJson(join(consumer, ".bytedesk", "agent-orchestration", "config.json"), { prompts: { common: "./repo.md" } });
  await writeFile(join(consumer, ".bytedesk", "agent-orchestration", "repo.md"), "REPO COMMON\n", "utf8");
  const loaded = await loadConfig({ consumer, home, pluginRoot: plugin, env: { XDG_CONFIG_HOME: xdg } });
  return { root, plugin, home, consumer, xdg, loaded };
}

test("the resolver composes every layer in order and hashes each source", async (t) => {
  const { consumer, loaded } = await setup(t);
  assert.equal(loaded.errors.length, 0);
  const composed = await composePrompt({ agent: AGENT, consumer, dir: join(consumer, "agents", AGENT.id), loaded, templateName: "lead-default" });

  const order = composed.sources.map((source) => source.layer);
  assert.deepEqual(order, ["generated", "template", "global common", "global role:lead", "repo common"]);
  for (const source of composed.sources) assert.match(source.sha256, /^[0-9a-f]{12}$/);
  assert.match(composed.revision, /^[0-9a-f]{16}$/);

  // Repo common is an ADDITION after global common, not a replacement of it.
  const body = composed.text;
  assert.ok(body.indexOf("GLOBAL COMMON") < body.indexOf("REPO COMMON"), "repo additions follow the global layer");
  assert.ok(body.indexOf("TEMPLATE LAYER") < body.indexOf("GLOBAL COMMON"), "the template precedes shared layers");
  assert.ok(body.includes("grants no permissions"), "the generated layer states the permission rule");

  // Per-agent instructions compose last and change the revision.
  const withOwn = await composePrompt({ agent: { ...AGENT, instructions: "PER AGENT" }, consumer, dir: "x", loaded, templateName: "lead-default" });
  assert.deepEqual(withOwn.sources.map((s) => s.layer).at(-1), "per-agent");
  assert.notEqual(withOwn.revision, composed.revision);
});

test("missing configured files are visible, never silent", async (t) => {
  const { consumer, loaded } = await setup(t);
  loaded.layers.find((l) => l.scope === "global").raw.prompts.roles.lead = "./gone.md";
  const composed = await composePrompt({ agent: AGENT, consumer, dir: "x", loaded, templateName: "lead-default" });
  assert.equal(composed.missing.length, 1);
  assert.equal(composed.missing[0].layer, "global role:lead");
  assert.ok(!composed.text.includes("GLOBAL LEAD ROLE"));

  const noTemplate = await composePrompt({ agent: AGENT, consumer, dir: "x", loaded, templateName: "not-defined" });
  assert.equal(noTemplate.missing[0].layer, "template");
});

test("the generated layer explains the cwd discipline and states the permission rule", () => {
  const text = generatedPrompt(AGENT, "/repo", "/repo/agents/abc12345");
  assert.ok(text.includes("/repo/agents/abc12345"));
  assert.ok(text.includes("NOT the project"));
  assert.ok(text.includes("grants no permissions"));
});

test("prompt state lives beside the agent and survives a missing or corrupt file", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await readPromptState(root), null);
  assert.equal(promptStatePath(root), join(root, "prompt-state.json"));
  await writeFile(promptStatePath(root), "{ broken", "utf8");
  assert.equal(await readPromptState(root), null, "a corrupt state file reads as absent, not as a crash");
});

test("defaults common and role policy compose for workers and customized leads", async t => {
  const { plugin, consumer, loaded } = await setup(t);
  const defaults = loaded.layers.find(l => l.scope === "defaults");
  defaults.raw.prompts = { common: "./common.md", roles: { lead: "./role.md", reviewer: "./role.md" } };
  await writeFile(join(plugin, "common.md"), "BUNDLED COMMON");
  await writeFile(join(plugin, "role.md"), "BUNDLED ROLE");
  const worker = await composePrompt({ agent: { ...AGENT, role: "worker" }, consumer, dir: "x", loaded: { ...loaded, layers: [defaults] } });
  assert.equal(worker.ok, true);
  assert.deepEqual(worker.sources.map(s => s.layer), ["generated", "defaults common"]);
  assert.match(worker.text, /BUNDLED COMMON/);
  for (const role of ["lead", "reviewer"]) {
    const result = await composePrompt({ agent: { ...AGENT, role, instructions: "CUSTOM" }, consumer, dir: "x", loaded, templateName: "lead-default" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.sources.map(s => s.layer), ["generated", "template", "defaults common", `defaults role:${role}`, "global common", ...(role === "lead" ? ["global role:lead"] : []), "repo common", "per-agent"]);
  }
});

test("required template absence cannot silently fall back to inline instructions", async t => {
  const { plugin, consumer, loaded } = await setup(t);
  loaded.layers[0].raw.templates["lead-default"].instructions = "FALLBACK MUST NOT HIDE POLICY LOSS";
  await rm(join(plugin, "lead-default.md"));
  const result = await composePrompt({ agent: AGENT, consumer, dir: "x", loaded, templateName: "lead-default" });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].layer, "template");
  assert.match(result.errors[0].note, /ENOENT/);
  assert.doesNotMatch(result.text, /FALLBACK MUST NOT/);
});

test("unreadable source and invalid config yield structured refusal", async t => {
  const { plugin, consumer, loaded } = await setup(t);
  // Reading a directory provides a deterministic I/O error even under privileged CI users.
  loaded.layers[0].raw.templates["lead-default"].prompt = ".";
  const result = await composePrompt({ agent: AGENT, consumer, dir: "x", loaded, templateName: "lead-default" });
  assert.equal(result.ok, false); assert.match(result.errors[0].note, /EISDIR/);
  const badConfig = await composePrompt({ agent: AGENT, consumer, dir: "x", loaded: { ...loaded, errors: [{ message: "bad JSON", path: "config.json" }] } });
  assert.equal(badConfig.ok, false); assert.equal(badConfig.errors[0].message, "bad JSON");
  assert.doesNotMatch(generatedPrompt({ ...AGENT, coordinates_only: true }, consumer, plugin), /have been granted access/);
});
