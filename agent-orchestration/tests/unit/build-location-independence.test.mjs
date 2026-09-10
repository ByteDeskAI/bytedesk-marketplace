// TM-152. `build:check` passed in the canonical checkout and failed in every linked worktree, at
// the same revision with the same esbuild. Not a stale bundle — a bundle that records WHERE IT WAS
// BUILT: esbuild writes each module's resolved path into the output as a comment, and through a
// symlinked node_modules those paths realpath to somewhere outside the tree.
//
// Measured, before the fix: 97 comments rewritten, claude-agent-acp.mjs 3,104 bytes larger,
// identical code. Every dispatched worker in this repository works in a worktree, so every one of
// them saw a false failure and could not tell it from a true one.
//
// The proof that it is fixed is a MEASUREMENT and lives in the task's evidence: the same two
// bundles built with a real node_modules and with a symlinked one now hash identically, and both
// match the committed dist. This test is the cheap guard that keeps the two settings from being
// tidied away by someone who does not know what they are for — it cannot prove determinism, and it
// does not pretend to.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../scripts/build.mjs", import.meta.url), "utf8");

test("the bundle build does not follow symlinks out of the tree", () => {
  assert.match(source, /preserveSymlinks:\s*true/,
    "without preserveSymlinks esbuild realpaths every module and the bundle records the mount point");
  assert.match(source, /absWorkingDir:\s*root/,
    "without absWorkingDir the remaining relative paths depend on the cwd the command was run from");
});

test("the ACP entry point is mapped back in-tree, because require.resolve always realpaths", () => {
  // preserveSymlinks is an esbuild setting and cannot reach Node's own resolver. An entry point
  // named through require.resolve therefore comes back as the symlink TARGET, and that one path
  // was enough to keep claude-agent-acp.mjs location-dependent after everything else was fixed.
  assert.match(source, /inTree\(require\.resolve\(/,
    "the ACP entry point must be mapped back onto the literal in-tree node_modules");
  assert.match(source, /realpath\(nodeModules\)/,
    "the mapping needs the realpath of node_modules to know what prefix to replace");
});
