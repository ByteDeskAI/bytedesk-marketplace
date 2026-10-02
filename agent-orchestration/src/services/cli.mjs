// `agent-orchestration services install|ensure|status|probe|uninstall` (TM-272).
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_ROOT, stateRoot as resolveStateRoot, validateStateRoot } from "../config.mjs";
import { serializeError } from "../errors.mjs";
import { addServiceRepo } from "../../topology/lib/services-client.mjs";
import { canonicalRepoId, repositoryConsumer } from "../../topology/lib/repoid.mjs";
import { controlProcess, dataHome, ensureServices, installProcessCompose, probeService, servicesStatus, uninstallServices } from "./services.mjs";

const USAGE = "Usage: agent-orchestration services install|ensure|status|restart <process>|stop <process>|probe <session-host|nats>|uninstall [--state-root <dir>] [--consumer-cwd <repo>] [--json] [--detach]";

function summary(report) {
  if (report.processCompose) {
    const rows = report.processes.map((p) => `${p.name}=${p.state}${p.ready ? `/${p.ready}` : ""} pid=${p.pid} restarts=${p.restarts}`);
    return `services: process-compose ${report.processCompose.alive ? "answering" : "not answering"} (${report.registration.mode}, ${report.registration.active ?? "n/a"})${rows.length ? `; ${rows.join("; ")}` : ""}${report.unsupported.length ? `; unsupported: ${report.unsupported.map((u) => u.process).join(", ")}` : ""}`;
  }
  return `services: ok (${report.mode}, process-compose ${report.version}, port ${report.port}) ${report.actions.length ? report.actions.join(", ") : "no changes"}`;
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

export async function runServicesCommand(sub, values, positionals) {
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
      if (values.detach) return detach(stateRoot, consumerCwd);
      try {
        if (consumerCwd) await registerRepository(consumerCwd, stateRoot);
        print(await ensureServices({ stateRoot }));
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
