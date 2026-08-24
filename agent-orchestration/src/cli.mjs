#!/usr/bin/env node
import { parseArgs } from "node:util";
import { join } from "node:path";
import { OrchestrationService } from "./service.mjs";
import { PLUGIN_ROOT, stateRoot as resolveStateRoot, validateStateRoot } from "./config.mjs";
import { serializeError } from "./errors.mjs";
import { startSessionHost } from "./session/host.mjs";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      "state-root": { type: "string" },
      "run-id": { type: "string" },
      "consumer-cwd": { type: "string" },
    },
    allowPositionals: true,
  });
  if (command === "session-host") {
    const stateRoot = validateStateRoot(values["state-root"] || resolveStateRoot(), PLUGIN_ROOT);
    const host = await startSessionHost({
      stateRoot,
      uiRoot: join(PLUGIN_ROOT, "dist", "session-ui"),
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
    process.stdout.write(`${JSON.stringify(await service.doctor(), null, 2)}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(await service.getRun({ runId: values["run-id"], consumerCwd: values["consumer-cwd"] }), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: agent-orchestration <worker|doctor|status> [options]");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify(serializeError(error))}\n`);
  process.exitCode = 1;
});
