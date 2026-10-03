// CI-only failure found in EP-026: with no local NATS home (file transport, or CI), provisionForLaunch started a
// token-only holder with no registry, so a failover from another process was refused as "not the operator".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { provisionForLaunch } from "../../topology/lib/agent-creds.mjs";

test("a holder provisioned without a local NATS can be re-attached by another process of the operator", { timeout: 60_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "aot-ft-"));
  const env = { ...process.env, AO_NATS_HOME: home, AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0" };
  delete env.AO_NATS_URL;
  const holder = await provisionForLaunch({ env, repo: "r", agent: "worker-b", role: "worker", mailTo: [], token: "tok" });
  t.after(async () => { try { await holder.stop?.(); } catch {} try { process.kill(holder.pid, "SIGTERM"); } catch {} rmSync(home, { recursive: true, force: true }); });
  assert.ok(holder?.sock, "a holder with a socket was provisioned");
  const script = `import { attachViaSocket } from ${JSON.stringify(fileURLToPath(new URL("../../topology/lib/agent-creds.mjs", import.meta.url)))};
try { const r = await attachViaSocket(${JSON.stringify(holder.sock)}, process.pid); console.log("ATTACH " + JSON.stringify(r)); } catch (e) { console.log("REFUSED " + e.message); }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 30_000 });
  console.log(result.stdout.trim());
  assert.match(result.stdout, /ATTACH \{"ok":true/, `attach from a second process: ${result.stdout}${result.stderr}`);
});
