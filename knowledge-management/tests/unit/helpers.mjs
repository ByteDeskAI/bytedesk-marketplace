import { mkdtempSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { paths } from "../../lib/paths.mjs";
import { initBundle } from "../../lib/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "..", "fixtures", "bundles");

export function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), "km-test-"));
  process.env.KM_ROOT = dir;
  return dir;
}

export function withBundle(fn) {
  const prev = process.env.KM_ROOT;
  const dir = tempProject();
  try {
    const p = paths(dir);
    initBundle(p);
    return fn(p, dir);
  } finally {
    if (prev === undefined) delete process.env.KM_ROOT;
    else process.env.KM_ROOT = prev;
  }
}

export function loadFixture(name) {
  const prev = process.env.KM_ROOT;
  const dir = tempProject();
  const src = join(FIXTURES, name);
  const dest = join(dir, ".bytedesk", "knowledge");
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  mkdirSync(join(dest, ".km"), { recursive: true });
  return {
    dir,
    paths: paths(dir),
    restore() {
      if (prev === undefined) delete process.env.KM_ROOT;
      else process.env.KM_ROOT = prev;
    },
  };
}
