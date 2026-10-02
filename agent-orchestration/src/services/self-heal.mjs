// TM-285: what earlier ao installs leave behind on a developer machine, found and (where it is
// safe) repaired by `services ensure`, and reported by `services status` and the doctor:
//   - MCP servers still running an older build than the services pointer (report only; a host
//     session owns its MCP server, and only restarting that session replaces it);
//   - leaked agent-orchestration-session-*.scope units whose state root is gone (temp-dir runs),
//     and a pre-services session host still holding the managed state root;
//   - a TMUX_TMPDIR long enough that tmux's socket path exceeds the unix-socket limit.
// A detached nats-server on the managed JetStream store is handed over by prepareLocalNats
// (TM-272), which every ensure already runs; nothing here duplicates it.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { sessionSupervisorUnit, SESSION_SUPERVISOR_UNIT_PATTERN } from "../session/supervisor.mjs";
import { probeSessionHost } from "../session/host.mjs";
import { compareVersions, copyIdentity, refreshHostCopies } from "./host-copies.mjs";
import { defaultRun } from "./os-registration.mjs";

const execFileP = promisify(execFile);

/** `[[dd-]hh:]mm:ss` (ps etime) to milliseconds. */
export function parseEtime(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(text).trim());
  if (!m) return null;
  const [, d = 0, h = 0, min, s] = m;
  return (((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s)) * 1000;
}

const procArgv = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { return null; } };
const procEnviron = (pid) => { try { return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0"); } catch { return null; } };
const procParent = (pid) => { try { return Number(/\)\s+\S+\s+(\d+)/.exec(readFileSync(`/proc/${pid}/stat`, "utf8"))[1]); } catch { return null; } };
const procComm = (pid) => { try { return readFileSync(`/proc/${pid}/comm`, "utf8").trim(); } catch { return null; } };

/**
 * Running ao MCP servers: `{ pid, startedAt, root, launchedBy }`. Every host starts dist/mcp.cjs
 * by absolute path (host-launcher spawns it), so that is what identifies one. null where the
 * platform has no `ps` (native Windows).
 */
export async function listMcpServers({ platform = process.platform, now = Date.now() } = {}) {
  if (platform === "win32") return null;
  const { stdout } = await execFileP("ps", ["-A", "-ww", "-o", "pid=,etime=,args="], { maxBuffer: 32 * 1024 * 1024, timeout: 10_000 });
  const servers = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes("dist/mcp.cjs")) continue;
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    // Linux gives exact argv, so a path with spaces survives; elsewhere take the first absolute path.
    // ponytail: on macOS a node binary path containing spaces would confuse that; none seen yet.
    const argv = platform === "linux" ? procArgv(pid) : null;
    const script = argv ? argv.find((arg) => arg.endsWith("/dist/mcp.cjs")) : /\s(\/.*?\/dist\/mcp\.cjs)(?:\s|$)/.exec(` ${m[3]}`)?.[1];
    if (!script || !/agent-orchestration/.test(script)) continue;
    const parent = platform === "linux" ? procParent(pid) : null;
    const grandparent = parent ? procParent(parent) : null;
    servers.push({ pid, startedAt: now - (parseEtime(m[2]) ?? 0), root: dirname(dirname(script)), launchedBy: grandparent ? procComm(grandparent) : null });
  }
  return servers;
}

function hostOf(root) {
  if (/[\\/]\.codex[\\/]/.test(root)) return "codex";
  if (/[\\/]\.grok[\\/]/.test(root)) return "grok";
  if (/[\\/]\.claude[\\/]/.test(root)) return "claude";
  return "source checkout";
}

/**
 * MCP servers running something older than the services pointer: a lower version on disk, a
 * plugin root that is gone, or a bundle replaced on disk after the process started (the copy was
 * refreshed under it). Reported with the advice to restart that session; never signalled.
 */
export async function staleMcpServers({ pointer, platform = process.platform, list = listMcpServers, exists = existsSync, mtime = (path) => statSync(path).mtimeMs } = {}) {
  const servers = await list({ platform }).catch((error) => ({ error: error.message }));
  if (servers === null) return { supported: false, note: "process listing is not implemented on native Windows; restart long-lived host sessions after an update", servers: [] };
  if (servers.error) return { supported: false, note: `could not list processes: ${servers.error}`, servers: [] };
  const stale = [];
  for (const server of servers) {
    const reasons = [];
    const host = hostOf(server.root);
    let version = null;
    if (!exists(join(server.root, "dist", "mcp.cjs"))) reasons.push("its plugin root is gone");
    else {
      version = copyIdentity(server.root).version;
      if (pointer?.version && compareVersions(version, pointer.version) < 0) reasons.push(`runs ${version ?? "an unknown version"}, the services run ${pointer.version}`);
      // Two seconds of slack: etime has one-second resolution.
      try { if (mtime(join(server.root, "dist", "mcp.cjs")) > server.startedAt + 2_000) reasons.push("its bundle was replaced on disk after it started"); } catch { /* raced a refresh */ }
    }
    if (reasons.length) stale.push({ host, pid: server.pid, root: server.root, version, launchedBy: server.launchedBy ?? null, reasons,
      advice: `Restart that ${host === "source checkout" ? server.launchedBy ?? "host" : host} session (exit it and start a new one) so it loads ao ${pointer?.version ?? "current"}; ao never stops it for you.` });
  }
  return { supported: true, scanned: servers.length, servers: stale };
}

/** The state root a scope's session host was started with, from its processes' argv (Linux cgroup v2). */
async function scopeStateRoot(unit, run) {
  const { stdout } = await run("systemd", ["--user", "show", unit, "--property=ControlGroup", "--value"]);
  const group = stdout.trim();
  if (!group) return null;
  let pids = [];
  try { pids = readFileSync(join("/sys/fs/cgroup", group, "cgroup.procs"), "utf8").split("\n").filter(Boolean); } catch { return null; }
  for (const pid of pids) {
    const argv = procArgv(pid) ?? [];
    const at = argv.indexOf("--state-root");
    if (at >= 0 && argv.includes("session-host") && argv[at + 1]) return argv[at + 1];
  }
  return null;
}

/**
 * Leaked session-host scopes. A scope is stopped only when (a) it is the pre-services host of the
 * managed state root, which the managed session-host is waiting to replace, or (b) the state root
 * its own argv names is gone AND that root hashes to the scope's name. Every other scope — above
 * all one whose state root exists and is not the managed one — is reported and left running.
 */
export async function cleanupScopes({ stateRoot, platform = process.platform, env = process.env, run = defaultRun, readStateRoot = (unit) => scopeStateRoot(unit, run), exists = existsSync } = {}) {
  const report = { stopped: [], kept: [] };
  if (platform !== "linux") return { ...report, note: "session-host scopes exist only on Linux" };
  let listed;
  try { listed = (await run("systemd", ["--user", "list-units", "--type=scope", "--all", "--plain", "--no-legend", "agent-orchestration-session-*"])).stdout; }
  catch (error) { return { ...report, note: `systemctl unavailable: ${error.message}` }; }
  const managed = sessionSupervisorUnit(stateRoot);
  for (const unit of listed.split("\n").map((line) => line.trim().split(/\s+/)[0]).filter((u) => SESSION_SUPERVISOR_UNIT_PATTERN.test(u))) {
    let reason = null;
    if (unit === managed) {
      if (env.AGENT_ORCHESTRATION_SERVICES === "0") { report.kept.push({ unit, stateRoot, reason: "AGENT_ORCHESTRATION_SERVICES=0: this scope is the session host" }); continue; }
      reason = "a pre-services session host on the managed state root; the managed session-host takes over";
    } else {
      const root = await readStateRoot(unit).catch(() => null);
      if (!root) { report.kept.push({ unit, reason: "its state root could not be read" }); continue; }
      if (sessionSupervisorUnit(root) !== unit) { report.kept.push({ unit, stateRoot: root, reason: "its argv names a state root that does not hash to this unit" }); continue; }
      if (exists(root)) { report.kept.push({ unit, stateRoot: root, reason: "its state root exists and is not the managed one" }); continue; }
      reason = `its state root ${root} no longer exists`;
    }
    try { await run("systemd", ["--user", "stop", unit]); report.stopped.push({ unit, reason }); }
    catch (error) { report.kept.push({ unit, reason: `stop failed: ${error.message}` }); }
  }
  return report;
}

/**
 * A hand-run session host (no scope, not under process-compose) holding the managed state root's
 * lease. The managed session-host waits for it forever, so it is told to exit: SIGTERM to the
 * lease's pid, and only after /proc confirms that pid is a session host for exactly this state
 * root and was not started by the services. Linux only; elsewhere it is reported.
 */
export async function handOverLegacyHost({ stateRoot, platform = process.platform, env = process.env, probe = probeSessionHost, argvOf = procArgv, environOf = procEnviron, kill = process.kill.bind(process) } = {}) {
  if (env.AGENT_ORCHESTRATION_SERVICES === "0") return { action: "none", reason: "AGENT_ORCHESTRATION_SERVICES=0" };
  const lease = await probe(stateRoot).catch(() => null);
  if (!lease?.pid) return { action: "none" };
  if (platform !== "linux") return { action: "none", pid: lease.pid, reason: "cannot inspect the lease holder on this platform" };
  const argv = argvOf(lease.pid), environ = environOf(lease.pid);
  if (!argv || !environ) return { action: "none", pid: lease.pid, reason: "lease holder not inspectable" };
  if (environ.includes("AGENT_ORCHESTRATION_SERVICES_MANAGED=1")) return { action: "none", pid: lease.pid, reason: "managed" };
  const at = argv.indexOf("--state-root");
  if (!argv.includes("session-host") || at < 0 || argv[at + 1] !== stateRoot) return { action: "none", pid: lease.pid, reason: "lease holder is not a session host for this state root" };
  kill(lease.pid, "SIGTERM");
  return { action: "stopped", pid: lease.pid, reason: "a session host not run by the services held the managed state root" };
}

/** Unix-socket path limit (sun_path incl. NUL): 108 on Linux, 104 on macOS and the BSDs. */
export function tmuxSocketCheck({ env = process.env, platform = process.platform, uid = process.getuid?.() } = {}) {
  if (platform === "win32") return { ok: true, note: "no tmux on native Windows" };
  const limit = platform === "linux" ? 108 : 104;
  const dir = env.TMUX_TMPDIR || "/tmp";
  const path = `${dir.replace(/\/+$/, "")}/tmux-${uid}/default`;
  const bytes = Buffer.byteLength(path) + 1;
  if (bytes <= limit) return { ok: true, path, bytes, limit };
  return { ok: false, path, bytes, limit,
    problem: `TMUX_TMPDIR makes tmux's socket path ${bytes} bytes (limit ${limit}); every tmux call fails with "File name too long".`,
    fix: "unset TMUX_TMPDIR, or point it at a short directory (for example /tmp), in your shell profile and in every session's environment" };
}

/** Everything above for one ensure. Each part fails on its own; none fails the ensure. */
export async function selfHeal({ pointer, stateRoot, home, env = process.env, platform = process.platform, deps = {} } = {}) {
  const part = (promise) => Promise.resolve(promise).catch((error) => ({ error: error.message }));
  const hostCopies = await part((deps.refreshHostCopies ?? refreshHostCopies)({ pointer, home, env }));
  const scopes = await part((deps.cleanupScopes ?? cleanupScopes)({ stateRoot, platform, env, run: deps.run }));
  const legacyHost = await part((deps.handOverLegacyHost ?? handOverLegacyHost)({ stateRoot, platform, env }));
  // After the refresh, so a copy refreshed under a running server reports it as stale.
  const staleMcp = await part((deps.staleMcpServers ?? staleMcpServers)({ pointer, platform }));
  return { at: new Date().toISOString(), hostCopies, scopes, legacyHost, staleMcpServers: staleMcp, tmuxSocket: tmuxSocketCheck({ env, platform }) };
}
