/**
 * hostcaps — the report dispatch will trust, tested against stubbed worlds.
 *
 * Nothing here may touch the real PATH or the real plugin cache: every test
 * injects `probe` and a temp `pluginRoot`/`HOME`, because a suite whose result
 * depends on the machine it runs on is not a suite. The one exception is the
 * memoization block, which calls the real thing but asserts only cache
 * identity, never contents.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, writeFile } from "./helpers.mjs";
import { detectHostCaps, resetHostCapsCache } from "../../lib/hostcaps.mjs";

const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "tm-hostcaps-"));
  dirs.push(d);
  return d;
};
after(() => cleanup(...dirs));

/** A marketplace-shaped tree: <root>/task-management is the pluginRoot, siblings beside it. */
function marketplace({ orchestration = true, topology = true } = {}) {
  const root = tmp();
  if (orchestration) writeFile(root, "agent-orchestration/bin/agent-orchestration-mcp", "#!/bin/sh\n");
  if (topology) writeFile(root, "agent-orchestration/bin/ao-topology", "#!/bin/sh\n");
  return join(root, "task-management");
}

const unavailable = (cmd) => ({ available: false, reason: `${cmd} is not on PATH` });
/** Every command answers, with a version for the probes that ask. */
const fullProbe = (cmd, { version } = {}) => ({
  available: true,
  path: `/fake/bin/${cmd}`,
  ...(version ? { version: `${cmd} 1.0` } : {}),
});
const bareProbe = (cmd) => unavailable(cmd);
/** Everything answers except the named commands. */
const missing =
  (...names) =>
  (cmd, opts) =>
    names.includes(cmd) ? unavailable(cmd) : fullProbe(cmd, opts);

const bareEnv = () => ({ HOME: tmp() });

describe("a bare machine", () => {
  it("reports only manual, with reasons, and never throws", () => {
    const report = detectHostCaps({ env: bareEnv(), probe: bareProbe, pluginRoot: marketplace({ orchestration: false, topology: false }) });

    assert.deepEqual(report.backends.manual, { available: true });
    for (const name of ["topology", "orchestration", "tmux"]) {
      assert.equal(report.backends[name].available, false, name);
      assert.ok(report.backends[name].reason, `${name} must say why`);
    }
    for (const name of ["claude", "codex", "grok", "kimi", "pi"]) {
      assert.equal(report.clis[name].available, false, name);
    }
    for (const name of ["bwrap", "systemdRun", "slirp4netns"]) {
      assert.equal(report.sandbox[name].available, false, name);
    }
  });
});

describe("a full machine", () => {
  it("reports every backend, cli and sandbox dep available", () => {
    const pluginRoot = marketplace();
    const report = detectHostCaps({ env: bareEnv(), probe: fullProbe, pluginRoot });

    assert.equal(report.backends.orchestration.available, true);
    assert.equal(report.backends.orchestration.path, join(pluginRoot, "..", "agent-orchestration", "bin", "agent-orchestration-mcp"));
    assert.equal(report.backends.topology.available, true);
    assert.equal(report.backends.topology.path, join(pluginRoot, "..", "agent-orchestration", "bin", "ao-topology"));
    assert.equal(report.backends.tmux.available, true);
    assert.equal(report.backends.tmux.version, "tmux 1.0");
    for (const name of ["claude", "codex", "grok", "kimi", "pi"]) {
      assert.deepEqual(report.clis[name], { available: true, path: `/fake/bin/${name}` });
    }
    for (const name of ["bwrap", "systemdRun", "slirp4netns"]) {
      assert.equal(report.sandbox[name].available, true, name);
    }
  });
});

describe("single missing dependencies", () => {
  it("no tmux takes the topology backend down with it, but not orchestration", () => {
    const report = detectHostCaps({ env: bareEnv(), probe: missing("tmux"), pluginRoot: marketplace() });

    assert.equal(report.backends.tmux.available, false);
    assert.equal(report.backends.topology.available, false);
    assert.match(report.backends.topology.reason, /tmux/, "topology must name the missing dep");
    assert.equal(report.backends.orchestration.available, true, "orchestration does not need tmux");
  });

  it("no ao-topology binary fails topology even with tmux present", () => {
    const report = detectHostCaps({ env: bareEnv(), probe: fullProbe, pluginRoot: marketplace({ topology: false }) });

    assert.equal(report.backends.topology.available, false);
    assert.match(report.backends.topology.reason, /ao-topology/);
  });

  it("the two agent-orchestration binaries are probed independently", () => {
    // Half an install — the broker present, the topology launcher not — must fail
    // exactly one backend. They ship in one plugin but are two separate runtimes.
    const report = detectHostCaps({ env: bareEnv(), probe: fullProbe, pluginRoot: marketplace({ topology: false }) });
    assert.equal(report.backends.orchestration.available, true);
    assert.equal(report.backends.topology.available, false);
  });

  it("no orchestration binary anywhere fails orchestration", () => {
    const report = detectHostCaps({ env: bareEnv(), probe: fullProbe, pluginRoot: marketplace({ orchestration: false }) });

    assert.equal(report.backends.orchestration.available, false);
    assert.match(report.backends.orchestration.reason, /agent-orchestration-mcp/);
  });

  it("missing sandbox deps degrade orchestration but never block it", () => {
    const report = detectHostCaps({
      env: bareEnv(),
      probe: missing("bwrap", "systemd-run", "slirp4netns"),
      pluginRoot: marketplace(),
    });

    assert.equal(report.backends.orchestration.available, true, "it can run supervised=0");
    assert.equal(report.sandbox.bwrap.available, false);
    assert.equal(report.sandbox.systemdRun.available, false);
    assert.equal(report.sandbox.slirp4netns.available, false);
  });
});

describe("orchestration binary resolution", () => {
  it("honours AGENT_ORCHESTRATION_MCP even with no sibling plugin", () => {
    const home = tmp();
    const override = writeFile(tmp(), "bin/agent-orchestration-mcp", "#!/bin/sh\n");
    const report = detectHostCaps({
      env: { HOME: home, AGENT_ORCHESTRATION_MCP: override },
      probe: fullProbe,
      pluginRoot: marketplace({ orchestration: false }),
    });

    assert.deepEqual(report.backends.orchestration, { available: true, path: override });
  });

  it("an override pointing at nothing falls through and is named in the reason", () => {
    const ghost = join(tmp(), "gone");
    const report = detectHostCaps({
      env: { HOME: tmp(), AGENT_ORCHESTRATION_MCP: ghost },
      probe: fullProbe,
      pluginRoot: marketplace({ orchestration: false }),
    });

    assert.equal(report.backends.orchestration.available, false);
    assert.match(report.backends.orchestration.reason, /AGENT_ORCHESTRATION_MCP/);
  });

  it("finds the binary in the Claude plugin cache when there is no sibling", () => {
    const home = tmp();
    const cached = writeFile(home, ".claude/plugins/cache/marketplace/agent-orchestration/bin/agent-orchestration-mcp", "#!/bin/sh\n");
    const report = detectHostCaps({
      env: { HOME: home },
      probe: fullProbe,
      pluginRoot: marketplace({ orchestration: false }),
    });

    assert.deepEqual(report.backends.orchestration, { available: true, path: cached });
  });
});

describe("per-process cache", () => {
  it("memoizes the no-args call and only that call", () => {
    resetHostCapsCache();
    const a = detectHostCaps();
    assert.equal(detectHostCaps(), a, "same object, no re-probe");

    const b = detectHostCaps({ env: bareEnv(), probe: bareProbe, pluginRoot: marketplace({ orchestration: false, topology: false }) });
    assert.notEqual(b, a);
    assert.notEqual(detectHostCaps({ env: bareEnv(), probe: bareProbe, pluginRoot: tmp() }), b, "explicit opts always re-probe");

    resetHostCapsCache();
    assert.notEqual(detectHostCaps(), a, "reset forces a fresh probe");
    resetHostCapsCache();
  });
});
