import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
  async function walk(dir, prefix = "") {
    const names = [];
    for (const entry of await readdir(dir)) {
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const info = await stat(join(dir, entry));
      if (info.isDirectory()) names.push(...await walk(join(dir, entry), rel));
      else names.push(rel);
    }
    return names;
  }
  for (const name of await walk(scratch)) {
    const [expected, actual] = await Promise.all([
      readFile(join(root, "dist", name)),
      readFile(join(scratch, name)),
    ]);
    if (hash(expected) !== hash(actual)) throw new Error(`Tracked bundle is stale: dist/${name}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
