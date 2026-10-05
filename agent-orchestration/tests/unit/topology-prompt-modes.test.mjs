// TM-296: config get/set/validate, prompt preview --role, the global prefix layer, add/replace
// prompt entries, agent set-instructions — and a golden proving plain-string configs are unchanged.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadConfig, readConfigLayer, validateConfigShape, writeConfigLayer } from "../../topology/lib/config.mjs";
import { composePrompt } from "../../topology/lib/prompts.mjs";
import { writeJson } from "../../topology/lib/util.mjs";
import { composeGolden } from "../fixtures/prompt-golden/build.mjs";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../../topology/cli.mjs", import.meta.url));
const GOLDEN = fileURLToPath(new URL("../fixtures/prompt-golden/", import.meta.url));
const AGENT = { id: "mode0001", full_name: "Mo De", title: "Worker", role: "worker", instructions: "" };

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "ao-modes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const xdg = join(root, "xdg"), gdir = join(xdg, "agent-orchestration"), consumer = join(root, "repo");
  const rdir = join(consumer, ".bytedesk", "agent-orchestration"), plugin = join(root, "plugin");
  await Promise.all([gdir, rdir, plugin].map((dir) => mkdir(dir, { recursive: true })));
  const load = () => loadConfig({ consumer, home: join(root, "home"), pluginRoot: plugin, env: { XDG_CONFIG_HOME: xdg } });
  return { root, xdg, gdir, consumer, rdir, plugin, load };
}

test("plain-string configs compose byte-identically to the pre-TM-296 golden", async (t) => {
  for (const role of ["worker", "reviewer"]) {
    const root = await mkdtemp(join(tmpdir(), "ao-golden-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const composed = await composeGolden(root, role);
    assert.equal(composed.ok, true);
    assert.equal(composed.sources.length, 10, "every layer shape is exercised");
    assert.equal(composed.text, await readFile(join(GOLDEN, `${role}.md`), "utf8"));
  }
});

test("the global prefix composes first, changes the revision, and is ignored with a warning elsewhere", async (t) => {
  const s = await scratch(t);
  const before = await composePrompt({ agent: AGENT, consumer: s.consumer, dir: "/d", loaded: await s.load() });
  await writeFile(join(s.gdir, "prefix.md"), "HOUSE PREFIX\n");
  await writeJson(join(s.gdir, "config.json"), { prompts: { prefix: "./prefix.md" } });
  await writeJson(join(s.rdir, "config.json"), { prompts: { prefix: { text: "REPO PREFIX" } } });
  const after = await composePrompt({ agent: AGENT, consumer: s.consumer, dir: "/d", loaded: await s.load() });
  assert.equal(after.ok, true);
  assert.deepEqual(after.sources.map((x) => x.layer), ["global prefix", "generated"]);
  assert.ok(after.text.startsWith("HOUSE PREFIX\n\n# Mo De"));
  assert.ok(!after.text.includes("REPO PREFIX"));
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.warnings.length, 1);
  assert.match(after.warnings[0], /honoured only in the global config layer/);
  assert.ok(after.text.includes("grants no permissions"), "the generated permission rule survives a prefix");
});

test("replace drops the same slot from wider layers at global, repo, role and agent", async (t) => {
  const s = await scratch(t);
  await writeJson(join(s.plugin, "config.defaults.json"), {
    templates: { t: { role: "worker", instructions: "TEMPLATE TEXT" } },
    prompts: { common: { text: "DEFAULT COMMON" }, roles: { worker: { text: "DEFAULT ROLE" } } },
  });
  await writeJson(join(s.gdir, "config.json"), { prompts: { common: { text: "GLOBAL COMMON", mode: "replace" }, roles: { worker: { text: "GLOBAL ROLE" } } } });
  await writeFile(join(s.rdir, "role.md"), "REPO ROLE\n");
  await writeJson(join(s.rdir, "config.json"), { prompts: { common: { text: "REPO COMMON" }, roles: { worker: { file: "./role.md", mode: "replace" } } } });
  const loaded = await s.load();
  assert.deepEqual(loaded.errors, []);
  const appended = await composePrompt({ agent: { ...AGENT, instructions: "OWN" }, consumer: s.consumer, dir: "/d", loaded, templateName: "t" });
  assert.deepEqual(appended.sources.map((x) => x.layer), ["generated", "template", "global common", "repo common", "repo role:worker", "per-agent"]);
  for (const gone of ["DEFAULT COMMON", "DEFAULT ROLE", "GLOBAL ROLE"]) assert.ok(!appended.text.includes(gone), gone);
  const replaced = await composePrompt({ agent: { ...AGENT, instructions: "OWN", instructions_mode: "replace" }, consumer: s.consumer, dir: "/d", loaded, templateName: "t" });
  assert.deepEqual(replaced.sources.map((x) => x.layer), ["generated", "global common", "repo common", "repo role:worker", "per-agent"]);
  assert.equal(replaced.sources.at(-1).mode, "replace");
});

test("validateConfigShape accepts entry objects and names every malformed one", () => {
  assert.deepEqual(validateConfigShape({ prompts: { prefix: { text: "x" }, common: { file: "a.md", mode: "replace" }, common_by_role: { reviewer: "r.md" }, roles: { lead: { text: "y", mode: "append" } } } }, "L"), []);
  const errors = validateConfigShape({ prompts: { prefix: { text: "x", mode: "replace" }, common: { file: "a", text: "b" }, roles: { lead: { text: "y", mode: "prepend" }, worker: 7 } } }, "L");
  assert.deepEqual(errors, [
    'L: prompt "common" must have exactly one of "file" or "text"',
    'L: prompt "lead" field "mode" must be "append" or "replace"',
    'L: prompt "worker" must be a Markdown path or an object with "file" or "text"',
    'L: prompt "prefix" has unknown key "mode"',
  ]);
});

test("config layers: get reports the revision, set validates first and refuses a stale revision", async (t) => {
  const s = await scratch(t);
  const options = { consumer: s.consumer, env: { XDG_CONFIG_HOME: s.xdg } };
  assert.equal((await readConfigLayer("repo", options)).revision, "absent");
  const first = await writeConfigLayer("repo", { prompts: { common: "./c.md" } }, { ...options, ifRevision: "absent" });
  const read = await readConfigLayer("repo", options);
  assert.equal(read.revision, first.revision);
  assert.deepEqual(read.document, { prompts: { common: "./c.md" } });
  await assert.rejects(writeConfigLayer("repo", { enabled: true }, { ...options, ifRevision: "absent" }), { code: "TOPOLOGY_CONFIG_STALE" });
  await assert.rejects(writeConfigLayer("repo", { enabled: "yes" }, options), { code: "TOPOLOGY_CONFIG_INVALID" });
  assert.equal((await readConfigLayer("repo", options)).revision, first.revision, "a refused write leaves the file untouched");
});

test("CLI: config get/set/validate, prompt preview --role/--agent, agent set-instructions", async (t) => {
  const s = await scratch(t);
  await exec("git", ["init", "-q", s.consumer]);
  const env = { ...process.env, XDG_CONFIG_HOME: s.xdg, AGENT_ORCHESTRATION_STATE_HOME: join(s.root, "state"), TMUX: "" };
  const run = async (...args) => JSON.parse((await exec(process.execPath, [CLI, ...args, "--consumer", s.consumer, "--json"], { env, cwd: s.consumer })).stdout);
  const fails = (...args) => exec(process.execPath, [CLI, ...args, "--consumer", s.consumer, "--json"], { env, cwd: s.consumer }).then(() => null, (error) => JSON.parse(error.stdout));

  const doc = join(s.root, "global.json");
  await writeJson(doc, { prompts: { prefix: { text: "CLI PREFIX" } } });
  const got = await run("config", "get", "--scope", "global");
  assert.equal(got.revision, "absent");
  const set = await run("config", "set", "--scope", "global", "--file", doc, "--if-revision", got.revision);
  assert.equal((await run("config", "get", "--scope", "global")).revision, set.revision);
  assert.equal((await fails("config", "set", "--scope", "global", "--file", doc, "--if-revision", "absent")).code, "TOPOLOGY_CONFIG_STALE");
  await writeJson(join(s.root, "bad.json"), { prompts: { common: { mode: "replace" } } });
  assert.equal((await fails("config", "set", "--scope", "repo", "--file", join(s.root, "bad.json"))).code, "TOPOLOGY_CONFIG_INVALID");
  assert.equal((await run("config", "validate", "--file", join(s.root, "bad.json"))).ok, false);

  const byRole = await run("prompt", "preview", "--role", "worker");
  assert.equal(byRole.sources[0].layer, "global prefix");
  assert.ok(byRole.text.startsWith("CLI PREFIX"));

  const created = await run("agent", "new", "--role", "worker", "--name", "Ada Mode");
  const outside = join(s.root, "own.md");
  await writeFile(outside, "OUTSIDE\n");
  const refused = await fails("agent", "set-instructions", created.id, "--file", outside);
  assert.equal(refused?.code, "TOPOLOGY_INSTRUCTIONS_FILE_OUTSIDE_REPO", "a host path outside the repository is never stored in tracked agent.json");
  await mkdir(join(s.consumer, "docs"));
  const own = join(s.consumer, "docs", "own.md");
  await writeFile(own, "OWN FILE\n");
  const updated = await run("agent", "set-instructions", created.id, "--file", own, "--mode", "replace");
  assert.equal(updated.instructions_mode, "replace");
  assert.equal(updated.instructions_file, relative(created.dir, own), "stored relative to the agent directory");
  assert.ok(!isAbsolute(JSON.parse(await readFile(updated.file, "utf8")).instructions_file));
  const preview = await run("prompt", "preview", "--agent", created.id);
  assert.deepEqual(preview.sources.at(-1), { layer: "per-agent file", path: own, sha256: preview.sources.at(-1).sha256, mode: "replace" });
  await writeFile(join(created.dir, "notes.md"), "NOTES\n");
  assert.equal((await run("agent", "set-instructions", created.id, "--file", join(created.dir, "notes.md"))).instructions_file, "notes.md");
  assert.equal((await fails("agent", "set-instructions", created.id, "--text", "x", "--file", own)).code, "TOPOLOGY_INSTRUCTIONS_SOURCE");
});

test("replace never drops role protocol: a reviewer keeps its review_submit protocol after global, repo and agent replaces", async (t) => {
  const s = await scratch(t);
  const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));
  await writeJson(join(s.gdir, "config.json"), { prompts: { common: { text: "GLOBAL COMMON", mode: "replace" }, roles: { reviewer: { text: "GLOBAL REVIEWER", mode: "replace" } } } });
  const loaded = await loadConfig({ consumer: s.consumer, home: join(s.root, "home"), pluginRoot, env: { XDG_CONFIG_HOME: s.xdg } });
  assert.deepEqual(loaded.errors, []);
  const reviewer = { id: "rev00001", full_name: "Re View", title: "Reviewer", role: "reviewer", instructions: "OWN", instructions_mode: "replace" };
  const composed = await composePrompt({ agent: reviewer, consumer: s.consumer, dir: "/d", loaded, templateName: "reviewer-default" });
  assert.equal(composed.ok, true);
  assert.match(composed.text, /review_submit/, "the reviewer template's verdict protocol survives");
  const layers = composed.sources.map((x) => x.layer);
  assert.ok(layers.includes("template") && layers.includes("defaults common"), layers.join(","));
  for (const operator of ["GLOBAL COMMON", "GLOBAL REVIEWER", "OWN"]) assert.ok(composed.text.includes(operator), operator);
  assert.equal(composed.warnings.length, 2, composed.warnings.join("\n"));
  assert.ok(composed.warnings.some((w) => /global common: "replace" keeps the defaults common text/.test(w)));
  assert.ok(composed.warnings.some((w) => /per-agent: "replace" keeps the template text/.test(w)));
  // A worker has no protocol slot: the same replaces drop the wider text, with no warning.
  const worker = await composePrompt({ agent: { ...reviewer, role: "worker" }, consumer: s.consumer, dir: "/d", loaded });
  assert.deepEqual(worker.warnings, []);
  assert.ok(!worker.sources.some((x) => x.layer === "defaults common"));
});
