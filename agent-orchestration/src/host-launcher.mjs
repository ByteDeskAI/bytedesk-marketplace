#!/usr/bin/env node
import { serializeError } from "./errors.mjs";
import { runHost } from "./platform/host-adapters.mjs";

runHost().catch((error) => {
  process.stderr.write(`[agent-orchestration-host] ${JSON.stringify(serializeError(error))}\n`);
  process.exitCode = 1;
});
