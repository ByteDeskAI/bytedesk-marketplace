/**
 * What this host can run, probed before work is dispatched to an agent.
 *
 * Dispatch picks a backend from this report, so the rules here are about trust:
 * the function NEVER throws — every probe is individually try/caught and a
 * missing dependency reads as `available: false` with a reason, not as an
 * exception that takes a read verb down with it. And every probe is injectable,
 * so tests stub PATH and the filesystem instead of depending on whichever
 * machine the suite happens to run on.
 *
 * `manual` is always available: it is the floor — a human doing the task — so
 * a bare machine still produces a usable report instead of an error.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = join(HERE, "..");

const ORCH_BIN = join("bin", "agent-orchestration-mcp");
const TOPOLOGY_BIN = join("bin", "ao-topology");

const CLIS = ["claude", "codex", "grok", "kimi", "pi"];
/** Linux sandbox dependencies of the orchestration backend, keyed as the report names them. */
const SANDBOX = { bwrap: "bwrap", systemdRun: "systemd-run", slirp4netns: "slirp4netns" };

/** `which` without a shell: the first executable named `cmd` on PATH, or null. */
function which(cmd, pathEnv) {
  for (const dir of String(pathEnv || "").split(":")) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Best-effort `-V`. Bounded by a short timeout because a CLI that answers a
 * version flag by opening a pager or prompting would otherwise hang a read verb.
 * A failure here says nothing about availability — the PATH lookup already did.
 */
function probeVersion(cmd) {
  try {
    const r = spawnSync(cmd, ["-V"], { shell: false, timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.error) return undefined;
    const line = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split("\n")[0];
    return line || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The real probe: PATH lookup decides availability, argv-only `spawnSync` with
 * `shell: false` fills in the version. Injectable as a whole so tests never
 * touch the real PATH.
 */
export function defaultProbe(cmd, { env = process.env, version = false } = {}) {
  try {
    const path = which(cmd, env.PATH);
    if (!path) return { available: false, reason: `${cmd} is not on PATH` };
    const out = { available: true, path };
    if (version) {
      const v = probeVersion(cmd);
      if (v) out.version = v;
    }
    return out;
  } catch (err) {
    return { available: false, reason: `probe failed: ${err.message}` };
  }
}

/**
 * Find a plugin binary in the Claude plugin cache. Installed plugins nest as
 * `~/.claude/plugins/<cache|repos>/<marketplace>/<plugin>/<version>/…` with no
 * fixed depth, so this walks — bounded by a visit cap and a depth cap, because
 * a pathological plugins tree must not stall a read verb.
 */
function findCacheBinary(home, pluginName, binRel) {
  const queue = [[join(home, ".claude", "plugins"), 0]];
  let visited = 0;
  while (queue.length && visited < 400) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += entries.length;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name.startsWith(pluginName) && existsSync(join(p, binRel))) return join(p, binRel);
      if (depth < 5) queue.push([p, depth + 1]);
    }
  }
  return null;
}

/**
 * First existing candidate wins: explicit env override, the sibling plugin in a
 * marketplace source checkout, then the Claude plugin cache. `tried` comes back
 * either way so a miss can say where it looked instead of just "not found".
 */
function resolvePluginBinary({ envName, env, sibling, cacheDir, pluginName, binRel, dbg }) {
  const tried = [];
  const override = envName ? env[envName] : null;
  if (override) {
    tried.push(`${envName}=${override}`);
    if (existsSync(override)) {
      dbg(`${pluginName}: found via ${envName}`);
      return { path: override, tried };
    }
  }
  tried.push(sibling);
  if (existsSync(sibling)) {
    dbg(`${pluginName}: found sibling plugin at ${sibling}`);
    return { path: sibling, tried };
  }
  const cached = findCacheBinary(cacheDir, pluginName, binRel);
  if (cached) {
    dbg(`${pluginName}: found in Claude plugin cache at ${cached}`);
    return { path: cached, tried };
  }
  tried.push(`~/.claude/plugins/**/${pluginName}*/${binRel}`);
  return { path: null, tried };
}

function detect({ env, probe, pluginRoot }) {
  const dbg =
    env.TM_HOSTCAPS_DEBUG === "1" ? (m) => process.stderr.write(`[hostcaps] ${m}\n`) : () => {};
  const home = env.HOME || homedir();

  const cmd = (name, version = false) => {
    let r;
    try {
      r = probe(name, { env, version });
    } catch (err) {
      r = { available: false, reason: `probe failed: ${err.message}` };
    }
    dbg(`${name}: ${r.available ? `available${r.path ? ` at ${r.path}` : ""}` : `unavailable (${r.reason})`}`);
    return r;
  };

  const clis = Object.fromEntries(CLIS.map((name) => [name, cmd(name)]));
  const sandbox = Object.fromEntries(Object.entries(SANDBOX).map(([key, bin]) => [key, cmd(bin)]));

  const tmuxProbe = cmd("tmux", true);
  const tmux = tmuxProbe.available
    ? {
        available: true,
        ...(tmuxProbe.path ? { path: tmuxProbe.path } : {}),
        ...(tmuxProbe.version ? { version: tmuxProbe.version } : {}),
      }
    : { available: false, reason: tmuxProbe.reason || "tmux is not on PATH" };

  const orch = resolvePluginBinary({
    envName: "AGENT_ORCHESTRATION_MCP",
    env,
    sibling: join(pluginRoot, "..", "agent-orchestration", ORCH_BIN),
    cacheDir: home,
    pluginName: "agent-orchestration",
    binRel: ORCH_BIN,
    dbg,
  });
  // Missing sandbox deps DEGRADE this backend (it can run supervised=0); only a
  // missing binary blocks it. The sandbox section of the report carries the detail.
  const orchestration = orch.path
    ? { available: true, path: orch.path }
    : { available: false, reason: `agent-orchestration-mcp not found (looked: ${orch.tried.join(", ")})` };

  // The topology layer ships in the SAME sibling plugin as the broker, under a different
  // binary: `bin/ao-topology` launches tmux-hosted agent teams, `bin/agent-orchestration-mcp`
  // serves the sandboxed broker. Two probes, one plugin — a host can have one and not the
  // other only if the plugin is half-installed, and then each says so for itself.
  const top = resolvePluginBinary({
    envName: "TM_TOPOLOGY_BIN",
    env,
    sibling: join(pluginRoot, "..", "agent-orchestration", TOPOLOGY_BIN),
    cacheDir: home,
    pluginName: "agent-orchestration",
    binRel: TOPOLOGY_BIN,
    dbg,
  });
  // tmux IS the topology layer's runtime — panes are where its agents live — so a host
  // without tmux has the launcher and no place to run it.
  const topology = !top.path
    ? { available: false, reason: `ao-topology not found (looked: ${top.tried.join(", ")})` }
    : !tmux.available
      ? { available: false, path: top.path, reason: "needs tmux, which is not on PATH" }
      : { available: true, path: top.path };

  return {
    backends: { topology, orchestration, tmux, manual: { available: true } },
    clis,
    sandbox,
  };
}

let memo;
/**
 * The host capability report. Called with no arguments it is memoized for the
 * process — probes spawn subprocesses, and nothing about PATH changes mid-run.
 * Pass `opts` ({ env, probe, pluginRoot }) to bypass the cache and stub the world.
 */
export function detectHostCaps(opts) {
  if (opts !== undefined) {
    return detect({ env: process.env, probe: defaultProbe, pluginRoot: DEFAULT_PLUGIN_ROOT, ...opts });
  }
  if (!memo) memo = detect({ env: process.env, probe: defaultProbe, pluginRoot: DEFAULT_PLUGIN_ROOT });
  return memo;
}

/** Long-lived processes (the MCP server) and tests need a way to re-probe. */
export function resetHostCapsCache() {
  memo = undefined;
}

/** Human rendering for `tm caps`; --json gets the raw report instead. */
export function renderCaps(report) {
  const line = (name, e, always) =>
    `  ${e.available ? "✓" : "✗"} ${name.padEnd(15)}${
      e.available ? always || e.version || e.path || "available" : e.reason || "unavailable"
    }`;
  return [
    "backends",
    line("topology", report.backends.topology),
    line("orchestration", report.backends.orchestration),
    line("tmux", report.backends.tmux),
    line("manual", report.backends.manual, "the floor — always available"),
    "clis",
    ...Object.entries(report.clis).map(([name, e]) => line(name, e)),
    "sandbox (orchestration degrades without these, does not block)",
    ...Object.entries(report.sandbox).map(([name, e]) => line(name, e)),
  ].join("\n");
}
