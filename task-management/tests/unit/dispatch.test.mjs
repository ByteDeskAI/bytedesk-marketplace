/**
 * Dispatch: claim → start → provision → handoff → spawn, and the failure paths that
 * must leave the board exactly as they found it.
 *
 * Real git for provisioning (a worktree against mocks is worthless), fake backends
 * for launching (a real worker in a unit test is worse).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { claimTask } from "../../lib/claims.mjs";
import { create, read, readEvents, seedGitContract, state } from "../../lib/store.mjs";
import { worktreePath, unprovision } from "../../lib/worktree.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { DEFAULT_ORDER, resolveBackend } from "../../lib/dispatch/backend.mjs";
import * as manual from "../../lib/dispatch/manual.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";

const trash = [];
after(() => cleanup(...trash));

/** A store rooted in a real git repo, because dispatch provisions a worktree. */
function repoStore() {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  trash.push(root);
  return p;
}

/** A backend that records what it was asked to launch. */
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

describe("dispatch — the happy path", () => {
  it("claims, starts, provisions, hands off and records the run", async () => {
    const p = repoStore();
    const t = create("task", { title: "dispatch me" }, "the body", p);
    const fake = fakeBackend("fake");

    const res = await dispatch(t.id, { backend: fake, session: "s-dispatch", actor: "@bot", p });

    assert.equal(res.ok, true);
    assert.equal(res.backend, "fake");
    assert.equal(res.run, "fake:run-1");

    const after = read(t.id, p);
    assert.equal(after.status, "in_progress", "started via the same write tm start performs");
    assert.equal(after.dispatched.backend, "fake");
    assert.equal(after.dispatched.run, "fake:run-1");
    assert.equal(after.dispatched.session, "s-dispatch");
    assert.ok(after.dispatched.at, "dispatched carries a timestamp");

    const claim = state(p).claims[t.id];
    assert.equal(claim.session, "s-dispatch", "the dispatching session holds the claim");
    assert.equal(claim.worktree, res.worktree, "provision re-stamps the claim with the worktree");

    assert.equal(res.worktree, worktreePath(t.id, t.title, p));
    assert.ok(existsSync(res.worktree), "the worktree is really on disk");
    assert.ok(res.branch.startsWith("tm/"), "a tm/ branch was opened");

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].worktree, res.worktree);
    assert.match(fake.calls[0].prompt, /# Handoff — /, "spawn receives the rendered handoff");
    assert.match(fake.calls[0].prompt, /dispatch me/);

    const evt = readEvents(p).find((e) => e.event === "dispatched" && e.id === t.id);
    assert.ok(evt, "a dispatched event lands in the log");
    assert.equal(evt.backend, "fake");
    assert.equal(evt.run, "fake:run-1");
  });

  it("refuses a task that is already done", async () => {
    const p = repoStore();
    const t = create("task", { title: "finished" }, "", p);
    const fake = fakeBackend("fake");
    const { update } = await import("../../lib/store.mjs");
    update(t.id, { status: "done" }, p);

    const res = await dispatch(t.id, { backend: fake, session: "s1", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /done/);
    assert.equal(fake.calls.length, 0, "nothing launches for closed work");
    assert.equal(state(p).claims[t.id], undefined, "and nothing is claimed");
  });

  it("refuses an id that does not exist", async () => {
    const p = repoStore();
    const res = await dispatch("TM-404", { backend: fakeBackend("fake"), p });
    assert.equal(res.ok, false);
    assert.match(res.reason, /not found/);
  });
});

describe("dispatch — refusals leave nothing behind", () => {
  it("propagates the holder-named claim refusal verbatim and creates nothing", async () => {
    const p = repoStore();
    const t = create("task", { title: "contended" }, "", p);
    // A live claim from another session: real worktree dir, so it cannot read as expired.
    const theirs = join(p.root, "their-checkout");
    mkdirSync(theirs, { recursive: true });
    claimTask(t.id, { session: "s1", actor: "@alice", worktree: theirs, p });
    const fake = fakeBackend("fake");

    const res = await dispatch(t.id, { backend: fake, session: "s2", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /s1|@alice/, "the refusal names the holder");
    assert.match(res.reason, /their-checkout/, "and where they are working");
    assert.match(res.reason, /--steal/, "and how to proceed anyway");

    assert.equal(fake.calls.length, 0, "spawn never ran");
    assert.equal(read(t.id, p).status, "open", "status untouched");
    assert.equal(existsSync(worktreePath(t.id, t.title, p)), false, "no worktree left on disk");
    assert.equal(state(p).claims[t.id].session, "s1", "the original claim still stands");
  });

  it("releases the claim and keeps the task open when spawn fails", async () => {
    const p = repoStore();
    const t = create("task", { title: "unlaunchable" }, "", p);
    const fake = fakeBackend("fake", { ok: false, reason: "the harness binary is gone" });

    const res = await dispatch(t.id, { backend: fake, session: "s1", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /harness binary is gone/);
    assert.equal(state(p).claims[t.id], undefined, "the claim is released — a failed dispatch must not lock the task");
    assert.equal(read(t.id, p).status, "open", "not in_progress: no worker started, so nothing is in progress");
    assert.equal(read(t.id, p).dispatched, undefined, "no dispatch record for a dispatch that did not happen");
  });

  it("recovers the same way when provisioning throws", async () => {
    const p = repoStore();
    const t = create("task", { title: "bad base" }, "", p);
    const fake = fakeBackend("fake");

    // `git worktree add` from a corrupt ref fails after the claim and the status write.
    const res = await dispatch(t.id, { backend: fake, session: "s1", p });
    assert.equal(res.ok, true, "control: provisioning works here");

    // A second task whose worktree path is blocked by a NON-empty directory: git
    // refuses `worktree add` onto occupied ground, which is the provisioning throw.
    const t2 = create("task", { title: "blocked path" }, "", p);
    const blocked = worktreePath(t2.id, t2.title, p);
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(blocked, "occupant.txt"), "x");
    const res2 = await dispatch(t2.id, { backend: fake, session: "s1", p });
    assert.equal(res2.ok, false);
    assert.equal(state(p).claims[t2.id], undefined, "claim released on a provisioning failure too");
    assert.equal(read(t2.id, p).status, "open");
  });
});

describe("dispatch — re-dispatch of a live worker", () => {
  it("refuses a same-session re-dispatch and leaves the live claim and status untouched", async () => {
    const p = repoStore();
    const t = create("task", { title: "running" }, "", p);
    const fake = fakeBackend("fake");

    const first = await dispatch(t.id, { backend: fake, session: "s1", p });
    assert.equal(first.ok, true, "control: the first dispatch lands");

    const second = await dispatch(t.id, { backend: fake, session: "s1", p });

    assert.equal(second.ok, false);
    assert.match(second.reason, /already dispatched/, "names what the task already is");
    assert.match(second.reason, /tm collect/, "and the way forward");
    assert.match(second.reason, /--steal/, "and the deliberate override");

    assert.equal(fake.calls.length, 1, "no second spawn — no duplicate worker");
    assert.equal(state(p).claims[t.id].session, "s1", "the live worker's claim survives the refused call");
    assert.equal(read(t.id, p).status, "in_progress", "status untouched");
  });

  it("re-dispatches cleanly once the claim is gone (the collect-then-redispatch flow)", async () => {
    const p = repoStore();
    const t = create("task", { title: "collect me" }, "", p);
    const fake = fakeBackend("fake");

    const first = await dispatch(t.id, { backend: fake, session: "s1", p });
    assert.equal(first.ok, true);

    // What `tm collect` leaves behind: dispatch record still on the task, but the
    // claim released and the worktree gone. The early gate needs BOTH a dispatch
    // record and a live claim, so this must sail through and spawn again.
    unprovision(read(t.id, p), { force: true, p });

    const second = await dispatch(t.id, { backend: fake, session: "s2", p });
    assert.equal(second.ok, true, "no live claim, so no re-dispatch refusal");
    assert.equal(fake.calls.length, 2);
    assert.equal(state(p).claims[t.id].session, "s2");
  });

  it("--steal bypasses the gate and takes the claim, even though provisioning then refuses the occupied path", async () => {
    const p = repoStore();
    const t = create("task", { title: "hostile takeover" }, "", p);
    const fake = fakeBackend("fake");

    const first = await dispatch(t.id, { backend: fake, session: "s1", p });
    assert.equal(first.ok, true);

    const stolen = await dispatch(t.id, { backend: fake, session: "s2", steal: true, p });

    assert.ok(!/already dispatched/.test(stolen.reason ?? ""), "the gate does not fire under --steal");
    assert.equal(stolen.ok, false, "but git refuses to re-add the occupied worktree path");
    assert.equal(state(p).claims[t.id].session, "s2", "the steal itself happened — the claim moved");
    assert.equal(read(t.id, p).status, "in_progress", "a pre-existing claim is never rolled back to open");
  });
});

describe("backend resolution", () => {
  it("walks the configured order, skipping absent and unavailable backends", async () => {
    const p = repoStore();
    const t = create("task", { title: "fallback" }, "", p);
    const tmuxGone = { name: "tmux", available: () => false, spawn: () => ({ ok: true }) };
    const registry = { tmux: tmuxGone, manual };

    const res = await dispatch(t.id, { registry, caps: {}, session: "s1", p });

    assert.equal(res.ok, true);
    assert.equal(res.backend, "manual", "manual is the floor and is always reachable");
    assert.equal(read(t.id, p).dispatched.backend, "manual");
  });

  it("reports why each skipped backend lost", async () => {
    const registry = { tmux: { name: "tmux", available: () => false, spawn: () => ({ ok: true }) }, manual };
    const picked = await resolveBackend({ registry, caps: {}, p: paths("/tmp/none") });

    assert.equal(picked.name, "manual");
    const byName = Object.fromEntries(picked.tried.map((t) => [t.name, t.reason]));
    // orchestration and fleet landed in TM-063: the modules are present now, so
    // with empty caps they lose on availability, not absence — still skipped, not fatal.
    assert.match(byName.orchestration, /unavailable/);
    assert.match(byName.fleet, /unavailable/);
    assert.match(byName.tmux, /unavailable/);
  });

  it("honours an explicit backend request and refuses if it is unavailable, before claiming", async () => {
    const p = repoStore();
    const t = create("task", { title: "pinned" }, "", p);
    const registry = { tmux: { name: "tmux", available: () => false, spawn: () => ({ ok: true }) } };

    const res = await dispatch(t.id, { backend: "tmux", registry, caps: {}, session: "s1", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /no dispatch backend available/);
    assert.equal(state(p).claims[t.id], undefined, "no claim when no backend can run");
    assert.equal(read(t.id, p).status, "open");
  });

  it("defaults to the documented order when config says nothing", () => {
    assert.deepEqual(DEFAULT_ORDER, ["orchestration", "fleet", "tmux", "manual"]);
  });
});

describe("tmux backend", () => {
  const req = {
    task: { id: "TM-001", title: "x" },
    worktree: "/repo/.bytedesk/worktrees/TM-001-x",
    prompt: "# Handoff — TM-001 x\n\nDo the thing.",
    session: "s-1",
    actor: "@bot",
    p: { root: "/repo" },
  };

  it("is available exactly when caps say tmux is", () => {
    assert.equal(tmux.available({ backends: { tmux: { available: true } } }), true);
    assert.equal(tmux.available({ backends: { tmux: { available: false } } }), false);
  });

  it("builds an argv-only spawn: no shell, no shell string, prompt as one positional", () => {
    const written = [];
    const spawned = [];
    const res = tmux.spawn(req, {
      writeImpl: (file, contents) => written.push([file, contents]),
      spawnImpl: (bin, args, opts) => {
        spawned.push([bin, args, opts]);
        return { status: 0 };
      },
    });

    assert.equal(res.ok, true);
    assert.equal(res.run, "tmux:tm-TM-001");

    assert.deepEqual(written, [[join(req.worktree, ".tm-dispatch-prompt.md"), req.prompt]], "the prompt's durable copy lands in the worktree");

    assert.equal(spawned.length, 1);
    const [bin, args, opts] = spawned[0];
    assert.equal(bin, "tmux");
    assert.equal(opts.shell, false, "never a shell — the prompt is arbitrary markdown");
    assert.ok(args.every((a) => typeof a === "string"), "every argument is its own argv element");

    assert.deepEqual(args.slice(0, 6), ["new-session", "-d", "-s", "tm-TM-001", "-c", req.worktree]);
    for (const [k, v] of [["TM_SESSION_ID", "s-1"], ["TM_ACTOR", "@bot"], ["TM_ROOT", "/repo"]]) {
      const at = args.indexOf(`${k}=${v}`);
      assert.ok(at > 0 && args[at - 1] === "-e", `env ${k} injected via tmux -e`);
    }
    const cmd = args.indexOf("claude");
    assert.deepEqual(args.slice(cmd, cmd + 3), ["claude", "-p", "--dangerously-skip-permissions"], "the default harness argv");
    assert.equal(args.at(-1), req.prompt, "the prompt is one positional element, not interpolated into anything");
    assert.ok(
      // `-c` alone is tmux's cwd flag, not a shell — what must never appear is a shell
      // being handed a command string, or metachar composition smuggled in one element.
      !args.some((a, i) => (a === "sh" || a === "bash") && args[i + 1] === "-c") && !args.some((a) => /&&|\|\||;\s*\S/.test(a)),
      "no shell and no shell composition anywhere",
    );
  });

  it("reports tmux's failure instead of claiming a run", () => {
    const res = tmux.spawn(req, {
      writeImpl: () => {},
      spawnImpl: () => ({ status: 1, stderr: "no server running" }),
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /exited 1/);
    assert.match(res.reason, /no server running/);

    const err = tmux.spawn(req, { writeImpl: () => {}, spawnImpl: () => ({ error: new Error("spawn tmux ENOENT") }) });
    assert.equal(err.ok, false);
    assert.match(err.reason, /ENOENT/);
  });
});

describe("manual backend", () => {
  it("is always available and returns paste-able commands, launching nothing", () => {
    const p = tempStore();
    trash.push(p.root);
    assert.equal(manual.available(), true);

    const res = manual.spawn({ worktree: "/repo/.bytedesk/worktrees/TM-001-x", prompt: "# Handoff …", p });

    assert.equal(res.ok, true);
    assert.equal(res.run, undefined, "manual starts nothing, so there is no run handle");
    assert.equal(res.detail.commands[0], "cd /repo/.bytedesk/worktrees/TM-001-x");
    assert.ok(res.detail.commands.at(-1) === "# Handoff …", "the handoff itself is the last thing to paste");
    assert.ok(res.detail.commands.some((c) => c.startsWith("# start your agent harness")), "a harness hint in between");
  });
});
