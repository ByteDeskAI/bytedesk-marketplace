// TM-373: doctor compares the installed plugin SHA with origin/main and never fails offline.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pluginFreshness } from "../../src/diagnostics.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

const INSTALLED = "48e58846dbc4994755c5c7b06b3cb2543fb653e6";
const NEWER = "9eccb0d6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function cachedInstall(t) {
  const home = await mkdtemp(join(tmpdir(), "ao-freshness-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pluginRoot = join(home, ".claude", "plugins", "cache", "bytedesk", "agent-orchestration", INSTALLED.slice(0, 12));
  await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), { name: "agent-orchestration", repository: "https://example.invalid/mkt" });
  await writeJson(join(home, ".claude", "plugins", "installed_plugins.json"),
    { version: 2, plugins: { "agent-orchestration@bytedesk": [{ installPath: pluginRoot, gitCommitSha: INSTALLED }] } });
  return { home, pluginRoot };
}

/** A fake `run` that records each call and answers ls-remote with `answer`. */
const lsRemote = (answer, calls = []) => async (command, args, options) => {
  calls.push([command, ...args, options.env?.GIT_TERMINAL_PROMPT]);
  return answer;
};

test("TM-373: a cache entry behind origin/main is stale and says how to update", async (t) => {
  const { home, pluginRoot } = await cachedInstall(t);
  const calls = [];
  const report = await pluginFreshness({ pluginRoot, home, deps: { run: lsRemote({ code: 0, stdout: `${NEWER}\trefs/heads/main\n` }, calls) } });
  assert.deepEqual(calls, [["git", "ls-remote", "--", "https://example.invalid/mkt", "refs/heads/main", "0"]]);
  assert.equal(report.source, "cache");
  assert.equal(report.installed, INSTALLED);
  assert.equal(report.originMain, NEWER);
  assert.equal(report.status, "stale");
  assert.match(report.advice, /claude plugin update agent-orchestration@bytedesk/);
});

test("TM-373: a cache entry at origin/main is current", async (t) => {
  const { home, pluginRoot } = await cachedInstall(t);
  const report = await pluginFreshness({ pluginRoot, home, deps: { run: lsRemote({ code: 0, stdout: `${INSTALLED}\trefs/heads/main\n` }) } });
  assert.equal(report.status, "current");
  assert.equal(report.advice, undefined);
});

test("TM-373: offline or timed out is unknown, never a failure", async (t) => {
  const { home, pluginRoot } = await cachedInstall(t);
  const offline = await pluginFreshness({ pluginRoot, home, deps: { run: lsRemote({ code: 128, stdout: "", stderr: "fatal: unable to access" }) } });
  assert.equal(offline.status, "unknown");
  assert.equal(offline.installed, INSTALLED);
  assert.match(offline.error, /unable to access/);
  const slow = await pluginFreshness({ pluginRoot, home, timeoutMs: 50, deps: { run: lsRemote({ code: 124, stdout: "", stderr: "" }) } });
  assert.equal(slow.status, "unknown");
  assert.match(slow.error, /timed out after 50ms/);
});

test("TM-443: a manifest repository that looks like an option is never read as one", async (t) => {
  const { home, pluginRoot } = await cachedInstall(t);
  const marker = join(home, "MARKER");
  await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), { name: "agent-orchestration", repository: `--upload-pack=touch ${marker};` });
  const report = await pluginFreshness({ pluginRoot, home, timeoutMs: 10_000 }); // the real safe-git path, no seam
  assert.equal(report.status, "unknown");
  assert.equal(await stat(marker).then(() => true, () => false), false, "the repository value ran as --upload-pack");
});
