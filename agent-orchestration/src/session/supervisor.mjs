import { access, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { invariant } from "../errors.mjs";
import { spawnUserManagerFile, runUserManagerFile } from "../runtime/user-bus.mjs";
import { ensurePrivateDir, sha256 } from "../util.mjs";
import { probeSessionHost } from "./host.mjs";

export const SESSION_SUPERVISOR_UNIT_PATTERN = /^agent-orchestration-session-[a-f0-9]{12}\.scope$/;

export function sessionSupervisorUnitBase(stateRoot) {
  invariant(typeof stateRoot === "string" && isAbsolute(stateRoot), "AO_UNSAFE_SUPERVISOR_UNIT", "Session supervisor state root must be an absolute path.");
  return `agent-orchestration-session-${sha256(resolve(stateRoot)).slice(0, 12)}`;
}

export function sessionSupervisorUnit(stateRoot) {
  return `${sessionSupervisorUnitBase(stateRoot)}.scope`;
}

export function assertSessionSupervisorUnit(unit) {
  invariant(SESSION_SUPERVISOR_UNIT_PATTERN.test(unit), "AO_UNSAFE_SUPERVISOR_UNIT", "Refusing to operate on an untrusted session supervisor unit name.");
}

export function sessionHostCliPath(pluginRoot) {
  return join(pluginRoot, "dist", "cli.cjs");
}

export function sessionSupervisorEnabled({ platform = process.platform, env = process.env } = {}) {
  if (env.AGENT_ORCHESTRATION_SESSION_SUPERVISOR === "0") return false;
  if (env.AGENT_ORCHESTRATION_SESSION_HOST === "1") return false;
  if (platform === "win32") return false;
  return true;
}

export async function shouldSuperviseSessionHost({
  pluginRoot,
  cliPath = pluginRoot ? sessionHostCliPath(pluginRoot) : undefined,
  platform = process.platform,
  env = process.env,
} = {}) {
  if (!sessionSupervisorEnabled({ platform, env })) return false;
  if (typeof cliPath !== "string" || cliPath.length === 0) return false;
  try {
    await access(cliPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sessionSupervisorArgs({
  nodePath = process.execPath,
  cliPath,
  stateRoot,
}) {
  const unitBase = sessionSupervisorUnitBase(stateRoot);
  return [
    "--user", "--scope", "--collect", "--quiet", `--unit=${unitBase}`,
    "--property=KillMode=control-group", "--property=TimeoutStopSec=3s", "--property=RuntimeMaxSec=24h",
    "--property=MemoryMax=8G", "--property=TasksMax=512",
    "/usr/bin/prlimit", "--core=0", "--fsize=1073741824", "--",
    nodePath, cliPath, "session-host", "--state-root", stateRoot,
  ];
}

export async function waitForSessionHostLease(stateRoot, { timeoutMs = 5_000, intervalMs = 50, probe = probeSessionHost } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = await probe(stateRoot);
    if (live) return live;
    await delay(intervalMs);
  }
  return null;
}

export async function launchSessionSupervisor({
  pluginRoot,
  stateRoot,
  cliPath = sessionHostCliPath(pluginRoot),
  nodePath = process.execPath,
  spawnUserManager = spawnUserManagerFile,
  openLog = defaultOpenLog,
} = {}) {
  const unit = sessionSupervisorUnit(stateRoot);
  assertSessionSupervisorUnit(unit);
  const { stdout, stderr } = await openLog(stateRoot);
  let child;
  try {
    child = await spawnUserManager("/usr/bin/systemd-run", sessionSupervisorArgs({ nodePath, cliPath, stateRoot }), {
      cwd: pluginRoot,
      env: {
        ...process.env,
        AGENT_ORCHESTRATION_STATE_HOME: stateRoot,
        AGENT_ORCHESTRATION_SESSION_HOST: "1",
      },
      detached: true,
      stdio: ["ignore", stdout.fd, stderr.fd],
      shell: false,
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    child.unref();
    return { child, unit, supervisorUnit: unit };
  } finally {
    await stdout.close?.().catch(() => {});
    await stderr.close?.().catch(() => {});
  }
}

export async function stopSessionSupervisor(stateRoot, dependencies = {}) {
  const unit = sessionSupervisorUnit(stateRoot);
  assertSessionSupervisorUnit(unit);
  await runUserManagerFile("/usr/bin/systemctl", ["--user", "stop", unit], { timeoutMs: 10_000 }, dependencies);
}

async function defaultOpenLog(stateRoot) {
  const logDir = await ensurePrivateDir(join(stateRoot, "logs"));
  const stdout = await open(join(logDir, "session-host.out.log"), "a", 0o600);
  const stderr = await open(join(logDir, "session-host.err.log"), "a", 0o600);
  return { stdout, stderr };
}
