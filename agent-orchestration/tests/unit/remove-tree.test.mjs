import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { removeTree } from "../../src/util.mjs";

/** The shape `go build` leaves behind: 0444 files inside 0555 directories. */
async function goModuleCache(root) {
  const cache = join(root, "provider-home", "claude", "go", "pkg", "mod", "golang.org", "toolchain@v0.0.1");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "LICENSE"), "BSD-3-Clause\n", { mode: 0o444 });
  await chmod(cache, 0o555);
  await chmod(join(root, "provider-home", "claude", "go", "pkg", "mod", "golang.org"), 0o555);
  return cache;
}

test("removeTree deletes a tree containing a read-only Go module cache", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX directory permissions only");
  const root = await mkdtemp(join(os.tmpdir(), "ao-remove-tree-"));
  await goModuleCache(root);

  // The bug: force only swallows ENOENT, so unlink still fails on a 0555 parent.
  await assert.rejects(rm(root, { recursive: true, force: true }), (error) => error.code === "EACCES" || error.code === "EPERM");

  await removeTree(root);
  assert.equal(existsSync(root), false);
});

test("removeTree does not follow symlinked directories out of the tree", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX directory permissions only");
  const root = await mkdtemp(join(os.tmpdir(), "ao-remove-tree-"));
  const outside = await mkdtemp(join(os.tmpdir(), "ao-remove-tree-outside-"));
  const guarded = join(outside, "guarded");
  await mkdir(guarded);
  await chmod(guarded, 0o555);
  await symlink(outside, join(root, "escape"));
  await goModuleCache(root);

  await removeTree(root);
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(guarded), true, "a symlinked directory outside the tree must survive");

  await chmod(guarded, 0o700);
  await rm(outside, { recursive: true, force: true });
});

test("removeTree is a no-op for a path that is already gone", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-remove-tree-"));
  await rm(root, { recursive: true, force: true });
  await removeTree(root);
});
