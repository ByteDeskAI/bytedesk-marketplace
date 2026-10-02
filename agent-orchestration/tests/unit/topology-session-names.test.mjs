// TM-274 / ADR-0030: session names are `[team--]node--repo--role--persona` and only a label. Identity
// is the `@ao-*` metadata recorded on the session; legacy `ao-<id>` / `<id>-<7 hex>` names are
// recognised until they end. There is no collision suffix: personas come from a registry.
// tmux-backed cases follow .claude/rules/tmux-test-isolation.md: TMUX='', a per-test TMUX_TMPDIR,
// and every command — kill-server included — scoped with -S <socket>.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PART_CAPS, ULID_PATTERN, composeSessionName, legacyRoleSessionName, nodeName, originPath,
  personaCandidates, repoIdentity, sessionIdentity, shortHost, slugPart, ulid,
} from "../../topology/lib/session-names.mjs";
import { localPersonaRegistry, personaScope, releaseRunPersona } from "../../topology/lib/persona-registry.mjs";
import { liveSessionOf, planSession } from "../../topology/lib/launch.mjs";
import * as tmux from "../../topology/lib/tmux.mjs";
import { isolatedTmux } from "../helpers/isolated-tmux.mjs";
import { optOutOfEnrollment } from "../helpers/temp-repo.mjs";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir, ...args) => exec("git", ["-C", dir, ...args], { env: gitEnv });
async function scratch(t, prefix = "ao-names-") {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("segments are slugged to [a-z0-9-] with no '--' inside, so '--' is only the separator", () => {
  assert.equal(slugPart("bytedesk-marketplace (copy)", PART_CAPS.repo), "bytedesk-marketplace-copy");
  assert.equal(slugPart("a--b__c..d", 32), "a-b-c-d", "a run of anything else collapses to ONE dash");
  assert.equal(shortHost("agents1.lan.bytedesk.ai"), "agents1", "a dotted hostname keeps only its first label");
  const solo = composeSessionName({ node: "agents1", repo: "bytedesk-marketplace (copy)", role: "Lead", persona: "Ada" });
  assert.equal(solo, "agents1--bytedesk-marketplace-copy--lead--ada");
  assert.equal(solo.split("--").length, 4);
  const team = composeSessionName({ team: "Core", node: "agents1", repo: "bytedesk-marketplace", role: "reviewer", persona: "linus" });
  assert.equal(team, "core--agents1--bytedesk-marketplace--reviewer--linus");
  assert.doesNotMatch(team, /[.: ()]/, "tmux rewrites '.' and refuses ':'");
});

test("each segment is capped on its own, and an empty one falls back rather than leaving '----'", () => {
  const long = "x".repeat(200);
  const name = composeSessionName({ team: long, node: long, repo: long, role: long, persona: long });
  const caps = [PART_CAPS.team, PART_CAPS.node, PART_CAPS.repo, PART_CAPS.role, PART_CAPS.persona];
  assert.equal(caps.length, 5);
  assert.deepEqual(name.split("--").map((part) => part.length), caps);
  assert.equal(slugPart(`${"a".repeat(PART_CAPS.role - 1)} b`, PART_CAPS.role), "a".repeat(PART_CAPS.role - 1), "no trailing dash after a cap");
  assert.equal(composeSessionName({ team: "  ", node: "...", repo: "()", role: "", persona: null }), "host--repo--agent--agent");
  // The longest possible name must still pass launch's session-name check (160) — planSession asserts it.
  assert.ok(name.length <= 160 && /^[a-z0-9-]{1,160}$/.test(name), `worst-case name is ${name.length} chars`);
});

test("every bundled workflow name fits the role segment untruncated", async () => {
  const dir = join(HERE, "../../workflows");
  const names = (await readdir(dir)).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  assert.ok(names.length >= 2, `found ${names.length} workflows`);
  for (const workflow of names) assert.equal(slugPart(workflow, PART_CAPS.role), workflow, `${workflow} is cut`);
});

test("there is no numeric collision suffix anywhere in the naming code", async () => {
  const sources = ["session-names.mjs", "persona-registry.mjs", "launch.mjs"].map((file) => join(HERE, "../../topology/lib", file));
  assert.equal(sources.length, 3);
  for (const file of sources) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /uniqueSessionName|allocateSessionName|`\$\{base\}-\$\{n\}`/, `${file} still carries a collision suffix`);
  }
});

test("node: AO_NODE_NAME, else node.name in the ao user config, else the short hostname", async (t) => {
  const home = await scratch(t);
  const env = { XDG_CONFIG_HOME: join(home, "config") };
  assert.equal(await nodeName({ env, home, hostname: "Mass-Laptop01.local" }), "mass-laptop01");
  await mkdir(join(home, "config", "agent-orchestration"), { recursive: true });
  await writeFile(join(home, "config", "agent-orchestration", "config.json"), JSON.stringify({ node: { name: "Agents2.lan" } }));
  assert.equal(await nodeName({ env, home, hostname: "ignored" }), "agents2-lan");
  assert.equal(await nodeName({ env: { ...env, AO_NODE_NAME: "agents1" }, home, hostname: "ignored" }), "agents1");
});

test("repo: the origin remote's repository name, owner kept in metadata; folder only with no remote", async (t) => {
  const root = await scratch(t);
  const cases = [
    ["git@github.com:ByteDeskAI/bytedesk-marketplace.git", "ByteDeskAI/bytedesk-marketplace"],
    ["https://github.com/ByteDeskAI/bytedesk-marketplace.git", "ByteDeskAI/bytedesk-marketplace"],
    ["ssh://git@host:2222/org/team/App.Repo/", "team/App.Repo"],
    ["/srv/git/plain.git", "git/plain"],
  ];
  assert.equal(cases.length, 4);
  for (const [url, expected] of cases) assert.equal(originPath(url), expected, url);

  // A folder with spaces and parentheses and NO remote: the folder name, the path as origin.
  const bare = join(root, "bytedesk-marketplace (copy)");
  await mkdir(bare);
  await git(bare, "init", "-q");
  await git(bare, "commit", "-q", "--allow-empty", "-m", "init");
  assert.deepEqual(await repoIdentity(bare), { slug: "bytedesk-marketplace-copy", origin: bare });

  // With an origin: the remote's name wins over the folder, and a linked worktree resolves the same.
  await git(bare, "remote", "add", "origin", "git@github.com:ByteDeskAI/bytedesk-marketplace.git");
  const worktree = join(root, "elsewhere", "feature tree");
  await git(bare, "worktree", "add", "-q", "-b", "feature", worktree);
  const expected = { slug: "bytedesk-marketplace", origin: "ByteDeskAI/bytedesk-marketplace" };
  assert.deepEqual(await repoIdentity(bare), expected);
  assert.deepEqual(await repoIdentity(worktree), expected, "a worktree groups with its repository");
});

test("a ULID is 26 Crockford characters, time-ordered, and distinct per call", () => {
  const a = ulid(1_700_000_000_000), b = ulid(1_700_000_000_001);
  assert.match(a, ULID_PATTERN);
  assert.ok(a.slice(0, 10) < b.slice(0, 10), "the time prefix sorts");
  const many = new Set(Array.from({ length: 500 }, () => ulid()));
  assert.equal(many.size, 500);
});

test("persona: first name, then first-last when the first name is taken in the scope, then the id", async (t) => {
  const home = await scratch(t);
  const registry = localPersonaRegistry({ env: { AGENT_ORCHESTRATION_STATE_HOME: home }, home });
  const scope = personaScope({ repo: "App" });
  assert.equal(scope, "repo:app");
  assert.equal(personaScope({ team: "Core", repo: "x" }), "team:core", "a team scopes the persona when there is one");
  assert.deepEqual(personaCandidates({ full_name: "Ada Lovelace" }), ["ada", "ada-lovelace"]);

  const ada1 = { id: "a1111111", full_name: "Ada Lovelace" };
  const ada2 = { id: "a2222222", full_name: "Ada Byron" };
  const ada3 = { id: "a3333333", first_name: "Ada", last_name: "Byron" };
  assert.equal(await registry.allocate(scope, ada1), "ada");
  assert.equal(await registry.allocate(scope, ada2), "ada-byron", "the first-name pool is exhausted, so a surname is added");
  assert.equal(await registry.allocate(scope, ada3), "a3333333", "both taken: the agent's own id, never a counter");
  assert.equal(await registry.allocate(scope, ada1), "ada", "stable: the same agent gets the same persona again");
  assert.equal(await registry.holder(scope, "ada-byron"), "a2222222");
  assert.equal(await registry.allocate("repo:other", ada2), "ada", "another scope is independent");
  assert.equal(await registry.release(scope, ada1), true);
  assert.equal(await registry.holder(scope, "ada"), null);
  assert.equal(await registry.release(scope, ada1), false);

  // A holder the caller declares stale (a run that ended without a stop) gives its persona back; the
  // caller is told when the persona was allocated, so a run inside its grace period is not reclaimed.
  const seen = [];
  assert.equal(await registry.allocate("repo:runs", { id: "run:A", candidates: ["ada", "bell"] }), "ada");
  assert.equal(await registry.allocate("repo:runs", { id: "run:B", candidates: ["ada", "bell"] }, { isStale: async () => false }), "bell");
  assert.equal(await registry.allocate("repo:runs", { id: "run:C", candidates: ["ada", "bell"] },
    { isStale: async (id, since) => { seen.push([id, since > 0]); return id === "run:A"; } }), "ada");
  assert.deepEqual(seen.sort(), [["run:A", true], ["run:B", true]]);
  assert.equal(await registry.holder("repo:runs", "ada"), "run:C");
});

test("parallel allocators never hand one persona to two agents (in-process and across processes)", async (t) => {
  const home = await scratch(t);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: home };
  const registry = localPersonaRegistry({ env, home });
  const scope = "repo:race/test";
  // Twelve agents in-process, all named Mira: one gets mira, one mira-<last>, the rest their ids.
  const agents = Array.from({ length: 12 }, (_, i) => ({ id: `b${String(i).padStart(7, "0")}`, full_name: i % 2 ? "Mira Halloran" : "Mira Stroud" }));
  const personas = await Promise.all(agents.map((agent) => registry.allocate(scope, agent)));
  assert.equal(personas.length, 12);
  assert.equal(new Set(personas).size, 12, `duplicate persona handed out: ${personas.join(", ")}`);
  assert.equal(personas.filter((p) => p === "mira").length, 1);

  // Six separate processes racing on one fresh scope.
  const module = join(HERE, "../../topology/lib/persona-registry.mjs");
  const script = `const { localPersonaRegistry } = await import(${JSON.stringify(module)});
    const r = localPersonaRegistry({ env: { AGENT_ORCHESTRATION_STATE_HOME: ${JSON.stringify(home)} } });
    process.stdout.write(await r.allocate("repo:race/procs", { id: process.argv[1], full_name: "Noor Vale" }));`;
  const ids = Array.from({ length: 6 }, (_, i) => `c${String(i).padStart(7, "0")}`);
  const outputs = await Promise.all(ids.map((id) => exec(process.execPath, ["--input-type=module", "-e", script, id]).then((r) => r.stdout)));
  assert.equal(outputs.length, 6);
  assert.equal(new Set(outputs).size, 6, `processes collided: ${outputs.join(", ")}`);
  for (const [i, id] of ids.entries()) assert.equal(await registry.holder("repo:race/procs", outputs[i]), id);
});

test("two repos with the same folder name on one node never share a session name, and their metadata differs", async (t) => {
  const root = await scratch(t);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "cfg"), AO_NODE_NAME: "agents1" };
  const repos = [join(root, "a", "app"), join(root, "b", "app")];
  for (const repo of repos) { await mkdir(repo, { recursive: true }); await git(repo, "init", "-q"); }
  // Each repository's own library minted a Wren; both are workers.
  const agents = [{ id: "d1d1d1d1", full_name: "Wren Vale" }, { id: "d2d2d2d2", full_name: "Wren Stroud" }];
  const plans = await Promise.all(repos.map((consumer, i) => planSession({ consumer, role: "worker", agent: agents[i], env, home: root })));
  assert.equal(plans.length, 2);
  // Whichever allocates first is `wren`; the other's first name is taken in scope `repo:app`, so it
  // takes its surname. Same prefix, distinct persona — no suffix, no shared session.
  const personas = plans.map((plan) => plan.name.split("--").pop()).sort();
  assert.ok(["wren,wren-stroud", "wren,wren-vale"].includes(personas.join(",")), personas.join(","));
  assert.ok(plans.every((plan) => plan.name.startsWith("agents1--app--worker--")));
  assert.deepEqual(plans.map((plan) => plan.identity.repoOrigin), repos, "the metadata says which repository");
  assert.notEqual(plans[0].identity.id, plans[1].identity.id);
  for (const [i, plan] of plans.entries()) {
    assert.match(plan.identity.id, ULID_PATTERN);
    assert.deepEqual({ ...plan.identity, id: "x" }, { id: "x", agent: agents[i].id, role: "worker", repo: "app", repoOrigin: repos[i], node: "agents1", team: null, run: null, workflow: null, kind: "role-session" });
  }
  const team = await planSession({ consumer: repos[0], workflow: "Design Studio", team: "Core", runId: "r1", env, home: root });
  assert.equal(team.name, "core--agents1--app--design-studio--ada", "a team run: the workflow is the role, the persona is the run's");
  assert.deepEqual([team.identity.team, team.identity.kind, team.identity.workflow, team.identity.role, team.identity.run], ["core", "run", "Design Studio", "run", "r1"]);
});

test("concurrent runs of one workflow hold distinct personas; release and a vanished run free them", async (t) => {
  const root = await scratch(t);
  await git(root, "init", "-q");
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "cfg"), AO_NODE_NAME: "agents1" };
  const registry = localPersonaRegistry({ env, home: root });
  const runs = Array.from({ length: 8 }, (_, i) => `r${i}`);
  const plans = await Promise.all(runs.map((runId) => planSession({ consumer: root, workflow: "parallel-review", runId, env, home: root, personas: registry })));
  assert.equal(plans.length, 8);
  const names = plans.map((plan) => plan.name);
  assert.equal(new Set(names).size, 8, `two runs share a name: ${names.join(", ")}`);
  const repo = slugPart((await realpath(root)).split("/").pop(), PART_CAPS.repo);
  assert.ok(names.every((name) => name.startsWith(`agents1--${repo}--parallel-review--`)), names.join(", "));
  assert.ok(plans.every((plan) => plan.identity.kind === "run" && plan.identity.workflow === "parallel-review"));

  // Releasing one run frees exactly its persona; the next run picks it up.
  const scope = personaScope({ repo });
  const freed = names[3].split("--").pop();
  assert.equal(await registry.holder(scope, freed), "run:r3");
  assert.equal(await releaseRunPersona(plans[3].identity, { personas: registry }), true);
  assert.equal(await registry.holder(scope, freed), null);
  assert.equal(await releaseRunPersona({ ...plans[3].identity, kind: "spawn" }, { personas: registry }), false, "an agent keeps its persona");
  const next = await planSession({ consumer: root, workflow: "parallel-review", runId: "r8", env, home: root, personas: registry });
  assert.equal(next.name, names[3]);
});

test("identity is read from metadata; legacy shapes are recognised; an ao-looking name alone is not", () => {
  const cases = [
    [{ name: "anything at all", meta: { id: "01J9", agent: "e1f2a3b4", role: "lead" } }, { agentId: "e1f2a3b4", sessionId: "01J9", kind: "role-session", source: "metadata" }],
    [{ name: "agents1--repo--worker--ada", meta: { id: "01JA", agent: "e1f2a3b4", role: "worker", run: "r1" } }, { agentId: "e1f2a3b4", kind: "spawn", source: "metadata" }],
    [{ name: "core--agents1--repo--run--design", meta: { agent: "worker", role: "designer", run: "r1", team: "core", workflow: "design", kind: "run" } }, { agentId: "worker", kind: "run", team: "core", workflow: "design" }],
    [{ name: "x", meta: { agent: "w", run: "r1" } }, { agentId: "w", kind: "spawn" }],
    [{ name: "a1b2c3d4-1f4c9de", meta: { agent: "e1f2a3b4" } }, { agentId: "e1f2a3b4", source: "metadata" }],
    [{ name: legacyRoleSessionName("fd2b831f") }, { agentId: "fd2b831f", kind: "role-session", source: "legacy" }],
    [{ name: "a1b2c3d4-1f4c9de" }, { agentId: "a1b2c3d4", spawn: "1f4c9de", kind: "spawn", source: "legacy" }],
    [{ name: "my-long-agent-id-9f3e21a" }, { agentId: "my-long-agent-id", spawn: "9f3e21a", kind: "spawn", source: "legacy" }],
  ];
  assert.equal(cases.length, 8);
  for (const [input, expected] of cases) {
    const got = sessionIdentity(input);
    for (const [key, value] of Object.entries(expected)) assert.equal(got?.[key], value, `${input.name}: ${key}`);
  }
  const strangers = ["ao-panestate-123", "ao-shell", "ao-", "ao-FD2B831F", "agents1--bytedesk-marketplace--lead--ada", "p1-slow-20260905-061109-nxcp", "agent-9f3e21ab", "", undefined];
  assert.equal(strangers.length, 9);
  for (const name of strangers) assert.equal(sessionIdentity({ name }), null, `${JSON.stringify(name)} has no recorded identity`);
});

const haveTmux = await exec("tmux", ["-V"]).then(() => true, () => false);

test("readers resolve real tmux sessions from their @ao-* options, and one agent holds one live session", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const iso = isolatedTmux(t), { socket, env } = iso;
  assert.equal(env.TMUX, "", "never inherit an operator tmux server");
  const run = (...args) => iso.tmux(["-f", "/dev/null", ...args]);

  const names = ["arbitrary-label", "ao-panestate-1", "ao-a1b2c3d4", "a1b2c3d4-1f4c9de", "agents1--app--lead--ada", "core--agents1--app--run--studio"];
  for (const name of names) await run("new-session", "-d", "-s", name, "sleep", "60");
  const pane = async (name) => (await run("display-message", "-p", "-t", `=${name}:`, "#{pane_id}")).stdout.trim();
  const id = ulid();
  await tmux.withServer(socket, async () => {
    await tmux.setIdentity(await pane("arbitrary-label"), { session: { id, agent: "e1f2a3b4", role: "lead", repo: "app", repoOrigin: "o/app", node: "agents1" } });
    await tmux.setIdentity(await pane("agents1--app--lead--ada"), { session: { id: ulid(), agent: "c1c1c1c1", role: "lead", repo: "app", repoOrigin: "/b/app" } });
    // A team session: the session carries the run, the pane carries its agent.
    await tmux.setIdentity(await pane("core--agents1--app--run--studio"), { session: { id: ulid(), role: "run", run: "r1", team: "core" }, pane: { agent: "f0f0f0f0", role: "designer" } });
  });

  const sessions = await tmux.withServer(socket, () => tmux.listSessionIdentities());
  assert.equal(sessions.length, names.length, "every session was listed");
  const byName = Object.fromEntries(sessions.map((entry) => [entry.name, sessionIdentity(entry)]));
  assert.equal(byName["arbitrary-label"]?.agentId, "e1f2a3b4", "an arbitrary name with metadata is identified");
  assert.equal(byName["arbitrary-label"]?.sessionId, id);
  assert.equal(byName["ao-panestate-1"], null, "an ao-looking name with no metadata and no legacy shape is not");
  assert.equal(byName["ao-a1b2c3d4"]?.agentId, "a1b2c3d4", "a legacy role-session with no options is still recognised");
  assert.equal(byName["a1b2c3d4-1f4c9de"]?.spawn, "1f4c9de", "a legacy spawn with no options is still recognised");
  assert.equal(byName["agents1--app--lead--ada"]?.repoOrigin, "/b/app");
  assert.equal(byName["core--agents1--app--run--studio"]?.agentId, "f0f0f0f0", "a team pane's agent comes from the pane option");
  assert.equal(byName["core--agents1--app--run--studio"]?.team, "core");

  // One agent, one live session — found by metadata, by legacy shape, and through a team pane.
  await tmux.withServer(socket, async () => {
    assert.equal(await liveSessionOf("e1f2a3b4"), "arbitrary-label");
    assert.ok(["ao-a1b2c3d4", "a1b2c3d4-1f4c9de"].includes(await liveSessionOf("a1b2c3d4")), "legacy role and spawn shapes both count");
    assert.equal(await liveSessionOf("f0f0f0f0"), "core--agents1--app--run--studio");
    assert.equal(await liveSessionOf("e1f2a3b4", { except: "arbitrary-label" }), null);
    assert.equal(await liveSessionOf("99999999"), null);
  });

  // The pane listing presence and census read carries the same metadata, and the title still parses.
  const panes = await tmux.listServerPanes({ tmuxServer: socket, env });
  assert.equal(panes.length, names.length);
  const labelled = panes.find((p) => p.sessionName === "arbitrary-label");
  assert.equal(sessionIdentity({ name: labelled.sessionName, meta: labelled.identity })?.agentId, "e1f2a3b4");
  assert.equal(typeof labelled.title, "string");
});

test("two concurrent runs of one workflow in one repo get distinct sessions; stop frees the run's persona", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const consumer = await scratch(t, "ao-runs-");
  await git(consumer, "init", "-q");
  await optOutOfEnrollment(consumer); // TM-290: launch self-starts a supervisor, whose lead would be real
  const tmuxDir = await mkdtemp("/tmp/aot-"); // short: the unix socket path limit is 108 characters
  const env = { ...process.env, TMUX: "", TMUX_PANE: "", TMUX_TMPDIR: tmuxDir, AO_TMUX_COMMAND: "tmux", AO_TRANSPORT: "file",
    AGENT_ORCHESTRATION_SERVICES: "0", AGENT_ORCHESTRATION_STATE_HOME: join(consumer, ".state"), XDG_CONFIG_HOME: join(consumer, ".cfg"), AO_NODE_NAME: "agents1", AO_CONSUMER: consumer };
  assert.equal(env.TMUX, "", "never inherit an operator tmux server");
  const socket = join(tmuxDir, `tmux-${process.getuid()}`, "default");
  t.after(async () => {
    assert.ok(socket.startsWith(`${tmuxDir}/`), `refusing to kill a tmux server outside this test's TMUX_TMPDIR: ${socket}`);
    await exec("tmux", ["-S", socket, "kill-server"], { env }).catch(() => {});
    await rm(tmuxDir, { recursive: true, force: true });
  });
  const cli = join(HERE, "../../topology/cli.mjs");
  const fakeAgent = join(HERE, "../fixtures/fake-agent.mjs");
  const ao = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, "--consumer", consumer, "--json"], { env, timeout: 120_000 })).stdout);
  const specPath = join(consumer, "spec.json");
  await writeFile(specPath, JSON.stringify({ version: 1, name: "parallel-review", layout: "grid", agents: [
    { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "fable", args: [fakeAgent] },
    { id: "worker-a", role: "worker", cli: "fake-agent", model: "w1", args: [fakeAgent] },
  ] }));
  const launch = (runId) => ao("launch", "--spec", specPath, "--providers-dir", join(HERE, "../fixtures"), "--run-id", runId);
  const launched = await Promise.all([launch("run-one"), launch("run-two")]);
  assert.equal(launched.length, 2);
  const sessions = launched.map((run) => run.session);
  assert.notEqual(sessions[0], sessions[1], "the second run of the workflow coexists under its own name");
  const repo = slugPart(consumer.split("/").pop(), PART_CAPS.repo);
  for (const session of sessions) assert.match(session, new RegExp(`^agents1--${repo}--parallel-review--[a-z0-9-]+$`));

  // Both live on the isolated server, each carrying its run and workflow as metadata.
  const live = await tmux.withServer(socket, () => tmux.listSessionIdentities());
  const runOf = Object.fromEntries(live.filter((entry) => sessions.includes(entry.name)).map((entry) => [entry.name, entry.meta]));
  assert.equal(Object.keys(runOf).length, 2);
  assert.deepEqual(sessions.map((session) => [runOf[session].run, runOf[session].workflow, runOf[session].kind]),
    [["run-one", "parallel-review", "run"], ["run-two", "parallel-review", "run"]]);

  // Stop the first: its persona is released, the second still holds its own.
  const registry = localPersonaRegistry({ env, home: consumer });
  const scope = personaScope({ repo });
  const personas = sessions.map((session) => session.split("--").pop());
  assert.equal(await registry.holder(scope, personas[0]), "run:run-one");
  const stopped = await ao("stop", "--run", launched[0].runDir);
  assert.equal(stopped.ok, true, JSON.stringify(stopped.failures));
  assert.equal(await registry.holder(scope, personas[0]), null, "stop released the run's persona");
  assert.equal(await registry.holder(scope, personas[1]), "run:run-two");
});
