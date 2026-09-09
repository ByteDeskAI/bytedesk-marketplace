import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findTemplate, globalConfigPath, loadConfig, mergeConfig, repoConfigPath, resolveConfigPath, validateConfigShape } from "../../topology/lib/config.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

const scratch = () => mkdtemp(join(tmpdir(), "ao-config-"));

test("config paths follow XDG and the repo convention", () => {
  assert.equal(globalConfigPath("/home/x", {}), join("/home/x", ".config", "agent-orchestration", "config.json"));
  assert.equal(globalConfigPath("/home/x", { XDG_CONFIG_HOME: "/xdg" }), join("/xdg", "agent-orchestration", "config.json"));
  assert.equal(repoConfigPath("/repo"), join("/repo", ".bytedesk", "agent-orchestration", "config.json"));
});

test("merge is deep for objects and wholesale for arrays", () => {
  const merged = mergeConfig(
    { lead: { template: "a", provider: "claude" }, templates: { t: { cli: "claude" } }, skills: ["one"] },
    { lead: { provider: "codex" }, templates: { t: { model: "m" }, u: { cli: "kimi" } }, skills: ["two"] },
  );
  assert.deepEqual(merged.lead, { template: "a", provider: "codex" });
  assert.deepEqual(merged.templates.t, { cli: "claude", model: "m" });
  assert.deepEqual(merged.templates.u, { cli: "kimi" });
  assert.deepEqual(merged.skills, ["two"], "an array is replaced, not concatenated — two layers' arrays merged is a config nobody wrote");
});

test("shape check reports every problem without aborting", () => {
  assert.deepEqual(validateConfigShape({ lead: { template: "x" } }, "test"), []);
  const errors = validateConfigShape({ lead: "nope", templates: { bad: { surprise: 1 } }, prompts: { roles: ["x"] } }, "test");
  assert.equal(errors.length, 3);
  assert.ok(errors.every((message) => message.startsWith("test:")));
});

test("layers load in precedence order; bad JSON is reported and contributes nothing", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, "plugin");
  const home = join(root, "home");
  const consumer = join(root, "consumer");
  const xdg = join(root, "xdg");

  await writeJson(join(plugin, "config.defaults.json"), {
    lead: { template: "lead-default" },
    templates: { "lead-default": { role: "lead", cli: "claude" } },
  });
  await writeJson(join(xdg, "agent-orchestration", "config.json"), {
    lead: { provider: "kimi" },
    templates: { custom: { role: "worker", cli: "kimi" } },
  });
  await writeJson(repoConfigPath(consumer), { prompts: { common: "./common.md" } });

  const loaded = await loadConfig({ consumer, home, pluginRoot: plugin, env: { XDG_CONFIG_HOME: xdg } });
  assert.equal(loaded.errors.length, 0);
  assert.deepEqual(loaded.config.lead, { template: "lead-default", provider: "kimi" });
  assert.equal(loaded.config.prompts.common, "./common.md");
  assert.equal(loaded.layers.filter((layer) => layer.ok && layer.present).length, 3);

  // The repo layer is an ADDITION: the global template survives alongside the repo's prompts.
  const custom = findTemplate(loaded.layers, "custom");
  assert.equal(custom.scope, "global");
  assert.equal(custom.dir, dirname(join(xdg, "agent-orchestration", "config.json")));
  assert.equal(findTemplate(loaded.layers, "lead-default").scope, "defaults");
  assert.equal(findTemplate(loaded.layers, "nope"), null);

  // Now break the global file: the layer reports the error and yields nothing.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(xdg, "agent-orchestration", "config.json"), "{ not json", "utf8");
  const broken = await loadConfig({ consumer, home, pluginRoot: plugin, env: { XDG_CONFIG_HOME: xdg } });
  assert.equal(broken.errors.length, 1);
  assert.equal(broken.errors[0].scope, "global");
  assert.equal(broken.config.lead.provider, undefined, "a broken layer contributes nothing");
  assert.equal(broken.config.lead.template, "lead-default", "healthy layers still load");
});

test("config-relative prompt paths resolve against the file that named them", () => {
  assert.equal(resolveConfigPath("./prompts/lead.md", "/cfg"), join("/cfg", "prompts", "lead.md"));
  assert.equal(resolveConfigPath("/abs/p.md", "/cfg"), "/abs/p.md");
  assert.equal(resolveConfigPath(null, "/cfg"), null);
});

test("configured prompt values must be paths; inherited templates are not definitions", () => {
  assert.equal(validateConfigShape({ prompts: { common: 42, roles: { lead: null } }, templates: { t: { prompt: [] } } }, "test").length, 3);
  assert.equal(findTemplate([{ scope: "repo", ok: true, present: true, dir: "/cfg", raw: { templates: {} } }], "toString"), null);
  const merged = mergeConfig({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(merged, "__proto__"), true);
});
