// `agent-orchestration services install|ensure|status|probe|uninstall` (TM-272).
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { PLUGIN_ROOT, stateRoot as resolveStateRoot, validateStateRoot } from "../config.mjs";
import { serializeError } from "../errors.mjs";
import { addServiceRepo } from "../../topology/lib/services-client.mjs";
import { canonicalRepoId, repositoryConsumer } from "../../topology/lib/repoid.mjs";
import { controlProcess, dataHome, ensureServices, installProcessCompose, probeService, servicePaths, servicesStatus, uninstallServices, waitForServices } from "./services.mjs";
import { projectScopeWarning } from "./project-scope.mjs";
import { selfHeal } from "./self-heal.mjs";
import { withLock } from "../../topology/lib/lockfile.mjs";

const USAGE = "Usage: agent-orchestration services install|ensure|status|restart <process>|stop <process>|wait --until healthy|<process> [running] [--timeout <s>]|probe <session-host|nats>|uninstall [--state-root <dir>] [--consumer-cwd <repo>] [--json] [--detach]";

function summary(report) {
  if (report.processCompose) {
    const rows = report.processes.map((p) => `${p.name}=${p.state}${p.ready ? `/${p.ready}` : ""} pid=${p.pid} restarts=${p.restarts}`);
    return `services: process-compose ${report.processCompose.alive ? "answering" : "not answering"} (${report.registration.mode}, ${report.registration.active ?? "n/a"})${rows.length ? `; ${rows.join("; ")}` : ""}${report.unsupported.length ? `; unsupported: ${report.unsupported.map((u) => u.process).join(", ")}` : ""}`;
  }
  return [`services: ok (${report.mode}, process-compose ${report.version}, port ${report.port}) ${report.actions.length ? report.actions.join(", ") : "no changes"}`,
    ...healLines(report.selfHeal)].join("\n");
}

/** TM-284/285: one line per thing the self-heal changed or a person must act on; nothing when all is current. */
export function healLines(heal) {
  if (!heal) return [];
  const lines = [];
  for (const c of heal.hostCopies?.refreshed ?? []) lines.push(`  refreshed ${c.host} copy ${c.root}: ${c.from ?? "?"} -> ${c.version}`);
  for (const c of [...heal.hostCopies?.skipped ?? [], ...heal.hostCopies?.failed ?? []]) lines.push(`  not refreshed ${c.host} copy ${c.root} (${c.version ?? "?"}): ${c.reason}`);
  for (const u of heal.scopes?.stopped ?? []) lines.push(`  stopped leaked ${u.unit}: ${u.reason}`);
  if (heal.legacyHost?.action === "stopped") lines.push(`  handed over from legacy session host pid ${heal.legacyHost.pid}`);
  for (const m of heal.staleMcpServers?.servers ?? []) lines.push(`  stale ao MCP server: ${m.host} pid ${m.pid} (${m.reasons.join("; ")}). ${m.advice}`);
  if (heal.tmuxSocket && !heal.tmuxSocket.ok) lines.push(`  ${heal.tmuxSocket.problem} Fix: ${heal.tmuxSocket.fix}.`);
  for (const [name, part] of Object.entries(heal)) if (part?.error) lines.push(`  self-heal ${name} failed: ${part.error}`);
  return lines;
}

/** The project-scope warning for `cwd`'s repository: the guard's predicate at the guard's repo top. */
export function sessionStartWarning(cwd) {
  const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  return projectScopeWarning(top.status === 0 ? top.stdout.trim() : cwd);
}

/**
 * --detach is for the SessionStart hook: it must return at once and never fail the session, even
 * when the first ensure has a download to do. The detached child logs to the state root.
 */
function detach(stateRoot, consumerCwd) {
  try {
    const logs = join(stateRoot, "services", "logs");
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    const log = openSync(join(logs, "ensure.log"), "a", 0o600);
    try {
      spawn(process.execPath, [process.argv[1], "services", "ensure", "--state-root", stateRoot, ...(consumerCwd ? ["--consumer-cwd", consumerCwd] : [])], {
        detached: true, stdio: ["ignore", log, log], windowsHide: true,
      }).unref();
    } finally { closeSync(log); }
  } catch (error) {
    process.stderr.write(`agent-orchestration services ensure --detach: ${error.message}\n`);
  }
  return 0;
}

/**
 * The session's own repository gets a supervisor, enrolled or not, as the `ao-topology supervise`
 * monitor gave it before TM-272. Only a git checkout: a supervisor for an arbitrary directory would
 * be a permanent process nobody asked for. Linked worktrees share one key, so they register once.
 */
async function registerRepository(cwd, stateRoot) {
  const identity = await canonicalRepoId(cwd).catch(() => null);
  if (identity?.kind !== "git-common-dir") return false;
  return addServiceRepo(await repositoryConsumer(cwd), { env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateRoot } });
}

/** TM-305: the services are the operator's; a dispatched worker neither repoints nor bounces them. */
const WORKER_REFUSED = new Set(["ensure", "restart", "stop"]);

// `statusOptions` reaches servicesStatus for `wait` (tests inject home, platform and a fake API).
export async function runServicesCommand(sub, values, positionals, env = process.env, statusOptions = {}) {
  if (WORKER_REFUSED.has(sub) && env.TM_DISPATCH_WORKER) {
    // The SessionStart hook's ensure --detach runs in every session; in a worker it is a quiet no-op.
    if (values.detach) return 0;
    process.stderr.write(`agent-orchestration services ${sub}: refused inside a dispatched worker session (TM_DISPATCH_WORKER is set). The managed services belong to the operator; ask the lead or operator to run it from the installed plugin or the source checkout.\n`);
    return 1;
  }
  let stateRoot;
  try { stateRoot = validateStateRoot(values["state-root"] || resolveStateRoot(), PLUGIN_ROOT); }
  catch (error) { if (values.detach) return 0; throw error; }
  const print = (report) => process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${summary(report)}\n`);
  switch (sub) {
    case "install": {
      const result = await installProcessCompose({ data: dataHome() });
      process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
      return 0;
    }
    case "ensure": {
      const consumerCwd = values["consumer-cwd"] ? resolve(values["consumer-cwd"]) : null;
      if (values.detach) {
        // TM-285: the SessionStart hook's stdout reaches the session, so the commit guard's finding
        // is announced now instead of at the first blocked commit. One file read; still instant.
        const warning = consumerCwd ? sessionStartWarning(consumerCwd) : null;
        if (warning) process.stdout.write(`${warning}\n`);
        return detach(stateRoot, consumerCwd);
      }
      try {
        if (consumerCwd) await registerRepository(consumerCwd, stateRoot);
        const report = await ensureServices({ stateRoot });
        // SessionStart and the monitor can ensure at once; one self-heal at a time, so two never swap the same copy.
        const dir = servicePaths({ stateRoot, data: dataHome() }).dir;
        report.selfHeal = await withLock(join(dir, "self-heal.lock"), () => selfHeal({ pointer: report.pointer, stateRoot, home: os.homedir() }), { timeoutMs: 120_000 })
          .catch((error) => ({ error: error.message }));
        await writeFile(join(dir, "self-heal.json"), `${JSON.stringify(report.selfHeal, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
        print(report);
        return 0;
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ ok: false, ...serializeError(error) }, null, values.json ? 2 : 0)}\n`);
        return 1;
      }
    }
    case "status": {
      const report = await servicesStatus({ stateRoot });
      print(report);
      return report.ok ? 0 : 1;
    }
    case "wait": {
      // TM-374: what an agent runs instead of `sleep N; services status`. One JSON line; exit 0 met,
      // 2 timed out, 1 bad argument. `--until <process> running`: the trailing word is optional.
      const until = values.until ?? "healthy";
      const timeoutSeconds = values.timeout === undefined ? 120 : Number(values.timeout);
      const extra = positionals.filter((p) => p !== "running");
      const bad = !Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 ? `--timeout must be a number of seconds, got: ${values.timeout}`
        : extra.length ? `unexpected argument: ${extra.join(" ")} (${USAGE})`
        : until === "healthy" && positionals.length ? "--until healthy takes no process state" : null;
      if (bad) { process.stderr.write(`${JSON.stringify({ ok: false, code: "AO_SERVICES_WAIT_ARG", message: bad })}\n`); return 1; }
      const result = await waitForServices({
        until, timeoutSeconds, intervalMs: Number(env.AO_SERVICES_WAIT_INTERVAL_MS) || 1000,
        status: () => servicesStatus({ stateRoot, env, ...statusOptions }),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.ok ? 0 : 2;
    }
    case "restart":
    case "stop": {
      try {
        const result = await controlProcess(sub, positionals[0], { stateRoot });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.ok ? 0 : 1;
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ ok: false, ...serializeError(error) })}\n`);
        return 1;
      }
    }
    case "probe":
      return await probeService(positionals[0], { stateRoot }) ? 0 : 1;
    case "uninstall":
      process.stdout.write(`${JSON.stringify(await uninstallServices({ stateRoot }), null, 2)}\n`);
      return 0;
    default:
      throw new Error(USAGE);
  }
}
