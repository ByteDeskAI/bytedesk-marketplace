/**
 * TM-023 — one dashboard per project. First-wins, keyed by the store path:
 * a deterministic port, a pid file that proves ownership, and a clean takeover
 * of anything stale. A recycled pid belonging to someone else is not "live".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempStore } from "./helpers.mjs";
import { createServer } from "node:net";
import {
  MIN_PORT,
  assignPort,
  assignedPort,
  ensurePort,
  liveInstance,
  portFor,
  readInstance,
  takeover,
  writeInstance,
} from "../../lib/singleton.mjs";

/** A process that outlives the test body but is ours to kill. */
function sleeper() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  return child;
}

/** Hold a port so the probe has something real to trip over. */
function occupy(port) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}
const close = (s) => new Promise((r) => s.close(r));

describe("portFor", () => {
  it("gives the same project the same starting point every time", () => {
    assert.equal(portFor("/tmp/alpha/.bytedesk/task-management"), portFor("/tmp/alpha/.bytedesk/task-management"));
  });

  it("starts different projects in different places", () => {
    const ports = new Set(
      ["/a/one", "/a/two", "/b/three", "/srv/projects/four", "/home/x/five"].map(portFor),
    );
    assert.ok(ports.size >= 4, `expected distinct ports, got ${[...ports]}`);
  });

  it("stays above 45000 and inside the ephemeral-safe range", () => {
    for (const p of ["/", "/x", "/very/long/path/to/a/store/.bytedesk/task-management", "å"]) {
      const port = portFor(p);
      assert.ok(port > 45000 && port < 65000, `${port} out of range for ${p}`);
      assert.equal(port, Math.trunc(port));
      assert.ok(port >= MIN_PORT);
    }
  });
});

describe("ensurePort", () => {
  it("assigns a free port above 45000 on first launch and persists it", async () => {
    const p = tempStore();
    const first = await ensurePort(p);
    assert.ok(first.port > 45000, `${first.port} must be above 45000`);
    assert.equal(first.source, "new");
    assert.equal(assignedPort(p), first.port, "the assignment must outlive the process");
  });

  it("reuses the assignment on every later launch", async () => {
    const p = tempStore();
    const first = await ensurePort(p);
    const second = await ensurePort(p);
    const third = await ensurePort(p);
    assert.equal(second.port, first.port, "the same project must open the same port every load");
    assert.equal(third.port, first.port);
    assert.equal(second.source, "assigned");
  });

  it("gives two different projects two different ports", async () => {
    const a = await ensurePort(tempStore());
    const b = await ensurePort(tempStore());
    assert.notEqual(a.port, b.port);
  });

  it("reassigns, persists and reports when the assigned port is taken", async () => {
    const p = tempStore();
    const first = await ensurePort(p);
    const squatter = await occupy(first.port);
    try {
      const next = await ensurePort(p);
      assert.notEqual(next.port, first.port, "an occupied port must not be handed out again");
      assert.ok(next.port > 45000);
      assert.equal(next.source, "reassigned");
      assert.equal(next.previous, first.port, "the reassignment must be announceable");
      assert.equal(assignedPort(p), next.port, "the new assignment must be persisted");
    } finally {
      await close(squatter);
    }
  });

  it("keeps the assignment when the port is held by our own dashboard restarting", async () => {
    const p = tempStore();
    const first = await ensurePort(p);
    const squatter = await occupy(first.port);
    try {
      const next = await ensurePort(p, { keep: true });
      assert.equal(next.port, first.port, "a restart must come back on the same URL");
      assert.equal(next.source, "assigned");
    } finally {
      await close(squatter);
    }
  });

  it("lets TM_DASHBOARD_PORT win without clobbering the stored assignment", async () => {
    const p = tempStore();
    const first = await ensurePort(p);
    const forced = await ensurePort(p, { override: "7999" });
    assert.equal(forced.port, 7999);
    assert.equal(forced.source, "env");
    assert.equal(assignedPort(p), first.port, "an override is not an assignment");
  });

  it("does not record an assignment when an override runs on a fresh store", async () => {
    const p = tempStore();
    const forced = await ensurePort(p, { override: "7998" });
    assert.equal(forced.port, 7998);
    assert.equal(assignedPort(p), null);
  });

  it("ignores a junk assignment file rather than refusing to start", async () => {
    const p = tempStore();
    assignPort(p, 1234); // below the floor — not something we ever handed out
    const got = await ensurePort(p);
    assert.ok(got.port > 45000);
  });
});

describe("readInstance / writeInstance", () => {
  it("round-trips pid, port and the owning store", () => {
    const p = tempStore();
    writeInstance(p, { pid: 4242, port: 7911 });
    const got = readInstance(p);
    assert.equal(got.pid, 4242);
    assert.equal(got.port, 7911);
    assert.equal(got.store, p.base);
  });

  it("also writes dashboard.port for tools that read it", () => {
    const p = tempStore();
    writeInstance(p, { pid: 1, port: 7913 });
    assert.equal(readFileSync(join(p.base, "dashboard.port"), "utf8").trim(), "7913");
  });

  it("reports nothing when there is no pid file", () => {
    assert.equal(readInstance(tempStore()), null);
  });

  it("reads a pre-singleton pid file, which was just the number", () => {
    const p = tempStore();
    writeFileSync(join(p.base, "dashboard.pid"), "4242\n");
    const got = readInstance(p);
    assert.equal(got.pid, 4242);
    assert.equal(got.store, p.base, "a bare pid file can only belong to the store it sits in");
  });

  it("reports nothing for a corrupt pid file", () => {
    const p = tempStore();
    writeFileSync(join(p.base, "dashboard.pid"), "not json at all");
    assert.equal(readInstance(p), null);
  });
});

describe("liveInstance", () => {
  it("detects a running dashboard", async () => {
    const p = tempStore();
    const child = sleeper();
    try {
      writeInstance(p, { pid: child.pid, port: 7910 });
      const live = liveInstance(p);
      assert.ok(live, "a live process with a matching store must be reported");
      assert.equal(live.pid, child.pid);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("treats a stale pid file as no instance", () => {
    const p = tempStore();
    writeInstance(p, { pid: 0x7fffffff, port: 7910 }); // no such process
    assert.equal(liveInstance(p), null);
  });

  it("does not mistake a recycled pid owned by another store for a live dashboard", () => {
    const p = tempStore();
    const other = tempStore();
    const child = sleeper();
    try {
      // The pid is genuinely alive, but the process belongs to a different project.
      writeFileSync(
        join(p.base, "dashboard.pid"),
        JSON.stringify({ pid: child.pid, port: 7910, store: other.base }),
      );
      assert.equal(liveInstance(p), null, "pid liveness alone must not count as ownership");
    } finally {
      child.kill("SIGKILL");
    }
  });
});

describe("takeover", () => {
  it("kills the incumbent and clears the pid file", async () => {
    const p = tempStore();
    const child = sleeper();
    let exited = false;
    child.on("exit", () => (exited = true));
    writeInstance(p, { pid: child.pid, port: 7910 });

    takeover(p);
    for (let i = 0; i < 100 && !exited; i += 1) await new Promise((r) => setTimeout(r, 20));

    assert.ok(exited, "takeover must terminate the incumbent");
    assert.equal(readInstance(p), null, "takeover must clear the pid file");
  });

  it("is a no-op on a store with no incumbent", () => {
    const p = tempStore();
    assert.doesNotThrow(() => takeover(p));
  });

  it("never kills a process owned by a different store", () => {
    const p = tempStore();
    const other = tempStore();
    const child = sleeper();
    try {
      writeFileSync(
        join(p.base, "dashboard.pid"),
        JSON.stringify({ pid: child.pid, port: 7910, store: other.base }),
      );
      takeover(p);
      assert.doesNotThrow(() => process.kill(child.pid, 0), "a foreign process must survive takeover");
    } finally {
      child.kill("SIGKILL");
    }
  });
});

/**
 * TM-037 — the board's URL is a thing people bookmark, so it has to survive a restart.
 * portFor() makes the common case deterministic; the only state that can be lost is a port that
 * *drifted* off it, which is exactly what a `dashboard.*` sweep used to take.
 */
describe("the port survives a restart", () => {
  it("keeps a drifted assignment when the dashboard.* files are swept", async () => {
    const p = tempStore();
    const drifted = portFor(p.base) + 7; // something else held the natural port on first launch
    assignPort(p, drifted);
    const before = await ensurePort(p, {});
    assert.equal(before.port, drifted);

    rmSync(join(p.base, "dashboard.pid"), { force: true });
    rmSync(join(p.base, "dashboard.port"), { force: true });

    const after = await ensurePort(p, {});
    assert.equal(after.port, drifted, "tidying the pid file must not move the board's URL");
  });

  it("adopts a pre-0.5 assignment written under the old name", async () => {
    const p = tempStore();
    const drifted = portFor(p.base) + 3;
    writeFileSync(join(p.base, "dashboard.assigned-port"), `${drifted}\n`);

    const got = await ensurePort(p, {});
    assert.equal(got.port, drifted, "an existing board must not move ports on upgrade");
  });

  it("falls back and records the new assignment when the port is taken", async () => {
    const p = tempStore();
    const natural = portFor(p.base);
    const squatter = createServer();
    await new Promise((r) => squatter.listen(natural, "127.0.0.1", r));
    try {
      const got = await ensurePort(p, {});
      assert.notEqual(got.port, natural, "a bound port is not available, whatever the hash says");
      assert.equal(assignedPort(p), got.port, "the fallback has to be recorded or it happens again");
    } finally {
      await new Promise((r) => squatter.close(r));
    }
  });
});
