#!/usr/bin/env node
import { probeProviderSession } from "./acpx-driver.mjs";

const [pluginRoot, stateRoot, cwd, providerId, providerExecutable] = process.argv.slice(2);

probeProviderSession({ pluginRoot, stateRoot, cwd, providerId, providerExecutable })
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error?.code ?? "AO_PROVIDER_PROBE_FAILED"}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
