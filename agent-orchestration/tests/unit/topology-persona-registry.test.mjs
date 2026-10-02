// TM-279 / ADR-0030 part 3: the team persona registry on NATS KV.
//
// One conformance table runs against both registries, so the NATS one is a drop-in for the local one.
// The NATS cases start a throwaway JetStream nats-server (random port, temp store) and kill it by its
// own PID only — never by name: unrelated nats-server processes run on this machine. They skip when
// no working nats-server binary exists. No test here touches tmux.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { firstNames } from "../../topology/lib/identity.mjs";
import { findNatsServer } from "../../topology/lib/nats-local.mjs";
import { jetStreamDomain, openNatsTransport } from "../../topology/lib/orch-transport.mjs";
import {
  localPersonaRegistry, natsPersonaRegistry, personaKey, personaRegistryFor,
} from "../../topology/lib/persona-registry.mjs";
import { planSession } from "../../topology/lib/launch.mjs";
import { validateConfigShape } from "../../topology/lib/config.mjs";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, "../../topology/lib/persona-registry.mjs");
const TRANSPORT = join(HERE, "../../topology/lib/orch-transport.mjs");

async function scratch(t, prefix = "ao-personas-") {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function untilConnect(port, deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`nats-server did not open port ${port}`);
}

/** Kill one process by its own PID, never by name, and wait until it is gone. */
async function killPid(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { process.kill(child.pid, "SIGKILL"); } catch { return; }
  await exited;
}

let binary;
const natsBinary = async () => (binary ??= await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? "" }));

/** A throwaway server from a config file. Returns its client URL. */
async function startServer(t, root, name, config) {
  const conf = join(root, `${name}.conf`);
  await writeFile(conf, config);
  const child = spawn(await natsBinary(), ["-c", conf], { stdio: "ignore" });
  t.after(() => killPid(child));
  return child;
}

async function jetStreamServer(t, root) {
  const port = await freePort();
  const store = join(root, "js");
  await mkdir(store, { recursive: true });
  await startServer(t, root, "single", `listen: 127.0.0.1:${port}\njetstream { store_dir: ${JSON.stringify(store)} }\n`);
  await untilConnect(port);
  return `nats://127.0.0.1:${port}`;
}

/** An env with no route to the operator's NATS, config or state: only the URL a test names. */
function natsEnv(root, url, extra = {}) {
  return { AO_TRANSPORT: "nats", AO_NATS_URL: url, AO_NATS_AUTOSTART: "0", AGENT_ORCHESTRATION_SERVICES: "0",
    XDG_CONFIG_HOME: join(root, "cfg"), AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), ...extra };
}

async function openTransport(t, root, url, extra = {}, name = "ao-tm279-test") {
  const transport = await openNatsTransport({ env: natsEnv(root, url, extra), name });
  t.after(() => transport.close({ force: true }));
  return transport;
}

// ── Conformance: one table, both registries ─────────────────────────────────────────────────────────

const CONFORMANCE = [
  ["first name, then first-last, then the holder's id; stable for the same holder", async (registry, scope) => {
    const ada1 = { id: "a1111111", full_name: "Ada Lovelace" };
    const ada2 = { id: "a2222222", full_name: "Ada Byron" };
    const ada3 = { id: "a3333333", first_name: "Ada", last_name: "Byron" };
    assert.equal(await registry.allocate(scope, ada1), "ada");
    assert.equal(await registry.allocate(scope, ada2), "ada-byron");
    assert.equal(await registry.allocate(scope, ada3), "a3333333");
    assert.equal(await registry.allocate(scope, ada1), "ada", "idempotent: a held persona is returned");
    assert.equal(await registry.holder(scope, "ada-byron"), "a2222222");
    assert.equal(await registry.holder(scope, "nobody"), null);
  }],
  ["release frees exactly the holder's persona, and reports whether it held one", async (registry, scope) => {
    const run = { id: "run:r1", candidates: ["ada", "bell"] };
    assert.equal(await registry.allocate(scope, run), "ada");
    assert.equal(await registry.allocate(scope, { id: "run:r2", candidates: ["ada", "bell"] }), "bell");
    assert.equal(await registry.release(scope, run), true);
    assert.equal(await registry.holder(scope, "ada"), null);
    assert.equal(await registry.holder(scope, "bell"), "run:r2");
    assert.equal(await registry.release(scope, run), false);
    assert.equal(await registry.allocate(scope, { id: "run:r3", candidates: ["ada", "bell"] }), "ada", "a released persona is free again");
  }],
  ["scopes are independent", async (registry, scope) => {
    assert.equal(await registry.allocate(scope, { id: "e1111111", full_name: "Noor Vale" }), "noor");
    assert.equal(await registry.allocate(`${scope}-other`, { id: "e2222222", full_name: "Noor Stroud" }), "noor");
  }],
  ["concurrent allocators in one process never share a persona", async (registry, scope) => {
    const began = Date.now();
const holders = Array.from({ length: 12 }, (_, i) => ({ id: `run:c${i}`, candidates: firstNames().slice(0, 8) }));
    const personas = await Promise.all(holders.map((holder) => registry.allocate(scope, holder)));
    assert.equal(personas.length, 12);
    assert.equal(new Set(personas).size, 12, `duplicate persona: ${personas.join(", ")}`);
  }],
];

for (const [name, check] of CONFORMANCE) {
  test(`conformance (local): ${name}`, async (t) => {
    const home = await scratch(t);
    await check(localPersonaRegistry({ env: { AGENT_ORCHESTRATION_STATE_HOME: home }, home }), "team:conf");
  });
  test(`conformance (nats): ${name}`, { timeout: 30_000 }, async (t) => {
    if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
    const root = await scratch(t);
    const transport = await openTransport(t, root, await jetStreamServer(t, root));
    await check(natsPersonaRegistry({ transport }), "team:conf");
  });
}

// ── Selection and the unreachable case ──────────────────────────────────────────────────────────────

test("a team scope never falls back to the local registry when NATS is unreachable; a repo scope keeps working", { timeout: 30_000 }, async (t) => {
  const root = await scratch(t);
  await exec("git", ["-C", root, "init", "-q"]);
  const dead = `nats://127.0.0.1:${await freePort()}`; // nothing listens there
  const env = natsEnv(root, dead, { AO_NODE_NAME: "agents1" });

  await assert.rejects(personaRegistryFor("team:core", { env, home: root }), (error) => {
    assert.equal(error.code, "TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE");
    assert.match(error.message, /Team "core"/);
    assert.match(error.message, /never taken from the local registry/);
    return true;
  });
  await assert.rejects(planSession({ consumer: root, workflow: "parallel-review", team: "Core", runId: "r1", env, home: root }),
    { code: "TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE" });

  const local = await personaRegistryFor("repo:app", { env, home: root });
  assert.equal(local.kind, "local");
  const solo = await planSession({ consumer: root, workflow: "parallel-review", runId: "r2", env, home: root });
  assert.match(solo.name, /^agents1--.+--parallel-review--[a-z]+$/, "repo scope allocates from the local registry with NATS down");

  // The file double is the explicit single-host transport, so a team there stays local by design.
  assert.equal((await personaRegistryFor("team:core", { env: { ...env, AO_TRANSPORT: "file" }, home: root })).kind, "local");
});

test("a reachable NATS gives a team scope the NATS registry, and planSession records who holds what", { timeout: 30_000 }, async (t) => {
  if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
  const root = await scratch(t);
  await exec("git", ["-C", root, "init", "-q"]);
  const url = await jetStreamServer(t, root);
  const transport = await openTransport(t, root, url);
  const env = natsEnv(root, url, { AO_NODE_NAME: "agents1" });
  const registry = await personaRegistryFor("team:core", { env, home: root, transport });
  assert.equal(registry.kind, "nats");

  const plan = await planSession({ consumer: root, workflow: "parallel-review", team: "Core", runId: "r1", env, home: root, personas: registry });
  assert.match(plan.name, /^core--agents1--.+--parallel-review--ada$/);
  const entry = await (await transport.personaKv()).get(personaKey("team:core", "ada"));
  const record = entry.json();
  assert.deepEqual(Object.keys(record).sort(), ["allocatedAt", "holder", "node", "presence", "repo", "sessionId"]);
  assert.equal(record.holder, "run:r1");
  assert.equal(record.sessionId, plan.identity.id);
  assert.equal(record.node, "agents1");
  assert.match(record.presence, /^[0-9a-f]{16}$/, "the presence key another node judges liveness by");
});

test("the JetStream domain is validated, from the env or the ao user config", async (t) => {
  const root = await scratch(t);
  assert.equal(await jetStreamDomain({ XDG_CONFIG_HOME: join(root, "none") }, root), null);
  assert.equal(await jetStreamDomain({ AO_NATS_JS_DOMAIN: "hub" }, root), "hub");
  await assert.rejects(jetStreamDomain({ AO_NATS_JS_DOMAIN: "hub.one" }, root), { code: "TOPOLOGY_NATS_DOMAIN" });
  await mkdir(join(root, "cfg", "agent-orchestration"), { recursive: true });
  await writeFile(join(root, "cfg", "agent-orchestration", "config.json"), JSON.stringify({ nats: { domain: "core-hub" } }));
  assert.equal(await jetStreamDomain({ XDG_CONFIG_HOME: join(root, "cfg") }, root), "core-hub");
  assert.deepEqual(validateConfigShape({ nats: { domain: "core-hub" } }, "c"), []);
  assert.equal(validateConfigShape({ nats: { domain: "a b" } }, "c").length, 1);
});

// ── Integration: two nodes, reclaim, and the reclaim race ───────────────────────────────────────────

/** One allocator process: connects, waits for `startAt`, then allocates `count` run holders at once. */
const NODE_SCRIPT = `
const { openNatsTransport } = await import(${JSON.stringify(TRANSPORT)});
const { natsPersonaRegistry } = await import(${JSON.stringify(REGISTRY)});
const [node, count, startAt, scope, names] = [process.argv[1], Number(process.argv[2]), Number(process.argv[3]), process.argv[4], JSON.parse(process.argv[5])];
const transport = await openNatsTransport({ env: process.env, name: 'ao-tm279-' + node });
const registry = natsPersonaRegistry({ transport });
// Warm the paths an allocation uses (bucket bind, key scan, a get), so the first create is not late.
await registry.release(scope, { id: 'warm-up' });
await registry.holder(scope, 'warm-up');
const late = Date.now() - startAt;
await new Promise((resolve) => setTimeout(resolve, Math.max(0, startAt - Date.now())));
const began = Date.now();
const holders = Array.from({ length: count }, (_, i) => ({ id: 'run:' + node + '-' + i, candidates: names }));
const personas = await Promise.all(holders.map((holder) => registry.allocate(scope, holder, { session: { id: node, node, repo: 'app', presence: null } }).then((persona) => [holder.id, persona])));
process.stdout.write(JSON.stringify({ late, began, ended: Date.now(), personas }));
await transport.close();
`;

async function raceNodes(root, nodes, { count = 12, scope = "team:race", names = firstNames().slice(0, 30) } = {}) {
  const startAt = Date.now() + 5000;
  const runs = nodes.map(({ name, url, extra = {} }) =>
    exec(process.execPath, ["--input-type=module", "-e", NODE_SCRIPT, name, String(count), String(startAt), scope, JSON.stringify(names)],
      { env: { ...process.env, ...natsEnv(root, url, extra) }, timeout: 60_000 }).then((r) => JSON.parse(r.stdout)));
  const results = await Promise.all(runs);
  // Coverage of the race itself: a node that reached the barrier after it opened did not race.
  for (const { late } of results) assert.ok(late < 0, `a node reached the start barrier ${late}ms late`);
  // ...and every node was still allocating when every other node had begun: the windows overlap.
  const overlap = Math.min(...results.map((r) => r.ended)) - Math.max(...results.map((r) => r.began));
  assert.ok(overlap > 0, `allocation windows did not overlap (${overlap}ms): ${JSON.stringify(results.map(({ began, ended }) => [began, ended]))}`);
  return results.flatMap(({ personas }) => personas);
}

test("two nodes allocating concurrently in one team never receive the same persona", { timeout: 90_000 }, async (t) => {
  if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
  const root = await scratch(t);
  const url = await jetStreamServer(t, root);
  const allocations = await raceNodes(root, [{ name: "node-a", url }, { name: "node-b", url }]);
  assert.equal(allocations.length, 24, "24 allocations across two processes");
  const personas = allocations.map(([, persona]) => persona);
  assert.equal(new Set(personas).size, 24, `two holders share a persona: ${JSON.stringify(allocations)}`);
  // raceNodes asserted the two allocation windows overlapped. Which node wins the head of the pool is
  // not a measure of that: both nodes' holders walk the names in lockstep, so the one that starts a
  // few milliseconds earlier tends to win every name while the other's creates conflict on each.
  // The bucket agrees with every answer.
  const registry = natsPersonaRegistry({ transport: await openTransport(t, root, url) });
  for (const [id, persona] of allocations) assert.equal(await registry.holder("team:race", persona), id);

  // Release frees: one holder gives its persona back and a new holder takes exactly that one.
  const [releasedId, releasedPersona] = allocations[0];
  assert.equal(await registry.release("team:race", { id: releasedId }), true);
  assert.equal(await registry.holder("team:race", releasedPersona), null);
  assert.equal(await registry.allocate("team:race", { id: "run:late", candidates: firstNames().slice(0, 30) }), releasedPersona);
});

/** A presence snapshot as a repository supervisor publishes it, listing the given holders. */
function presence({ agents = [], runs = [], ageMs = 0, staleAfterMs = 30_000 }) {
  return {
    schemaVersion: 2, generatedAt: new Date(Date.now() - ageMs).toISOString(), staleAfterMs, clockSkewToleranceMs: 5000,
    agents: [...agents.map((agentId) => ({ agentId, memberships: [], primaryRunId: null })),
      ...runs.map((runId) => ({ agentId: "w1w1w1w1", memberships: [{ runId }], primaryRunId: runId }))],
  };
}

test("a stale holder is reclaimed; a live one, or one inside its grace, is not", { timeout: 30_000 }, async (t) => {
  if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
  const root = await scratch(t);
  const transport = await openTransport(t, root, await jetStreamServer(t, root));
  const scope = "team:reclaim";
  const take = (registry, id, name, presenceKey) => registry.allocate(scope, { id, candidates: [name] }, { session: { id: "s", node: "n", repo: "app", presence: presenceKey } });
  const old = natsPersonaRegistry({ transport, now: () => Date.now() - 10 * 60_000 }); // allocations ten minutes old
  assert.equal(await take(old, "run:live", "ada", "repo-live"), "ada");
  assert.equal(await take(old, "a1a1a1a1", "bell", "repo-live"), "bell");
  assert.equal(await take(old, "run:gone", "cleo", "repo-gone"), "cleo");
  assert.equal(await take(old, "run:silent", "dara", "repo-silent"), "dara");
  assert.equal(await take(old, "run:old", "esme", "repo-old"), "esme");
  assert.equal(await take(old, "run:unjudged", "fern", null), "fern");
  await transport.putPresence({ repo: "repo-live", body: presence({ agents: ["a1a1a1a1"], runs: ["live"] }) });
  await transport.putPresence({ repo: "repo-silent", body: presence({ runs: ["someone-else"] }) });
  await transport.putPresence({ repo: "repo-old", body: presence({ runs: ["old"], ageMs: 60_000 }) });
  // repo-gone has no presence at all: its node stopped publishing and the TTL took the key.

  const registry = natsPersonaRegistry({ transport, graceMs: 120_000 });
  const claim = (name) => registry.allocate(scope, { id: `run:new-${name}`, candidates: [name] });
  assert.equal(await claim("ada"), "run-new-ada", "a live run holder (listed in fresh presence) is never freed");
  assert.equal(await claim("bell"), "run-new-bell", "a live agent holder is never freed");
  assert.equal(await claim("fern"), "run-new-fern", "a record with no presence key cannot be judged, so it is kept");
  assert.equal(await claim("cleo"), "cleo", "no presence for its repository: reclaimed");
  assert.equal(await claim("dara"), "dara", "fresh presence that does not list it: reclaimed");
  assert.equal(await claim("esme"), "esme", "presence older than staleAfterMs + skew: reclaimed");
  assert.equal(await registry.holder(scope, "ada"), "run:live");
  assert.equal(await registry.holder(scope, "cleo"), "run:new-cleo");

  // Inside the grace period nothing is judged at all, presence or not.
  assert.equal(await take(registry, "run:young", "gwen", "repo-gone"), "gwen");
  assert.equal(await claim("gwen"), "run-new-gwen", "a fresh allocation is protected by the grace period");
});

test("two concurrent reclaimers of one stale persona: exactly one wins", { timeout: 60_000 }, async (t) => {
  if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
  const root = await scratch(t);
  const url = await jetStreamServer(t, root);
  const seed = natsPersonaRegistry({ transport: await openTransport(t, root, url), now: () => Date.now() - 10 * 60_000 });
  for (let round = 0; round < 10; round += 1) {
    const scope = `team:reclaim-race-${round}`;
    assert.equal(await seed.allocate(scope, { id: "run:dead", candidates: ["ada"] }, { session: { presence: "repo-none" } }), "ada");
    // Two nodes (two connections). Each one's presence read waits for the other's, so both judge the
    // holder stale at the same revision before either writes — the race is forced, not hoped for.
    let arrived = 0;
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    const racer = async (name) => {
      const transport = await openTransport(t, root, url, {}, `ao-tm279-${name}`);
      const getPresence = transport.getPresence.bind(transport);
      transport.getPresence = async (args) => { if (++arrived === 2) open(); await gate; return getPresence(args); };
      return natsPersonaRegistry({ transport }).allocate(scope, { id: `run:${name}`, candidates: ["ada"] });
    };
    const results = await Promise.all([racer("x"), racer("y")]);
    assert.equal(results.filter((p) => p === "ada").length, 1, `round ${round}: ${results.join(", ")}`);
    const winner = results[0] === "ada" ? "run:x" : "run:y";
    assert.equal(await seed.holder(scope, "ada"), winner);
    assert.ok(results.includes(winner === "run:x" ? "run-y" : "run-x"), "the loser falls through to its own id");
  }
});

// ── Leaf node: the hub hosts the bucket, the leaf reaches it through its JetStream domain ───────────

test("a leaf node with its own JetStream reaches the hub's bucket through the hub's domain", { timeout: 90_000 }, async (t) => {
  if (!(await natsBinary())) { t.skip("no working nats-server binary"); return; }
  const root = await scratch(t);
  const [hubPort, leafListen, leafPort] = [await freePort(), await freePort(), await freePort()];
  for (const dir of ["hub-js", "leaf-js"]) await mkdir(join(root, dir), { recursive: true });
  await startServer(t, root, "hub", `server_name: hub
listen: 127.0.0.1:${hubPort}
jetstream { store_dir: ${JSON.stringify(join(root, "hub-js"))}, domain: hub }
leafnodes { listen: 127.0.0.1:${leafListen} }
`);
  await untilConnect(hubPort);
  await untilConnect(leafListen);
  await startServer(t, root, "leaf", `server_name: leaf
listen: 127.0.0.1:${leafPort}
jetstream { store_dir: ${JSON.stringify(join(root, "leaf-js"))}, domain: leaf }
leafnodes { remotes [ { url: "nats-leaf://127.0.0.1:${leafListen}" } ] }
`);
  await untilConnect(leafPort);
  const hubUrl = `nats://127.0.0.1:${hubPort}`;
  const leafUrl = `nats://127.0.0.1:${leafPort}`;
  // The leaf connection comes up asynchronously: wait until the hub domain answers from the leaf.
  const leafTransport = await openTransport(t, root, leafUrl, { AO_NATS_JS_DOMAIN: "hub" }, "ao-tm279-leaf");
  const deadline = Date.now() + 20_000;
  for (;;) {
    try { await leafTransport.personaKv(); break; } catch (error) { if (Date.now() > deadline) throw error; await sleep(250); }
  }
  assert.equal(leafTransport.domain, "hub");

  const allocations = await raceNodes(root, [{ name: "hub-node", url: hubUrl }, { name: "leaf-node", url: leafUrl, extra: { AO_NATS_JS_DOMAIN: "hub" } }], { count: 10, scope: "team:leaf" });
  assert.equal(allocations.length, 20);
  assert.equal(new Set(allocations.map(([, p]) => p)).size, 20, `hub and leaf collided: ${JSON.stringify(allocations)}`);
  // One bucket, on the hub: what the leaf allocated is visible from a hub connection.
  const hubRegistry = natsPersonaRegistry({ transport: await openTransport(t, root, hubUrl) });
  for (const [id, persona] of allocations) assert.equal(await hubRegistry.holder("team:leaf", persona), id);

  // Without the domain, the leaf's js context is its own JetStream: a second, separate bucket. That is
  // the failure the domain setting prevents — the same persona handed out on both sides.
  const stray = natsPersonaRegistry({ transport: await openTransport(t, root, leafUrl, {}, "ao-tm279-leaf-nodomain") });
  assert.equal(await hubRegistry.allocate("team:split", { id: "run:hub", candidates: ["ada"] }), "ada");
  assert.equal(await stray.allocate("team:split", { id: "run:leaf", candidates: ["ada"] }), "ada", "no domain: the leaf allocated from its own bucket");
});
