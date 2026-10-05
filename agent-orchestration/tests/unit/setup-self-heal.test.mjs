// TM-284 / TM-285: the automatic setup keeps every host's ao copy on the services' build and
// cleans up after earlier installs. Everything runs in temp HOMEs with fake copies, a fake
// systemctl (a function recording argv), a fake process list and a fake lease probe. Nothing here
// lists, stops or signals a real unit or process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BUILD_META, copyIdentity, hostCopies, recordedOrdinal, refreshHostCopies, replaceCopy, satisfies, sourceOrdinal } from "../../src/services/host-copies.mjs";
import { cleanupScopes, handOverLegacyHost, parseEtime, selfHeal, staleMcpServers, tmuxSocketCheck } from "../../src/services/self-heal.mjs";
import { projectScopeWarning } from "../../src/services/project-scope.mjs";
import { healLines, sessionStartWarning } from "../../src/services/cli.mjs";
import { sessionSupervisorUnit } from "../../src/session/supervisor.mjs";
import { setupDiagnostics } from "../../src/diagnostics.mjs";
import { refreshCopies } from "../../skills/install-orchestration-host/scripts/install-host.mjs";

const pluginRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FP = (c) => c.repeat(64);
const DEPS = { nats: "^2.29.3", zod: "^4.4.3", acpx: "0.12.0" };

async function scratch(t, prefix) {
  const root = await mkdtemp(join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * A plugin copy: package.json, a bundle carrying `fingerprint`, a marker file, and node_modules.
 * `ordinal` writes the build metadata a refresh leaves behind (`metaFingerprint` to make it stale).
 */
async function makeCopy(dir, { version, fingerprint = FP("a"), ordinal, metaFingerprint = fingerprint, marker = version, modules = { nats: "2.29.3", zod: "4.4.3", acpx: "0.12.0" }, extra } = {}) {
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@bytedesk/agent-orchestration", version, dependencies: DEPS }));
  await writeFile(join(dir, "dist", "cli.cjs"), `const fp = false ? null : "${fingerprint}";\n`);
  if (ordinal) await writeFile(join(dir, BUILD_META), JSON.stringify({ fingerprint: metaFingerprint, ordinal }));
  await writeFile(join(dir, "MARKER"), marker);
  if (extra) await writeFile(join(dir, extra), "only in the old copy");
  for (const [name, v] of Object.entries(modules)) {
    await mkdir(join(dir, "node_modules", name), { recursive: true });
    await writeFile(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version: v }));
  }
  return dir;
}

/** codex (flat `local`), grok (registry path) and kimi (mcp.json command) copies under a temp HOME. */
async function fakeHome(root, versions) {
  const home = join(root, "home");
  const codex = join(home, ".codex", "plugins", "cache", "bytedesk", "agent-orchestration", "local");
  const grok = join(home, ".grok", "installed-plugins", "agent-orchestration-3e6932c4");
  const kimi = join(root, "kimi-root", "agent-orchestration");
  await makeCopy(codex, { version: versions.codex, extra: "STALE_ONLY" });
  await makeCopy(grok, { version: versions.grok });
  await makeCopy(kimi, { version: versions.kimi });
  await writeFile(join(home, ".grok", "installed-plugins", "registry.json"), JSON.stringify({ repos: { "agent-orchestration-3e6932c4": { path: grok, plugins: { "agent-orchestration": {} } }, other: { path: join(root, "x"), plugins: { other: {} } } } }));
  await mkdir(join(home, ".kimi-code"), { recursive: true });
  await writeFile(join(home, ".kimi-code", "mcp.json"), JSON.stringify({ mcpServers: { "agent-orchestration": { command: join(kimi, "bin", "agent-orchestration-mcp") }, keep: { command: "x" } } }));
  return { home, codex, grok, kimi };
}

async function snapshot(dir) {
  const out = {};
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[p.slice(dir.length)] = `${(await stat(p)).mtimeMs}:${await readFile(p, "utf8")}`;
    }
  };
  await walk(dir);
  return out;
}

const siblings = async (dir) => (await readdir(dirname(dir))).filter((n) => n.includes(".ao-refresh-"));
const gitIn = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

test("TM-284: hostCopies finds the codex, grok and kimi copies and nothing else", async (t) => {
  const root = await scratch(t, "ao-copies-find-");
  const { home, codex, grok, kimi } = await fakeHome(root, { codex: "0.13.0", grok: "0.13.0", kimi: "0.13.0" });
  const found = hostCopies({ home, env: {} });
  assert.deepEqual(found.map((c) => [c.host, c.root]), [["codex", codex], ["grok", grok], ["kimi", kimi]]);
});

/** Backdate a copy's bundle: the build time the same-version check compares. */
const builtAt = (dir, seconds) => utimes(join(dir, "dist", "cli.cjs"), seconds, seconds);

test("TM-284: an older copy is refreshed to the pointer's build; an equal or newer one is left alone", async (t) => {
  const root = await scratch(t, "ao-copies-refresh-");
  const source = await makeCopy(join(root, "claude-cache", "abc123"), { version: "0.14.0", fingerprint: FP("e"), marker: "NEW" });
  const { home, codex, grok, kimi } = await fakeHome(root, { codex: "0.13.0", grok: "0.14.0", kimi: "0.15.0" });
  await builtAt(grok, 1_000_000_000);
  const pointer = { pluginRoot: source, version: "0.14.0", fingerprint: FP("e") };
  const before = { kimi: await snapshot(kimi) };
  const report = await refreshHostCopies({ pointer, home, env: {} });
  const rows = [...report.refreshed, ...report.current, ...report.skipped, ...report.failed];
  assert.equal(rows.length, 3, "every detected copy is accounted for");

  // TM-299: grok is at the same version on an older build (the 2026-10-02 case) and IS refreshed.
  assert.deepEqual(report.refreshed.map((c) => [c.host, c.from, c.version, c.reason]), [["codex", "0.13.0", "0.14.0", undefined], ["grok", "0.14.0", "0.14.0", "same version, different build"]]);
  assert.equal(copyIdentity(grok).fingerprint, FP("e"));
  assert.equal(await readFile(join(grok, "MARKER"), "utf8"), "NEW");
  assert.ok(Math.abs((await stat(join(grok, "dist", "cli.cjs"))).mtimeMs - (await stat(join(source, "dist", "cli.cjs"))).mtimeMs) < 1, "the copy keeps the build's mtime");
  assert.equal(copyIdentity(codex).version, "0.14.0");
  assert.equal(copyIdentity(codex).fingerprint, FP("e"), "the refreshed copy reports the pointer's fingerprint");
  assert.equal(await readFile(join(codex, "MARKER"), "utf8"), "NEW");
  await assert.rejects(stat(join(codex, "STALE_ONLY")), { code: "ENOENT" }, "files the source does not have are deleted (rsync --delete)");
  assert.equal(JSON.parse(await readFile(join(codex, "node_modules", "nats", "package.json"), "utf8")).version, "2.29.3", "the copy keeps its own node_modules");
  assert.deepEqual(await siblings(codex), [], "no staging directory left behind");

  // Mutation check for refresh-only-if-older: the newer copy is byte-for-byte untouched.
  assert.deepEqual(report.current.map((c) => [c.host, c.reason]), [["kimi", "newer than the services (0.14.0)"]]);
  assert.deepEqual(await snapshot(kimi), before.kimi);

  // Fast path: a second run with everything current copies nothing and asks git nothing.
  let gitCalls = 0, replaced = 0;
  const again = await refreshHostCopies({ pointer, home, env: {}, git: () => { gitCalls += 1; return { status: 1, stdout: "" }; }, replace: async () => { replaced += 1; } });
  assert.equal(again.refreshed.length + again.skipped.length + again.failed.length, 0);
  assert.equal(again.current.length, 3);
  assert.deepEqual([gitCalls, replaced], [0, 0]);
});

test("TM-299: a same-version copy of a NEWER build is never downgraded; an unfingerprinted one is left alone", async (t) => {
  const root = await scratch(t, "ao-copies-newer-build-");
  const source = await makeCopy(join(root, "src", "agent-orchestration"), { version: "0.14.0", fingerprint: FP("e"), marker: "OLD-BUILD" });
  await builtAt(source, 1_000_000_000);
  const { home, codex, grok } = await fakeHome(root, { codex: "0.14.0", grok: "0.14.0", kimi: "0.14.0" });
  await writeFile(join(grok, "dist", "cli.cjs"), "no fingerprint here\n");
  const before = { codex: await snapshot(codex), grok: await snapshot(grok) };
  const report = await refreshHostCopies({ pointer: { pluginRoot: source, version: "0.14.0", fingerprint: FP("e") }, home, env: {} });
  assert.deepEqual(report.refreshed, []);
  assert.deepEqual(report.current.map((c) => [c.host, c.reason]), [["codex", "same version, newer build than the services"], ["grok", "same build"], ["kimi", "same version, newer build than the services"]]);
  assert.deepEqual(await snapshot(codex), before.codex);
  assert.deepEqual(await snapshot(grok), before.grok);

  // Mutation check: the same copies with the source rebuilt later ARE refreshed — the refusal is the build time.
  await builtAt(source, Date.now() / 1000 + 60);
  const later = await refreshHostCopies({ pointer: { pluginRoot: source, version: "0.14.0", fingerprint: FP("e") }, home, env: {} });
  assert.deepEqual(later.refreshed.map((c) => c.host), ["codex", "kimi"]);
  assert.equal(await readFile(join(codex, "MARKER"), "utf8"), "OLD-BUILD");
});

test("TM-299: same-version builds are ordered by the ordinal recorded at sync; mtime only for a copy without one", async (t) => {
  const root = await scratch(t, "ao-copies-ordinal-");
  const home = join(root, "home");
  const source = await makeCopy(join(root, "src", "agent-orchestration"), { version: "0.14.0", fingerprint: FP("e"), marker: "SOURCE" });
  await builtAt(source, 1_500_000_000);
  // The source's ordinal is its commit time, asked of git at sync time; nothing is a checkout.
  const asked = [];
  const git = (args) => { asked.push(args.slice(2).join(" ")); return args[2] === "log" ? { status: 0, stdout: "2000\n" } : { status: 128, stdout: "" }; };
  const at = (name) => join(root, "copies", name);
  // An older build installed later (its mtime is newer than the source's): refreshed.
  const olderLater = await makeCopy(at("older-installed-later"), { version: "0.14.0", ordinal: 1000 });
  await builtAt(olderLater, 1_900_000_000);
  // A newer build whose bundle mtime is older: never overwritten.
  const newerEarlier = await makeCopy(at("newer-older-mtime"), { version: "0.14.0", ordinal: 3000 });
  await builtAt(newerEarlier, 1_000_000_000);
  // Equal ordinal, different fingerprint: cannot be ordered, so it is kept.
  const equal = await makeCopy(at("equal"), { version: "0.14.0", ordinal: 2000 });
  // No metadata (an old install): the mtime decides, both ways.
  const bareOld = await makeCopy(at("no-ordinal-old"), { version: "0.14.0" });
  await builtAt(bareOld, 1_000_000_000);
  const bareNew = await makeCopy(at("no-ordinal-new"), { version: "0.14.0" });
  await builtAt(bareNew, 1_900_000_000);
  // Metadata written for another build (the copy was replaced by other means): ignored, mtime decides.
  const stale = await makeCopy(at("stale-meta"), { version: "0.14.0", ordinal: 9999, metaFingerprint: FP("f") });
  await builtAt(stale, 1_000_000_000);
  const copies = [olderLater, newerEarlier, equal, bareOld, bareNew, stale].map((dir) => ({ host: basename(dir), root: dir, real: dir }));
  const kept = { newerEarlier: await snapshot(newerEarlier), equal: await snapshot(equal), bareNew: await snapshot(bareNew) };

  assert.equal(recordedOrdinal(olderLater, FP("a")), 1000);
  assert.equal(recordedOrdinal(bareOld, FP("a")), null);
  assert.equal(recordedOrdinal(stale, FP("a")), null);
  const pointer = { pluginRoot: source, version: "0.14.0", fingerprint: FP("e") };
  const report = await refreshHostCopies({ pointer, home, env: {}, copies, git });
  assert.deepEqual(report.refreshed.map((c) => [c.host, c.reason]), [["older-installed-later", "same version, different build"], ["no-ordinal-old", "same version, different build"], ["stale-meta", "same version, different build"]]);
  assert.deepEqual(report.current.map((c) => [c.host, c.reason]), [
    ["newer-older-mtime", "same version, newer build than the services"],
    ["equal", "same version and build ordinal, different build; not overwritten"],
    ["no-ordinal-new", "same version, newer build than the services"],
  ]);
  assert.equal(asked.filter((a) => a.startsWith("log")).length, 1, "the source's commit time is read once per sync");
  // Every refreshed copy records the build it now holds and where from; the source tree gains nothing.
  for (const dir of [olderLater, bareOld, stale]) assert.deepEqual(JSON.parse(await readFile(join(dir, BUILD_META), "utf8")), { fingerprint: FP("e"), ordinal: 2000, source });
  await assert.rejects(stat(join(source, BUILD_META)), { code: "ENOENT" });
  assert.equal(await readFile(join(bareOld, "MARKER"), "utf8"), "SOURCE");
  assert.deepEqual(await snapshot(newerEarlier), kept.newerEarlier);
  assert.deepEqual(await snapshot(equal), kept.equal);
  assert.deepEqual(await snapshot(bareNew), kept.bareNew);
});

test("TM-299: outside git the source's ordinal is the newest mtime under dist/", async (t) => {
  const root = await scratch(t, "ao-copies-ordinal-nogit-");
  const source = await makeCopy(join(root, "src"), { version: "0.14.0", fingerprint: FP("e") });
  await builtAt(source, 1_500_000_000);
  await writeFile(join(source, "dist", "mcp.cjs"), "x");
  await utimes(join(source, "dist", "mcp.cjs"), 1_600_000_000, 1_600_000_000);
  const notGit = () => ({ status: 128, stdout: "" });
  assert.equal(sourceOrdinal(source, FP("e"), notGit), 1_600_000_000);
  // A source that is itself a refreshed copy reports what its refresh recorded.
  await writeFile(join(source, BUILD_META), JSON.stringify({ fingerprint: FP("e"), ordinal: 1234 }));
  assert.equal(sourceOrdinal(source, FP("e"), notGit), 1234);
  // Git wins when it answers.
  assert.equal(sourceOrdinal(source, FP("e"), () => ({ status: 0, stdout: "1790976723\n" })), 1790976723);
});

test("TM-284: a copy whose node_modules does not satisfy the new package.json is reported and left whole", async (t) => {
  const root = await scratch(t, "ao-copies-deps-");
  const source = await makeCopy(join(root, "src", "agent-orchestration"), { version: "0.14.0" });
  const old = await makeCopy(join(root, "home", ".codex", "plugins", "cache", "bytedesk", "agent-orchestration", "local"), { version: "0.13.0", modules: { nats: "2.29.3", zod: "3.25.0" } });
  const before = await snapshot(old);
  const report = await refreshHostCopies({ pointer: { pluginRoot: source, version: "0.14.0" }, home: join(root, "home"), env: {} });
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason, /zod@\^4\.4\.3 \(have 3\.25\.0\)/);
  assert.match(report.failed[0].reason, /acpx@0\.12\.0 \(have none\)/);
  assert.deepEqual(await snapshot(old), before, "nothing was written");
  assert.deepEqual(await siblings(old), []);
});

test("TM-284: a copy that fails half-way is rolled back, never left half-updated", { skip: process.getuid?.() === 0 && "root reads unreadable files" }, async (t) => {
  const root = await scratch(t, "ao-copies-fail-");
  const source = await makeCopy(join(root, "src"), { version: "0.14.0" });
  await writeFile(join(source, "dist", "zz-unreadable.cjs"), "x");
  await chmod(join(source, "dist", "zz-unreadable.cjs"), 0o000);
  t.after(() => chmod(join(source, "dist", "zz-unreadable.cjs"), 0o644).catch(() => {}));
  const dest = await makeCopy(join(root, "dest"), { version: "0.13.0" });
  const before = await snapshot(dest);
  await assert.rejects(replaceCopy(source, dest), { code: "EACCES" });
  assert.deepEqual(await snapshot(dest), before);
  assert.deepEqual(await siblings(dest), []);
});

test("TM-284: never copies from a source tree with uncommitted changes, and never writes into a git checkout", async (t) => {
  const root = await scratch(t, "ao-copies-dirty-");
  const repo = join(root, "marketplace");
  const source = await makeCopy(join(repo, "agent-orchestration"), { version: "0.14.0" });
  await writeFile(join(repo, ".gitignore"), "node_modules/\n");
  assert.equal(gitIn(repo, "init", "-q").status, 0);
  gitIn(repo, "add", "-A");
  assert.equal(gitIn(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base").status, 0);
  const home = join(root, "home");
  const dest = await makeCopy(join(home, ".codex", "plugins", "cache", "bytedesk", "agent-orchestration", "local"), { version: "0.13.0" });
  const before = await snapshot(dest);
  await writeFile(join(source, "MARKER"), "uncommitted edit");
  const pointer = { pluginRoot: source, version: "0.14.0" };
  const dirty = await refreshHostCopies({ pointer, home, env: {} });
  assert.equal(dirty.skipped.length, 1);
  assert.match(dirty.skipped[0].reason, /uncommitted change/);
  assert.deepEqual(await snapshot(dest), before, "a dirty source copies nothing");

  // Mutation check: the same tree, committed, IS copied — the refusal is about the dirt, not the repo.
  gitIn(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "edit");
  const clean = await refreshHostCopies({ pointer, home, env: {} });
  assert.deepEqual(clean.refreshed.map((c) => c.version), ["0.14.0"]);
  assert.equal(await readFile(join(dest, "MARKER"), "utf8"), "uncommitted edit");

  // A destination inside a git checkout (Kimi pointing at someone's working tree) is never written.
  const kimiRepo = join(root, "kimi-checkout");
  const kimiRoot = await makeCopy(join(kimiRepo, "agent-orchestration"), { version: "0.13.0" });
  gitIn(kimiRepo, "init", "-q");
  const kimiBefore = await snapshot(kimiRoot);
  const kimi = await refreshHostCopies({ pointer, home, env: {}, copies: [{ host: "kimi", root: kimiRoot, real: kimiRoot }] });
  assert.match(kimi.skipped[0]?.reason ?? "", /inside a git checkout/);
  assert.deepEqual(await snapshot(kimiRoot), kimiBefore);
});

test("TM-284: install-host refreshes older copies from its plugin root (dry run reports only)", async (t) => {
  const root = await scratch(t, "ao-copies-install-");
  const source = await makeCopy(join(root, "plugin"), { version: "0.14.0", marker: "NEW" });
  const { home, codex } = await fakeHome(root, { codex: "0.13.0", grok: "0.14.0", kimi: "0.14.0" });
  const dry = await refreshCopies({ pluginRoot: source, home, dryRun: true, env: {} });
  assert.deepEqual(dry.refreshed.map((c) => [c.host, c.dryRun]), [["codex", true]]);
  assert.equal(copyIdentity(codex).version, "0.13.0", "a dry run writes nothing");
  const real = await refreshCopies({ pluginRoot: source, home, env: {} });
  assert.deepEqual(real.refreshed.map((c) => c.host), ["codex"]);
  assert.equal(await readFile(join(codex, "MARKER"), "utf8"), "NEW");
});

test("TM-284: satisfies covers the range forms package.json uses", () => {
  const cases = [["0.12.0", "0.12.0", true], ["0.12.0", "0.12.1", false], ["^1.29.0", "1.30.2", true], ["^1.29.0", "2.0.0", false], ["^1.29.0", "1.28.9", false],
    ["^0.12.0", "0.12.5", true], ["^0.12.0", "0.13.0", false], ["~4.4.3", "4.4.9", true], ["~4.4.3", "4.5.0", false], [">=2.0.0", "3.1.0", true], ["^4.4.3", null, false]];
  assert.equal(cases.length, 11);
  for (const [range, version, want] of cases) assert.equal(satisfies(range, version), want, `${range} vs ${version}`);
});

test("TM-285: stale MCP servers are listed by host and pid with restart advice, and nothing is signalled", async (t) => {
  const root = await scratch(t, "ao-stale-");
  const current = await makeCopy(join(root, "current", "agent-orchestration"), { version: "0.14.0" });
  const older = await makeCopy(join(root, "home", ".grok", "installed-plugins", "agent-orchestration-1"), { version: "0.11.0" });
  const replaced = await makeCopy(join(root, "home", ".codex", "plugins", "cache", "bytedesk", "agent-orchestration", "local"), { version: "0.14.0" });
  await writeFile(join(current, "dist", "mcp.cjs"), ""); await writeFile(join(older, "dist", "mcp.cjs"), ""); await writeFile(join(replaced, "dist", "mcp.cjs"), "");
  const now = Date.now();
  const servers = [
    { pid: 11, startedAt: now + 60_000, root: current },
    { pid: 22, startedAt: now + 60_000, root: older },
    { pid: 33, startedAt: now - 3_600_000, root: replaced },
    { pid: 44, startedAt: now, root: join(root, "gone", "agent-orchestration") },
  ];
  let listed = 0;
  const report = await staleMcpServers({ pointer: { version: "0.14.0" }, platform: "linux", list: async () => { listed += 1; return servers; } });
  assert.equal(listed, 1);
  assert.equal(report.scanned, 4);
  assert.deepEqual(report.servers.map((s) => [s.pid, s.host]), [[22, "grok"], [33, "codex"], [44, "source checkout"]]);
  assert.match(report.servers[0].reasons[0], /runs 0\.11\.0, the services run 0\.14\.0/);
  assert.match(report.servers[1].reasons[0], /replaced on disk/);
  assert.match(report.servers[2].reasons[0], /plugin root is gone/);
  for (const s of report.servers) assert.match(s.advice, /Restart that .* session.*never stops it/);
  const win = await staleMcpServers({ pointer: { version: "0.14.0" }, platform: "win32" });
  assert.equal(win.supported, false);
  assert.deepEqual([parseEtime("05:07"), parseEtime("1-02:03:04")], [307_000, 93_784_000]);
});

/** A systemctl stand-in: records argv, answers list-units with `units`. */
function fakeSystemctl(units) {
  const calls = [];
  const fn = async (mode, args) => {
    assert.equal(mode, "systemd");
    calls.push(args);
    if (args.includes("list-units")) return { stdout: units.map((u) => `${u} loaded active running session host`).join("\n") };
    return { stdout: "" };
  };
  return { calls, fn };
}

test("TM-285: leaked scopes whose state root is gone are stopped; one whose root exists is never touched", async (t) => {
  const root = await scratch(t, "ao-scopes-");
  const managedRoot = join(root, "state"), otherRoot = join(root, "other-state"), goneRoot = join(root, "tmp-run-123");
  await mkdir(managedRoot); await mkdir(otherRoot);
  const units = {
    managed: sessionSupervisorUnit(managedRoot),
    other: sessionSupervisorUnit(otherRoot),
    gone: sessionSupervisorUnit(goneRoot),
    lying: sessionSupervisorUnit(join(root, "lying")),
    unreadable: sessionSupervisorUnit(join(root, "unreadable")),
  };
  const roots = { [units.other]: otherRoot, [units.gone]: goneRoot, [units.lying]: join(root, "something-else"), [units.unreadable]: null };
  const systemctl = fakeSystemctl([...Object.values(units), "unrelated.scope", "agent-orchestration-session-NOTHEX.scope"]);
  const report = await cleanupScopes({ stateRoot: managedRoot, platform: "linux", env: {}, run: systemctl.fn, readStateRoot: async (unit) => roots[unit] });
  assert.equal(report.stopped.length + report.kept.length, 5, "every well-formed ao scope is accounted for");
  assert.deepEqual(report.stopped.map((s) => s.unit).sort(), [units.gone, units.managed].sort());
  const stops = systemctl.calls.filter((a) => a.includes("stop")).map((a) => a.at(-1));
  assert.deepEqual(stops.sort(), [units.gone, units.managed].sort(), "systemctl stop ran for exactly those units");
  // Mutation check: the scope whose state root exists and is not the managed one is never stopped.
  assert.ok(!stops.includes(units.other));
  assert.match(report.kept.find((k) => k.unit === units.other).reason, /exists and is not the managed one/);
  assert.match(report.kept.find((k) => k.unit === units.lying).reason, /does not hash/);
  assert.match(report.kept.find((k) => k.unit === units.unreadable).reason, /could not be read/);

  const optedOut = fakeSystemctl([units.managed]);
  const kept = await cleanupScopes({ stateRoot: managedRoot, platform: "linux", env: { AGENT_ORCHESTRATION_SERVICES: "0" }, run: optedOut.fn, readStateRoot: async () => null });
  assert.deepEqual([kept.stopped.length, optedOut.calls.filter((a) => a.includes("stop")).length], [0, 0], "with the services opted out, the managed root's scope IS the host");
  assert.equal((await cleanupScopes({ stateRoot: managedRoot, platform: "darwin", run: () => assert.fail("no systemctl on macOS") })).stopped.length, 0);
});

test("TM-285: a hand-run session host on the managed state root is handed over; anything else is left alone", async () => {
  const stateRoot = "/state/root";
  const kills = [];
  const base = { stateRoot, platform: "linux", env: {}, probe: async () => ({ pid: 4242 }), kill: (pid, sig) => kills.push([pid, sig]) };
  const legacyArgv = ["node", "/x/dist/cli.cjs", "session-host", "--state-root", stateRoot];
  assert.equal((await handOverLegacyHost({ ...base, argvOf: () => legacyArgv, environOf: () => ["PATH=/bin"] })).action, "stopped");
  assert.deepEqual(kills, [[4242, "SIGTERM"]]);
  const untouched = [
    { argvOf: () => legacyArgv, environOf: () => ["AGENT_ORCHESTRATION_SERVICES_MANAGED=1"] },
    { argvOf: () => ["node", "/x/dist/cli.cjs", "session-host", "--state-root", "/another/root"], environOf: () => [] },
    { argvOf: () => ["node", "/x/dist/mcp.cjs"], environOf: () => [] },
    { argvOf: () => null, environOf: () => null },
    { argvOf: () => legacyArgv, environOf: () => [], env: { AGENT_ORCHESTRATION_SERVICES: "0" } },
    { argvOf: () => legacyArgv, environOf: () => [], probe: async () => null },
  ];
  for (const variant of untouched) assert.equal((await handOverLegacyHost({ ...base, ...variant })).action, "none");
  assert.equal(kills.length, 1, "only the verified legacy host was signalled");
});

test("TM-285: SessionStart warns with the exact fix when the repo enables an ao/bytedesk plugin at project scope — the guard's own predicate", async (t) => {
  const root = await scratch(t, "ao-project-scope-");
  const repo = join(root, "repo");
  await mkdir(join(repo, ".claude"), { recursive: true });
  await mkdir(join(repo, "sub", "dir"), { recursive: true });
  gitIn(repo, "init", "-q");
  const settings = join(repo, ".claude", "settings.json");
  await writeFile(settings, JSON.stringify({ enabledPlugins: { "agent-orchestration@bytedesk": true, "other@elsewhere": true } }));
  const warning = sessionStartWarning(join(repo, "sub", "dir"));
  assert.ok(warning, "a subdirectory of the repo still finds the repo's settings");
  assert.ok(warning.includes(settings));
  assert.ok(warning.includes('delete "agent-orchestration@bytedesk": true from "enabledPlugins"'));
  const guard = spawnSync(process.execPath, [join(pluginRoot, "scripts", "check-no-project-plugin-installs.mjs"), repo], { encoding: "utf8" });
  assert.equal(guard.status, 1, "the commit guard blocks the same repository");

  assert.match(warning, /AGENTS\.md/, "the warning names the rule");

  // TM-370: the AGENTS.md-mandated form (relative-path marketplace + enabledPlugins) is not an install.
  const market = (path) => ({ bytedesk: { source: { source: "directory", path } } });
  await writeFile(settings, JSON.stringify({ extraKnownMarketplaces: market("../bytedesk-marketplace"), enabledPlugins: { "agent-orchestration@bytedesk": true } }));
  assert.equal(sessionStartWarning(repo), null);
  assert.equal(spawnSync(process.execPath, [join(pluginRoot, "scripts", "check-no-project-plugin-installs.mjs"), repo]).status, 0, "the guard allows the mandated declaration");
  await writeFile(settings, JSON.stringify({ extraKnownMarketplaces: market("/home/x/bytedesk-marketplace"), enabledPlugins: { "agent-orchestration@bytedesk": true } }));
  assert.match(sessionStartWarning(repo) ?? "", /machine-specific path/, "an absolute marketplace path is still an install");

  await writeFile(settings, JSON.stringify({ enabledPlugins: { "agent-orchestration@bytedesk": false, "other@elsewhere": true } }));
  assert.equal(sessionStartWarning(repo), null);
  assert.equal(spawnSync(process.execPath, [join(pluginRoot, "scripts", "check-no-project-plugin-installs.mjs"), repo]).status, 0, "and passes it once the fix is applied");
  await writeFile(settings, "{ not json");
  assert.equal(projectScopeWarning(repo), null, "unreadable settings never break SessionStart");
});

test("TM-285: doctor flags a TMUX_TMPDIR whose socket path exceeds the unix-socket limit", async (t) => {
  const long = `/tmp/${"x".repeat(90)}`;
  const linux = tmuxSocketCheck({ env: { TMUX_TMPDIR: long }, platform: "linux", uid: 1000 });
  assert.equal(linux.ok, false);
  assert.ok(linux.bytes > linux.limit);
  assert.match(linux.problem, /File name too long/);
  assert.equal(tmuxSocketCheck({ env: {}, platform: "linux", uid: 1000 }).ok, true);
  // 104 on macOS: a path that fits Linux's 108 but not macOS's limit.
  const edge = `/${"y".repeat(105 - "/tmux-1000/default".length - 2)}`;
  assert.deepEqual([tmuxSocketCheck({ env: { TMUX_TMPDIR: edge }, platform: "linux", uid: 1000 }).ok, tmuxSocketCheck({ env: { TMUX_TMPDIR: edge }, platform: "darwin", uid: 1000 }).ok], [true, false]);

  const root = await scratch(t, "ao-doctor-setup-");
  const report = await setupDiagnostics({ stateRoot: join(root, "state"), env: { TMUX_TMPDIR: long, AGENT_ORCHESTRATION_DATA_HOME: join(root, "data") }, home: root, platform: "linux",
    deps: { staleMcpServers: async () => ({ supported: true, servers: [{ host: "codex", pid: 7, reasons: ["runs 0.11.0"], advice: "Restart that codex session." }] }) } });
  assert.equal(report.problems.length, 2);
  assert.match(report.problems[0], /codex pid 7/);
  assert.match(report.problems[1], /TMUX_TMPDIR/);
});

test("TM-284/285: one ensure's self-heal reports every part, and a failing part never fails the rest", async () => {
  const heal = await selfHeal({ pointer: { pluginRoot: "/p", version: "0.14.0" }, stateRoot: "/s", home: "/h", env: {}, platform: "linux", deps: {
    refreshHostCopies: async () => ({ refreshed: [{ host: "codex", root: "/c", from: "0.13.0", version: "0.14.0" }], current: [], skipped: [], failed: [{ host: "grok", root: "/g", version: "0.11.0", reason: "node_modules does not satisfy" }] }),
    cleanupScopes: async () => { throw new Error("bus down"); },
    handOverLegacyHost: async () => ({ action: "stopped", pid: 9 }),
    staleMcpServers: async () => ({ supported: true, servers: [{ host: "grok", pid: 5, reasons: ["old"], advice: "Restart that grok session." }] }),
  } });
  assert.equal(heal.scopes.error, "bus down");
  const lines = healLines(heal);
  for (const expected of [/refreshed codex copy \/c: 0\.13\.0 -> 0\.14\.0/, /not refreshed grok copy/, /legacy session host pid 9/, /stale ao MCP server: grok pid 5/, /self-heal scopes failed: bus down/]) {
    assert.ok(lines.some((line) => expected.test(line)), String(expected));
  }
  assert.deepEqual(healLines({ hostCopies: { refreshed: [], current: [{}], skipped: [], failed: [] }, scopes: { stopped: [], kept: [] }, legacyHost: { action: "none" }, staleMcpServers: { servers: [] }, tmuxSocket: { ok: true } }), [], "nothing to say when all is current");
});
