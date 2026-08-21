import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(os.tmpdir(), "ao-build-check-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");

try {
  const child = spawn(process.execPath, [join(root, "scripts", "build.mjs")], {
    cwd: root,
    env: { ...process.env, AO_BUILD_OUTDIR: scratch },
    stdio: "inherit",
    shell: false,
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) process.exit(exitCode ?? 1);
  for (const name of await readdir(scratch)) {
    const [expected, actual] = await Promise.all([
      readFile(join(root, "dist", name)),
      readFile(join(scratch, name)),
    ]);
    if (hash(expected) !== hash(actual)) throw new Error(`Tracked bundle is stale: dist/${name}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
