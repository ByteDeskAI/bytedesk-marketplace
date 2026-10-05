// TM-394: broken-checkout detection and repair. Every fixture lives under a fresh tmpdir; the
// "remote" is a local bare repository, and no test touches a real checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectCheckout, repairCheckout, repairRegisteredCheckouts } from "../../topology/lib/checkout-repair.mjs";
import { leadRecoveryStatus } from "../../topology/lib/lead-recovery.mjs";
import { addServiceRepo } from "../../topology/lib/services-client.mjs";
import { run } from "../../topology/lib/util.mjs";

const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_NOSYSTEM: "1" };
const git = async (...args) => (await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { env: GIT_ENV })).stdout.trim();

async function writeTree(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

/** Every file under `dir` (dotfiles and .git included), path and bytes, folded into one hash. */
async function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = async (rel) => {
    for (const entry of (await readdir(join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) { hash.update(`d:${path}\0`); await walk(path); }
      else hash.update(`f:${path}\0`).update(await readFile(join(dir, path))).update("\0");
    }
  };
  await walk("");
  return hash.digest("hex");
}

/**
 * A bare remote with tag v1 and a later main commit that changes b.txt and adds new.txt, plus a
 * checkout holding v1's files whose `.git` points into a deleted /tmp-style repository.
 */
async function fixture(t, { repository = "remote", checkoutFiles = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ao-checkout-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bare = join(root, "remote.git"), seed = join(root, "seed"), checkout = join(root, "checkout");
  const pkg = JSON.stringify(repository === "remote" ? { name: "fixture", repository: { type: "git", url: bare } } : { name: "fixture" });
  const v1 = { "package.json": pkg, "a.txt": "alpha\n", "b.txt": "bravo\n", "dir/c.txt": "charlie\n", ".gitignore": "ignored/\n" };
  await git("init", "-q", "--bare", "-b", "main", bare);
  await git("init", "-q", "-b", "main", seed);
  await writeTree(seed, v1);
  await git("-C", seed, "add", "-A"); await git("-C", seed, "commit", "-qm", "v1"); await git("-C", seed, "tag", "v1");
  await writeTree(seed, { "b.txt": "bravo upstream\n", "new.txt": "new upstream\n" });
  await git("-C", seed, "add", "-A"); await git("-C", seed, "commit", "-qm", "v2");
  await git("-C", seed, "push", "-q", bare, "main", "--tags");
  await mkdir(checkout);
  await writeTree(checkout, checkoutFiles ?? v1);
  await writeFile(join(checkout, ".git"), `gitdir: ${join(root, "gone", "repo.git", "worktrees", "checkout")}\n`);
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const leads = [];
  const ensureLead = async (args) => { leads.push(args.consumer); return { action: "created" }; };
  return { root, bare, checkout, env, leads, ensureLead, tip: await git("-C", seed, "rev-parse", "HEAD") };
}

/** A blob's exact bytes as text, untrimmed: byte-identity is the claim under test. */
const blob = async (dir, spec) => (await run("git", ["-C", dir, "cat-file", "blob", spec], { env: GIT_ENV })).stdout;
const read = (dir, path) => readFile(join(dir, path), "utf8");
const scratchLeftovers = async (root) => (await readdir(root)).filter((name) => name.includes(".ao-repair-"));

test("(a) a dangling gitdir is repaired from the remote, local edits kept byte-identical", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.checkout, "a.txt"), "alpha, edited locally\n");
  await writeTree(f.checkout, { "local.txt": "only here\n", "ignored/cache.bin": "ignored bytes\n" });
  assert.equal((await inspectCheckout(f.checkout)).status, "dangling-gitdir");

  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "repaired", JSON.stringify(result));
  assert.equal(result.matched.label, "v1");
  assert.equal(result.matched.differences, 2, "a.txt modified + local.txt untracked");
  assert.equal(result.stash.state, "applied");
  assert.equal(await git("-C", f.checkout, "rev-parse", "HEAD"), f.tip, "the branch is at origin/main");
  assert.equal(await git("-C", f.checkout, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  // Local content survived, byte for byte; upstream content arrived.
  assert.equal(await read(f.checkout, "a.txt"), "alpha, edited locally\n");
  assert.equal(await read(f.checkout, "local.txt"), "only here\n");
  assert.equal(await read(f.checkout, "ignored/cache.bin"), "ignored bytes\n");
  assert.equal(await read(f.checkout, "b.txt"), "bravo upstream\n");
  assert.equal(await read(f.checkout, "new.txt"), "new upstream\n");
  // The backup branch holds the working tree as found; the old pointer is kept inside .git.
  assert.equal(await blob(f.checkout, `${result.backup_branch}:a.txt`), "alpha, edited locally\n");
  assert.equal(await blob(f.checkout, `${result.backup_branch}:local.txt`), "only here\n");
  assert.match(await readFile(result.old_pointer, "utf8"), /^gitdir: .*gone/);
  assert.equal((await inspectCheckout(f.checkout, { fsck: true })).status, "healthy");
  // Recorded in the recovery state under the repaired identity, journalled, and a lead ensured.
  const status = await leadRecoveryStatus({ consumer: f.checkout, env: f.env });
  assert.equal(status.checkout_repair.action, "repaired");
  const journal = await readFile(status.state_path.replace(/\.json$/, ".jsonl"), "utf8");
  assert.match(journal, /"event":"checkout\.repaired"/);
  assert.deepEqual(f.leads, [result.path]);
  assert.deepEqual(await scratchLeftovers(f.root), []);
});

test("(b) a conflicting pop keeps the stash, and no file content is lost", async (t) => {
  const f = await fixture(t);
  const found = { "package.json": await read(f.checkout, "package.json"), "a.txt": "alpha\n", "b.txt": "bravo, edited locally\n",
    "dir/c.txt": "charlie\n", ".gitignore": "ignored/\n", "local.txt": "untracked local\n" };
  await writeTree(f.checkout, found);

  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "repaired", JSON.stringify(result));
  assert.equal(result.stash.state, "kept");
  const stashes = (await git("-C", f.checkout, "stash", "list", "--format=%H")).split("\n");
  assert.ok(stashes.includes(result.stash.sha), "the conflicting stash is still on the stack");
  assert.equal(await blob(f.checkout, `${result.stash.sha}:b.txt`), "bravo, edited locally\n");
  // Upstream won on disk, cleanly.
  assert.equal(await read(f.checkout, "b.txt"), "bravo upstream\n");
  assert.equal(await git("-C", f.checkout, "diff", "--name-only", "--diff-filter=U"), "");
  // Every file as found is recoverable byte-for-byte from the backup branch.
  for (const [path, content] of Object.entries(found)) {
    assert.equal(await blob(f.checkout, `${result.backup_branch}:${path}`), content, path);
  }
  // The untracked file is on disk or in the stash's untracked parent; either way not lost.
  const onDisk = await read(f.checkout, "local.txt").catch(() => null);
  const inStash = await blob(f.checkout, `${result.stash.sha}^3:local.txt`).catch(() => null);
  assert.ok(onDisk === "untracked local\n" || inStash === "untracked local\n", "local.txt survives");
});

test("(c) no remote known: refused with an alert, nothing changed", async (t) => {
  const f = await fixture(t, { repository: "none" });
  await writeFile(join(f.checkout, "a.txt"), "edited\n");
  const before = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "refused");
  assert.equal(result.alert.code, "TOPOLOGY_CHECKOUT_NO_REMOTE");
  assert.equal(result.alert.path, result.path);
  assert.equal(await treeHash(f.checkout), before, "the checkout is byte-identical");
  assert.deepEqual(f.leads, []);
  assert.deepEqual(await scratchLeftovers(f.root), []);
  const status = await leadRecoveryStatus({ consumer: f.checkout, env: f.env });
  assert.equal(status.checkout_repair.alert.code, "TOPOLOGY_CHECKOUT_NO_REMOTE");
  // Backed off: an immediate second attempt does not re-run.
  assert.equal((await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead })).action, "backoff");
});

test("(d) no close revision: refused, nothing changed", async (t) => {
  const f = await fixture(t, { checkoutFiles: { "package.json": "", "x1": "1", "x2": "2", "x3": "3", "x4": "4" } });
  // The package.json above is empty, so name the remote through bytedesk-package.yaml.
  await writeFile(join(f.checkout, "bytedesk-package.yaml"), `{"spec": {"repository": "${f.bare}"}}\n`);
  const before = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead, maxDifferences: 3 });
  assert.equal(result.action, "refused", JSON.stringify(result));
  assert.equal(result.alert.code, "TOPOLOGY_CHECKOUT_NO_CLOSE_REVISION");
  assert.ok(result.closest.differences > 3);
  assert.equal(await treeHash(f.checkout), before, "the checkout is byte-identical");
  assert.deepEqual(f.leads, []);
  assert.deepEqual(await scratchLeftovers(f.root), []);
});

test("(e) a healthy repository is a no-op", async (t) => {
  const f = await fixture(t);
  const healthy = join(f.root, "healthy");
  await git("clone", "-q", f.bare, healthy);
  await writeFile(join(healthy, "a.txt"), "local edit\n");
  const before = await treeHash(healthy);
  const result = await repairCheckout({ dir: healthy, env: f.env, fsck: true, ensureLead: f.ensureLead });
  assert.equal(result.action, "healthy");
  assert.equal(await treeHash(healthy), before);
  assert.deepEqual(f.leads, []);
  assert.equal((await leadRecoveryStatus({ consumer: healthy, env: f.env })).checkout_repair, undefined);
});

test("services ensure path: a registered repository with no .git is repaired; an unregistered one is not a checkout", async (t) => {
  const f = await fixture(t);
  await rm(join(f.checkout, ".git"));
  const plain = join(f.root, "plain");
  await mkdir(plain);
  assert.equal((await inspectCheckout(plain)).status, "not-a-checkout");
  await addServiceRepo(f.checkout, { env: f.env });
  const reports = await repairRegisteredCheckouts({ env: f.env, ensureLead: f.ensureLead });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].action, "repaired", JSON.stringify(reports[0]));
  assert.equal(reports[0].status, "missing-git");
  assert.equal(await git("-C", f.checkout, "rev-parse", "HEAD"), f.tip);
  assert.deepEqual(f.leads, [reports[0].path]);
});

test("a pointer whose owning repository still exists is refused, not re-cloned", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, "gone", "repo.git", "worktrees"), { recursive: true });
  const before = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "refused");
  assert.equal(result.status, "orphaned-worktree");
  assert.equal(await treeHash(f.checkout), before);
});
