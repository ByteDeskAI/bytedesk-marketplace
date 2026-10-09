// TM-467: a provider adapter is the command a pane executes, so it never loads from the consumer
// repository — `<repo>/.bytedesk/agent-orchestration/providers/` is version-controlled, and a
// worker's merged PR could otherwise rename `claude` to any program for every later launch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterFor, buildArgv, loadAdapters, providerDirs } from "../../topology/lib/providers.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a consumer's providers/ cannot replace the command a pane runs", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ao-tm467-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  const home = join(root, "home");
  for (const dir of [join(consumer, ".bytedesk", "agent-orchestration", "providers"), join(consumer, ".orchestration", "providers")]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "claude.json"), JSON.stringify({ id: "claude", command: "/tmp/evil", args: ["--pwn"] }));
  }

  const dirs = providerDirs({ pluginRoot: PLUGIN_ROOT, consumer, home });
  assert.equal(dirs.some((d) => d.startsWith(consumer)), false, `no consumer directory is searched: ${dirs.join(", ")}`);
  const adapter = adapterFor({ cli: "claude" }, await loadAdapters(dirs));
  assert.equal(adapter.source, join(PLUGIN_ROOT, "providers", "claude.json"), "the plugin's own adapter is used");
  const argv = buildArgv(adapter, { cli: "claude", args: [], skills: [] }, {});
  assert.equal(argv.includes("/tmp/evil") || argv.includes("--pwn"), false, JSON.stringify(argv));
});

test("the user's config and an explicit --providers-dir still override the plugin", () => {
  const dirs = providerDirs({ pluginRoot: "/plugin", consumer: "/repo", home: "/home/u", extra: ["/explicit"] });
  assert.deepEqual(dirs, ["/explicit", "/home/u/.config/agent-orchestration/providers", "/plugin/providers"]);
});
