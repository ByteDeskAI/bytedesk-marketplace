// TM-443: task-management's host-side git goes through lib/safe-git.mjs (a byte-identical copy of
// agent-orchestration's; agent-orchestration's suite checks the two match). This suite stands alone.
import { after, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, git, tempRepo } from "./helpers.mjs";
import { governanceGit } from "../../lib/governance-check.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const trash = [];
after(() => cleanup(...trash));

it("TM-443: a planted fsmonitor, hook, pager, external diff and filter never run through governanceGit", () => {
  const repo = tempRepo(); trash.push(repo);
  const marker = join(repo, "..", `planted-${process.pid}-${Date.now()}`), script = `${marker}.sh`;
  writeFileSync(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`); chmodSync(script, 0o755);
  writeFileSync(join(repo, "a.txt"), "one\n"); git(repo, "add", "a.txt"); git(repo, "commit", "-qm", "a");
  for (const [key, value] of [["core.fsmonitor", script], ["core.hooksPath", repo], ["diff.external", script], ["core.pager", script], ["filter.p.clean", script], ["filter.p.required", "true"]]) git(repo, "config", key, value);
  writeFileSync(join(repo, ".git", "info", "attributes"), "* filter=p\n");
  writeFileSync(join(repo, "a.txt"), "two\n");
  assert.match(governanceGit(repo, "status", "--porcelain"), /a\.txt/);
  assert.match(governanceGit(repo, "diff"), /two/);
  const fired = (() => { try { return readFileSync(marker, "utf8"); } catch { return ""; } })();
  assert.equal(fired, "", "a planted vector ran");
});

it("TM-443: no raw git spawn outside lib/safe-git.mjs", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const files = [...walk(join(ROOT, "lib")).filter((f) => /\.mjs$/.test(f)), ...walk(join(ROOT, "bin"))];
  assert.ok(files.length >= 40, `scanned only ${files.length} files`);
  const RAW = /\b\w+\(\s*(['"])(?:\/usr\/bin\/)?git(?:\.exe)?\1\s*,/g;
  // The generated launcher template locates lib/ and so cannot import it; it runs only rev-parse.
  const allowed = new Set(["lib/launcher.mjs", "lib/safe-git.mjs"]);
  const hits = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(RAW)].map((m) => relative(ROOT, f)));
  assert.ok(hits.includes("lib/launcher.mjs"), "the pattern no longer finds the known launcher call");
  assert.deepEqual(hits.filter((f) => !allowed.has(f)), []);
});
