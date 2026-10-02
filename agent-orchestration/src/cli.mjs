#!/usr/bin/env node
import { parseArgs } from "node:util";
import { join } from "node:path";
import { OrchestrationService } from "./service.mjs";
import { PLUGIN_ROOT, stateRoot as resolveStateRoot, validateStateRoot } from "./config.mjs";
import { serializeError } from "./errors.mjs";
import { probeSessionHost, startSessionHost } from "./session/host.mjs";
import { runServicesCommand } from "./services/cli.mjs";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      "state-root": { type: "string" },
      "run-id": { type: "string" },
      "consumer-cwd": { type: "string" },
      "no-browser": { type: "boolean" },
      json: { type: "boolean" },
      detach: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (command === "services") {
    process.exitCode = await runServicesCommand(positionals[0], values, positionals.slice(1));
    return;
  }
  if (command === "session-host") {
    process.env.AGENT_ORCHESTRATION_SESSION_HOST = "1";
    const stateRoot = validateStateRoot(values["state-root"] || resolveStateRoot(), PLUGIN_ROOT);
    // TM-272: one host per state root. A second one would bind another port and overwrite the
    // lease, orphaning every capability URL the first had minted. Exit 0: losing is not a failure,
    // and process-compose must not read it as a crash.
    let live = await probeSessionHost(stateRoot);
    // Under process-compose, exiting would be restarted every two seconds for as long as an older
    // host (a pre-TM-272 24h scope) lives. Wait it out instead, and take over when it is gone.
    if (live && process.env.AGENT_ORCHESTRATION_SERVICES_MANAGED === "1") {
      process.stderr.write(`Waiting: a session host not run by the services owns ${stateRoot} (pid ${live.pid}).\n`);
      while (live) { await new Promise((resolve) => setTimeout(resolve, 5_000)); live = await probeSessionHost(stateRoot); }
    }
    if (live) {
      process.stderr.write(`A session host is already running for ${stateRoot} (pid ${live.pid}, http://127.0.0.1:${live.port}/). Not starting another.\n`);
      return;
    }
    // TM-272: the always-on host owns run recovery for its state root, so lost workers are found
    // even when no Claude or Codex session (and so no MCP server) is open. Concurrent sweepers are
    // safe: each run is recovered under its own cross-process lock and re-read inside it.
    const service = await new OrchestrationService({
      stateRoot,
      autoRecover: true,
    }).initialize();
    const host = await startSessionHost({
      stateRoot,
      uiRoot: join(PLUGIN_ROOT, "dist", "session-ui"),
      controls: service.sessionControls(),
    });
    host.server.ref();
    process.stderr.write(`Orchestration session host: http://127.0.0.1:${host.port}/\n`);
    await new Promise(() => {});
    return;
  }
  const service = await new OrchestrationService({ stateRoot: values["state-root"] }).initialize();
  if (command === "worker") {
    if (!values["run-id"]) throw new Error("--run-id is required");
    process.stdout.write(`${JSON.stringify(await service.worker(values["run-id"]), null, 2)}\n`);
    return;
  }
  if (command === "doctor") {
    process.stdout.write(`${JSON.stringify(await service.doctor({ consumerCwd: values["consumer-cwd"] }), null, 2)}\n`);
    return;
  }
  if (command === "session-open") {
    if (!values["run-id"]) throw new Error("--run-id is required");
    // The control seam: a caller that already holds the host's trust (the gateway, acting for a
    // signed-in operator) needs the capability URL itself, not a browser window on this machine.
    // Everything the URL grants is unchanged — loopback only, one exchange, ten minutes.
    const session = await service.openRunSession(values["run-id"], { openBrowser: !values["no-browser"], requireDurableHost: true });
    process.stdout.write(values.json ? `${JSON.stringify(session, null, 2)}\n` : `${session.url}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(await service.getRun({ runId: values["run-id"], consumerCwd: values["consumer-cwd"] }), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: agent-orchestration <worker|doctor|status|session-open|session-host> [options]; agent-orchestration services install|ensure|status|restart <process>|stop <process>|probe|uninstall");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify(serializeError(error))}\n`);
  process.exitCode = 1;
});
