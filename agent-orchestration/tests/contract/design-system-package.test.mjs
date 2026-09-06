import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(root, "node_modules/@bytedesk/design-client/cli.mjs");

test("packed plugin owns its complete design identity and rejects parent inheritance or payload drift", async () => {
  const scratch = await mkdtemp(join(os.tmpdir(), "ao-design-package-"));
  try {
    // A conflicting marketplace identity must never become the plugin identity.
    await writeFile(join(scratch, ".design-system.json"), JSON.stringify({ app: "task-management", version: "2.2.1" }));
    const { stdout } = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], { cwd: root });
    const [packed] = JSON.parse(stdout);
    await run("tar", ["-xzf", join(scratch, packed.filename), "-C", scratch]);
    const installed = join(scratch, "package");
    const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    assert.equal(manifest.dependencies["@bytedesk/design-tokens"], "2.2.1");
    assert.equal(manifest.devDependencies["@bytedesk/design-client"], "2.2.1");
    const pinPath = join(installed, ".design-system.json");
    const pin = await readFile(pinPath, "utf8");
    assert.deepEqual(JSON.parse(pin), { app: "agent-orchestration", version: "2.2.1" });
    await assert.rejects(access(join(installed, "node_modules")));
    const env = { PATH: process.env.PATH, HOME: scratch, NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_GLOBALCONFIG: "/dev/null" };
    const check = () => run(process.execPath, [cli, "sync", "--check"], { cwd: installed, env });
    assert.match((await check()).stdout, /ok: agent-orchestration@2\.2\.1/);

    await rm(pinPath);
    await assert.rejects(check, /\.design-system\.json/);
    await writeFile(pinPath, pin);
    const payload = join(installed, ".context/design-system/apps/agent-orchestration/PRODUCT.md");
    const original = await readFile(payload);
    await writeFile(payload, "tampered context\n");
    await assert.rejects(check, /modified|hash|differ|changed/i);
    await writeFile(payload, original);
    const unexpected = join(installed, ".context/design-system/apps/task-management");
    await mkdir(unexpected);
    await writeFile(join(unexpected, "PRODUCT.md"), "wrong identity\n");
    await assert.rejects(check, /not the configured app or a listed sibling/);
    await rm(unexpected, { recursive: true });
    assert.match((await check()).stdout, /ok: agent-orchestration@2\.2\.1/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
