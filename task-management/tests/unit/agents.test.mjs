/**
 * TM-066 — the agent registry: which workers this machine has running.
 *
 * Liveness is derived, never trusted from disk: a live pid (signal 0 answers) or a
 * heartbeat fresher than agentTtlMinutes. Reaping marks the quiet ones dead, logs
 * it once, and stays quiet on the next pass.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { NOT_FOR_GIT, create, readEvents, seedGitContract, writeConfig } from "../../lib/store.mjs";
import { agentsFile, heartbeatAgent, listAgents, reapAgents, registerAgent, renderAgents } from "../../lib/agents.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";

const trash = [];
after(() => cleanup(...trash));

function store() {
  const p = tempStore();
  trash.push(p.root);
  return p;
}

/** A store rooted in a real git repo, because dispatch provisions a worktree. */
function repoStore() {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  trash.push(root);
  return p;
}

/** A backend that records what it was asked to launch — the dispatch.test.mjs pattern. */
function fakeBackend(name, spawnResult = { ok: true, run: `${name}:run-1` }) {
  const calls = [];
  return {
    name,
    calls,
    available: () => true,
    spawn: (req) => {
      calls.push(req);
      return spawnResult;
    },
  };
}

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
/** A pid that cannot exist: above every platform's PID_MAX, so signal 0 is ESRCH. */
const DEAD_PID = 2 ** 22;

/** Rewrite the registry file directly — the test's way of backdating a heartbeat. */
function surgery(p, fn) {
  const reg = JSON.parse(readFileSync(agentsFile(p), "utf8"));
  fn(reg);
  writeFileSync(agentsFile(p), `${JSON.stringify(reg, null, 2)}\n`);
}

describe("registerAgent", () => {
  it("registers an agent and logs agent_registered", () => {
    const p = store();
    const rec = registerAgent(
      { name: "agent:TM-001-abcd1234", harness: "claude", capabilities: ["code"], backend: "tmux", runId: "tmux:tm-TM-001", pid: process.pid, session: "abcd1234" },
      p,
    );

    assert.equal(rec.name, "agent:TM-001-abcd1234");
    assert.equal(rec.status, "active");
    assert.ok(rec.registeredAt && rec.heartbeatAt, "both timestamps stamped");

    const onDisk = JSON.parse(readFileSync(agentsFile(p), "utf8"));
    assert.deepEqual(onDisk.agents[rec.name].capabilities, ["code"]);

    const evt = readEvents(p).find((e) => e.event === "agent_registered");
    assert.ok(evt, "registration lands in the event log");
    assert.equal(evt.agent, rec.name);
    assert.equal(evt.backend, "tmux");
  });

  it("upserts: re-registering keeps registeredAt, refreshes heartbeat, revives a dead record", () => {
    const p = store();
    const first = registerAgent({ name: "agent:a", backend: "tmux", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:a"].status = "dead";
      reg.agents["agent:a"].heartbeatAt = ago(120);
    });

    const second = registerAgent({ name: "agent:a", backend: "tmux", pid: DEAD_PID, runId: "tmux:run-2" }, p);

    assert.equal(second.registeredAt, first.registeredAt, "registeredAt survives the upsert");
    assert.ok(Date.parse(second.heartbeatAt) > Date.parse(ago(1)), "heartbeat refreshed");
    assert.equal(second.status, "active", "re-registering a dead name revives it");
    assert.equal(second.runId, "tmux:run-2");
    assert.equal(Object.keys(JSON.parse(readFileSync(agentsFile(p), "utf8")).agents).length, 1, "one record per name");
  });

  it("refuses a registration with no name", () => {
    const p = store();
    assert.throws(() => registerAgent({ backend: "tmux" }, p), /name/);
  });
});

describe("heartbeatAgent", () => {
  it("refreshes heartbeatAt and logs nothing", () => {
    const p = store();
    registerAgent({ name: "agent:a", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:a"].heartbeatAt = ago(120);
    });
    const before = readEvents(p).length;

    const rec = heartbeatAgent("agent:a", p);

    assert.ok(Date.parse(rec.heartbeatAt) > Date.parse(ago(1)), "the pulse moved");
    assert.equal(readEvents(p).length, before, "a heartbeat is a pulse, not an event");
  });

  it("returns null for a name that was never registered", () => {
    const p = store();
    assert.equal(heartbeatAgent("agent:ghost", p), null);
  });
});

describe("listAgents — liveness is derived", () => {
  it("a live pid is alive, an impossible pid with a stale heartbeat is not", () => {
    const p = store();
    registerAgent({ name: "agent:live", pid: process.pid }, p);
    registerAgent({ name: "agent:gone", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:gone"].heartbeatAt = ago(120);
    });

    const list = Object.fromEntries(listAgents(p).map((a) => [a.name, a]));

    assert.equal(list["agent:live"].alive, true, "signal 0 to our own pid answers");
    assert.equal(list["agent:gone"].alive, false, `pid ${DEAD_PID} cannot exist and the heartbeat aged out`);
  });

  it("a fresh heartbeat keeps a pid-less agent alive; agentTtlMinutes sets the window", () => {
    const p = store();
    writeConfig({ agentTtlMinutes: 30 }, p);
    registerAgent({ name: "agent:heart", backend: "orchestration" }, p);
    registerAgent({ name: "agent:stale", backend: "orchestration" }, p);
    surgery(p, (reg) => {
      reg.agents["agent:stale"].heartbeatAt = ago(45);
    });

    const list = Object.fromEntries(listAgents(p).map((a) => [a.name, a]));

    assert.equal(list["agent:heart"].alive, true, "no pid, but the heartbeat is inside the TTL");
    assert.equal(list["agent:stale"].alive, false, "45 minutes old against a 30-minute TTL");
  });

  it("a reaped agent stays dead in the listing even when its heartbeat is freshened", () => {
    const p = store();
    registerAgent({ name: "agent:a", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:a"].heartbeatAt = ago(120);
    });
    reapAgents(p);
    // A heartbeat written after the reap (a crashed worker's runner catching up)
    // must not resurrect a record the reaper already called dead.
    surgery(p, (reg) => {
      reg.agents["agent:a"].heartbeatAt = new Date().toISOString();
    });

    const list = listAgents(p);
    assert.equal(list[0].status, "dead");
    assert.equal(list[0].alive, false, "status dead wins over a fresh-looking heartbeat");
  });
});

describe("reapAgents", () => {
  it("marks the quiet ones dead, logs agent_reaped with their names, and returns them", () => {
    const p = store();
    registerAgent({ name: "agent:live", pid: process.pid }, p);
    registerAgent({ name: "agent:gone", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:gone"].heartbeatAt = ago(120);
    });

    const reaped = reapAgents(p);

    assert.deepEqual(reaped, ["agent:gone"]);
    const list = Object.fromEntries(listAgents(p).map((a) => [a.name, a]));
    assert.equal(list["agent:gone"].status, "dead");
    assert.equal(list["agent:live"].status, "active", "a live worker is never reaped");

    const evt = readEvents(p).find((e) => e.event === "agent_reaped");
    assert.ok(evt, "the reap lands in the event log");
    assert.deepEqual(evt.names, ["agent:gone"]);
  });

  it("is idempotent: a second pass reaps nothing and logs nothing new", () => {
    const p = store();
    registerAgent({ name: "agent:gone", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:gone"].heartbeatAt = ago(120);
    });
    reapAgents(p);
    const eventsAfterFirst = readEvents(p).filter((e) => e.event === "agent_reaped").length;

    const second = reapAgents(p);

    assert.deepEqual(second, [], "already dead is not re-reaped");
    assert.equal(
      readEvents(p).filter((e) => e.event === "agent_reaped").length,
      eventsAfterFirst,
      "a reaper on a timer must not rewrite the same event every pass",
    );
  });
});

describe("agents.json on disk", () => {
  it("survives a simulated crash: a staging file never becomes the registry", () => {
    const p = store();
    registerAgent({ name: "agent:a", pid: process.pid }, p);
    // What writeAtomic leaves behind when the process dies between write and rename.
    writeFileSync(join(p.base, ".tm-tmp-999999-agents.json"), "{ torn json");

    registerAgent({ name: "agent:b", pid: process.pid }, p);

    const reg = JSON.parse(readFileSync(agentsFile(p), "utf8"));
    assert.deepEqual(Object.keys(reg.agents).sort(), ["agent:a", "agent:b"], "the registry parses whole, torn staging file ignored");
    assert.equal(existsSync(join(p.base, ".tm-tmp-999999-agents.json")), true, "the staging file is evidence, not data");
  });
});

describe("dispatch auto-registration", () => {
  it("registers the worker on a successful dispatch — name, backend, run, pid, session", async () => {
    const p = repoStore();
    const t = create("task", { title: "dispatch me" }, "the body", p);
    const fake = fakeBackend("fake", { ok: true, run: "fake:run-1", pid: process.pid });

    const res = await dispatch(t.id, { backend: fake, session: "s-dispatch", actor: "@bot", p });

    assert.equal(res.ok, true);
    const name = `agent:${t.id}-${"s-dispatch".slice(0, 8)}`;
    const rec = listAgents(p).find((a) => a.name === name);
    assert.ok(rec, `the worker is registered as ${name}`);
    assert.equal(rec.backend, "fake");
    assert.equal(rec.runId, "fake:run-1");
    assert.equal(rec.pid, process.pid);
    assert.equal(rec.session, "s-dispatch");
    assert.equal(rec.alive, true);

    const evt = readEvents(p).find((e) => e.event === "agent_registered" && e.agent === name);
    assert.ok(evt, "registration is in the log alongside the dispatch");
  });

  it("tolerates a backend that reports no pid", async () => {
    const p = repoStore();
    const t = create("task", { title: "no pid" }, "", p);

    const res = await dispatch(t.id, { backend: fakeBackend("fake"), session: "s1", p });

    assert.equal(res.ok, true);
    const rec = listAgents(p).find((a) => a.name === `agent:${t.id}-s1`);
    assert.ok(rec);
    assert.equal(rec.pid, null, "no pid reported is a null, not an error");
    assert.equal(rec.alive, true, "liveness falls back to the fresh heartbeat");
  });

  it("registers nothing when the dispatch fails", async () => {
    const p = repoStore();
    const t = create("task", { title: "unlaunchable" }, "", p);
    const fake = fakeBackend("fake", { ok: false, reason: "the harness binary is gone" });

    const res = await dispatch(t.id, { backend: fake, session: "s1", p });

    assert.equal(res.ok, false);
    assert.equal(listAgents(p).length, 0, "a dispatch that started no worker registers no agent");
  });

  it("never lets a registry error fail the dispatch", async () => {
    const p = repoStore();
    const t = create("task", { title: "dispatch anyway" }, "", p);
    // agents.json as a DIRECTORY: the atomic rename over it fails, so registerAgent throws.
    mkdirSync(agentsFile(p), { recursive: true });

    const res = await dispatch(t.id, { backend: fakeBackend("fake"), session: "s1", p });

    assert.equal(res.ok, true, "a broken registry is a missing panel, not a failed hand-off");
  });
});

describe("the git contract", () => {
  it("lists agents.json as per-machine, the way state.json is listed", () => {
    assert.ok(NOT_FOR_GIT.includes("agents.json"), "NOT_FOR_GIT names it");
    assert.ok(NOT_FOR_GIT.includes("state.json"), "control: state.json is named");

    const p = store();
    const rules = readFileSync(p.gitignore, "utf8");
    assert.match(rules, /^agents\.json$/m, "the seeded .gitignore covers the registry");
    assert.match(rules, /^state\.json$/m, "control: and state.json");
  });
});

describe("renderAgents", () => {
  it("renders one line per agent, dead first-class", () => {
    const p = store();
    registerAgent({ name: "agent:live", backend: "tmux", runId: "tmux:r1", pid: process.pid, session: "s1" }, p);
    registerAgent({ name: "agent:gone", pid: DEAD_PID }, p);
    surgery(p, (reg) => {
      reg.agents["agent:gone"].heartbeatAt = ago(120);
    });

    const out = renderAgents(listAgents(p));

    assert.match(out, /alive\s+agent:live.*backend=tmux.*run=tmux:r1.*pid=\d+.*session=s1/);
    assert.match(out, /dead\s+agent:gone/);
  });

  it("says so when nobody is registered", () => {
    assert.equal(renderAgents([]), "(no agents registered)");
  });
});
