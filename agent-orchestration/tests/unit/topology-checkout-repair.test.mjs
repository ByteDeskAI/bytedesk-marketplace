// TM-394: broken-checkout detection and repair. Every fixture lives under a fresh tmpdir; the
// "remote" is a local bare repository, and no test touches a real checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureCheckout, inspectCheckout, repairCheckout, repairRegisteredCheckouts, superviseCheckout } from "../../topology/lib/checkout-repair.mjs";
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

// Enough tracked files that the 10% closeness gate admits a couple of local edits.
const FILLER = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`filler/f${String(i).padStart(2, "0")}.txt`, `filler ${i}\n`]));

/** A bare repository holding `files` on main, for a foreign or second remote. */
async function bareRepo(root, name, files) {
  const bare = join(root, `${name}.git`), seed = join(root, `${name}-seed`);
  await git("init", "-q", "--bare", "-b", "main", bare);
  await git("init", "-q", "-b", "main", seed);
  await writeTree(seed, files);
  await git("-C", seed, "add", "-A"); await git("-C", seed, "commit", "-qm", "init");
  await git("-C", seed, "push", "-q", bare, "main");
  return bare;
}

/**
 * A bare remote with tag v1 and a later main commit that changes b.txt and adds new.txt, plus a
 * checkout holding v1's files whose `.git` points into a deleted /tmp-style repository.
 */
async function fixture(t, { repository = "remote", checkoutFiles = null, gitdir = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ao-checkout-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bare = join(root, "remote.git"), seed = join(root, "seed"), checkout = join(root, "checkout");
  const pkg = JSON.stringify(repository === "remote" ? { name: "fixture", repository: { type: "git", url: bare } }
    : repository === "none" ? { name: "fixture" } : { name: "fixture", repository });
  const v1 = { "package.json": pkg, "a.txt": "alpha\n", "b.txt": "bravo\n", "dir/c.txt": "charlie\n", ".gitignore": "ignored/\n", ...FILLER };
  await git("init", "-q", "--bare", "-b", "main", bare);
  await git("init", "-q", "-b", "main", seed);
  await writeTree(seed, v1);
  await git("-C", seed, "add", "-A"); await git("-C", seed, "commit", "-qm", "v1"); await git("-C", seed, "tag", "v1");
  await writeTree(seed, { "b.txt": "bravo upstream\n", "new.txt": "new upstream\n" });
  await git("-C", seed, "add", "-A"); await git("-C", seed, "commit", "-qm", "v2");
  await git("-C", seed, "push", "-q", bare, "main", "--tags");
  await mkdir(checkout);
  await writeTree(checkout, checkoutFiles ?? v1);
  await writeFile(join(checkout, ".git"), `gitdir: ${gitdir ?? join(root, "gone", "repo.git", "worktrees", "checkout")}\n`);
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
  const f = await fixture(t, { checkoutFiles: { "package.json": "", "x1": "1", "x2": "2", "x3": "3", "x4": "4", ...FILLER } });
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

test("a directory naming an unrelated repository is refused, not adopted into it (review repro)", async (t) => {
  const f = await fixture(t);
  const foreign = await bareRepo(f.root, "foreign", Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`foreign/${i}.txt`, `foreign ${i}\n`])));
  const dir = join(f.root, "own");
  await writeTree(dir, { ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`own/${i}.txt`, `own ${i}\n`])),
    "package.json": JSON.stringify({ name: "own", repository: foreign }) });
  await addServiceRepo(dir, { env: f.env });
  const before = await treeHash(dir);
  const [report] = await repairRegisteredCheckouts({ env: f.env, ensureLead: f.ensureLead });
  assert.equal(report.action, "refused", JSON.stringify(report));
  assert.equal(report.status, "missing-git");
  assert.equal(report.alert.code, "TOPOLOGY_CHECKOUT_NO_CLOSE_REVISION");
  assert.equal(await treeHash(dir), before, "nothing changed: no .git adopted, no file touched");
  assert.deepEqual(f.leads, []);
});

test("a gitdir that cannot be stat'ed (EACCES) is unreadable and refused, never treated as gone", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-checkout-eacces-"));
  const locked = join(root, "locked");
  await mkdir(join(locked, "repo.git", "worktrees", "checkout"), { recursive: true });
  t.after(async () => { await chmod(locked, 0o755).catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const f = await fixture(t, { gitdir: join(locked, "repo.git", "worktrees", "checkout") });
  await chmod(locked, 0o000);
  const before = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  await chmod(locked, 0o755);
  assert.equal(result.action, "refused", JSON.stringify(result));
  assert.equal(result.status, "unreadable");
  assert.equal(result.alert.code, "TOPOLOGY_CHECKOUT_NOT_REPAIRABLE");
  assert.match(result.alert.message, /EACCES/);
  assert.equal(await treeHash(f.checkout), before);
  assert.deepEqual(f.leads, []);
});

test("a repair killed between stash and apply leaves an in-progress record that is reported, never re-run", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.checkout, "a.txt"), "alpha, edited before the crash\n");
  const kill = async () => { throw Object.assign(new Error("simulated kill"), { code: "SIMULATED_KILL" }); };
  await assert.rejects(repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead, afterStash: kill }), { code: "SIMULATED_KILL" });
  // The crash left the edit only in the stash and the snapshot, and the tree looks healthy.
  assert.equal(await read(f.checkout, "a.txt"), "alpha\n");
  assert.equal((await inspectCheckout(f.checkout)).status, "healthy");
  const after = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "interrupted", JSON.stringify(result));
  assert.equal(result.alert.code, "TOPOLOGY_CHECKOUT_REPAIR_INTERRUPTED");
  assert.ok(result.alert.message.includes(result.backup_branch) && result.alert.message.includes(result.stash.sha), result.alert.message);
  assert.equal(await blob(f.checkout, `${result.stash.sha}:a.txt`), "alpha, edited before the crash\n");
  assert.equal(await blob(f.checkout, `${result.backup_branch}:a.txt`), "alpha, edited before the crash\n");
  assert.equal(await treeHash(f.checkout), after, "the second call changed nothing");
  await assert.rejects(ensureCheckout({ consumer: f.checkout, env: f.env }), { code: "TOPOLOGY_CHECKOUT_BROKEN" });
  assert.deepEqual(f.leads, []);
});

test("a remote shaped like a git option is refused", async (t) => {
  const f = await fixture(t, { repository: "--upload-pack=touch PWNED" });
  const before = await treeHash(f.checkout);
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "refused");
  assert.equal(result.alert.code, "TOPOLOGY_CHECKOUT_UNSAFE_REMOTE");
  assert.equal(await treeHash(f.checkout), before);
  assert.deepEqual(await scratchLeftovers(f.root), []);
});

test("an ignored file the advance would overwrite keeps the tree at the matched revision", async (t) => {
  const f = await fixture(t);
  // Locally ignored new.txt; upstream main adds a tracked new.txt that reset --hard would overwrite.
  await writeFile(join(f.checkout, ".gitignore"), "ignored/\nnew.txt\n");
  await writeFile(join(f.checkout, "new.txt"), "my ignored new.txt\n");
  const result = await repairCheckout({ dir: f.checkout, env: f.env, ensureLead: f.ensureLead });
  assert.equal(result.action, "repaired", JSON.stringify(result));
  assert.equal(result.advance, "skipped-ignored-collision");
  assert.deepEqual(result.collisions, ["new.txt"]);
  assert.equal(await read(f.checkout, "new.txt"), "my ignored new.txt\n");
  assert.equal(await read(f.checkout, ".gitignore"), "ignored/\nnew.txt\n");
  assert.equal(await git("-C", f.checkout, "rev-parse", "HEAD"), result.matched.rev, "the branch stayed at the match");
  assert.equal(result.stash.state, "applied");
});

test("supervise: a mid-run repair ends the supervisor so it restarts under the repaired identity", async (t) => {
  const f = await fixture(t);
  const healthy = join(f.root, "healthy");
  await git("clone", "-q", f.bare, healthy);
  assert.equal(await superviseCheckout({ consumer: healthy, env: f.env, ensureLead: f.ensureLead }), null);
  await assert.rejects(superviseCheckout({ consumer: f.checkout, env: f.env, ensureLead: f.ensureLead }),
    (error) => error.code === "TOPOLOGY_CHECKOUT_REPAIRED" && error.details.action === "repaired");
  assert.equal(await git("-C", f.checkout, "rev-parse", "HEAD"), f.tip);
  // `once` has no restart to hand over to, so it reports instead of throwing.
  const g = await fixture(t);
  assert.equal((await superviseCheckout({ consumer: g.checkout, env: g.env, ensureLead: g.ensureLead, once: true })).action, "repaired");
});

test("lead ensure refuses with TOPOLOGY_CHECKOUT_BROKEN for a checkout it cannot repair", async (t) => {
  const f = await fixture(t, { repository: "none" });
  const cli = join(import.meta.dirname, "..", "..", "topology", "cli.mjs");
  const home = join(f.root, "home");
  await mkdir(home);
  const before = await treeHash(f.checkout);
  const env = { ...Object.fromEntries(Object.entries(f.env).filter(([k]) => !["TMUX", "TMUX_PANE", "AO_LEAD_ID"].includes(k))), HOME: home, TMUX: "" };
  const outcome = await new Promise((done) => execFile(process.execPath, [cli, "lead", "ensure", "--consumer", f.checkout],
    { env, timeout: 60_000 }, (error, stdout, stderr) => done({ code: error?.code ?? 0, text: `${stdout}${stderr}` })));
  assert.notEqual(outcome.code, 0, outcome.text);
  assert.match(outcome.text, /TOPOLOGY_CHECKOUT_BROKEN/);
  assert.equal(await treeHash(f.checkout), before);
  const leads = await readdir(join(f.root, "state", "leads")).catch(() => []);
  assert.deepEqual(leads.filter((name) => /^[0-9a-f]{16}\.json$/.test(name)), [], "no lead record was minted");
});
