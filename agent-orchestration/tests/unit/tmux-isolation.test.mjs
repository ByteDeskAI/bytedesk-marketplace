// TM-281: the suite must not be able to reach the operator's tmux server. These pin the guard
// itself — the preflight every test script loads, and the helper every real-tmux test uses.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { implicitSocket, isolatedTmux, killOwnedServer, operatorSockets, refuseOperatorSocket } from "../helpers/isolated-tmux.mjs";

const execFile = promisify(execFileCallback);
const preflight = fileURLToPath(new URL("../helpers/tmux-preflight.mjs", import.meta.url));
const uid = process.getuid?.() ?? 0;
const DEFAULT = `/tmp/tmux-${uid}/default`;
const haveTmux = await execFile("tmux", ["-V"]).then(() => true, () => false);

test("the suite runs with TMUX blank and a bare tmux resolving away from the operator's socket", () => {
  // Fails if a test script is started without the preflight (package.json, run-tests.sh, stability.mjs).
  assert.equal(process.env.TMUX, "", "the preflight did not run: TMUX is inherited");
  assert.ok(process.env.TMUX_TMPDIR, "the preflight did not run: TMUX_TMPDIR is unset");
  assert.doesNotThrow(() => refuseOperatorSocket(implicitSocket(process.env)));
  assert.notEqual(implicitSocket(process.env), DEFAULT);
});

test("the helper refuses the operator's default socket, however it is spelled", () => {
  assert.throws(() => refuseOperatorSocket(DEFAULT), /operator's tmux socket/);
  assert.throws(() => refuseOperatorSocket(`/tmp/tmux-${uid}/../tmux-${uid}/default`), /operator's tmux socket/, "a .. must not hide it");
  assert.throws(() => refuseOperatorSocket(""), /empty tmux socket/, "an empty socket means a bare tmux, which resolves implicitly");
  // TMUX_TMPDIR unset is exactly the INCIDENT shape: the implicit socket IS the default one.
  assert.throws(() => refuseOperatorSocket(implicitSocket({})), /operator's tmux socket/);
  assert.throws(() => refuseOperatorSocket(implicitSocket({ TMUX_TMPDIR: "/tmp" })), /operator's tmux socket/);
});

test("the helper refuses the server the suite was started from, recorded or still in TMUX", () => {
  const live = "/tmp/some-operator-dir/tmux-1000/work";
  assert.throws(() => refuseOperatorSocket(live, { AO_TEST_OPERATOR_TMUX_SOCKET: live }), /operator's tmux socket/);
  assert.throws(() => refuseOperatorSocket(live, { TMUX: `${live},4242,0` }), /operator's tmux socket/);
  assert.ok(operatorSockets({ TMUX: `${live},4242,0` }).includes(live));
  // And an inherited TMUX is what a bare tmux would follow, ahead of any TMUX_TMPDIR.
  assert.equal(implicitSocket({ TMUX: `${live},4242,0`, TMUX_TMPDIR: "/tmp/aot-x" }), live);
});

test("killOwnedServer refuses before running tmux at all", async () => {
  // Record the argv a refusal would have run, rather than asserting a bit both outcomes share.
  const dir = mkdtempSync(join(tmpdir(), "aot-shim-"));
  try {
    const log = join(dir, "argv");
    writeFileSync(join(dir, "tmux"), `#!/bin/sh\necho "$@" >> ${log}\n`, { mode: 0o755 });
    const PATH = `${dir}:${process.env.PATH}`;
    await assert.rejects(killOwnedServer({ PATH, TMUX: "", TMUX_TMPDIR: "/tmp" }, DEFAULT), /operator's tmux socket/);
    await assert.rejects(killOwnedServer({ PATH, TMUX: "", TMUX_TMPDIR: dir }, "/tmp/elsewhere/s"), /outside this test's TMUX_TMPDIR/);
    await assert.rejects(killOwnedServer({ PATH, TMUX: `${DEFAULT},1,0`, TMUX_TMPDIR: dir }, join(dir, "s")), /outside this test's TMUX_TMPDIR/);
    assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "nothing", "nothing", "a refused kill must not reach tmux");
    // The positive control: the same shim DOES run for a socket the test owns, so "nothing" above
    // is a refusal and not a shim that never runs.
    await killOwnedServer({ PATH, TMUX: "", TMUX_TMPDIR: dir }, join(dir, "s"));
    assert.equal(readFileSync(log, "utf8").trim(), `-S ${join(dir, "s")} kill-server`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the preflight blanks TMUX, records the operator's socket, and replaces an unset or /tmp TMUX_TMPDIR", async () => {
  const read = "console.log(JSON.stringify({ TMUX: process.env.TMUX, TMUX_TMPDIR: process.env.TMUX_TMPDIR, op: process.env.AO_TEST_OPERATOR_TMUX_SOCKET }))";
  const base = { ...process.env, AO_TEST_OPERATOR_TMUX_SOCKET: "" };
  for (const tmpdirValue of [undefined, "/tmp", "/tmp/"]) {
    const env = { ...base, TMUX: `${DEFAULT},4242,0` };
    if (tmpdirValue === undefined) delete env.TMUX_TMPDIR; else env.TMUX_TMPDIR = tmpdirValue;
    const { stdout } = await execFile(process.execPath, ["--import", preflight, "-e", read], { env });
    const seen = JSON.parse(stdout);
    assert.equal(seen.TMUX, "", `TMUX must be blank (TMUX_TMPDIR=${tmpdirValue})`);
    assert.equal(seen.op, DEFAULT, "the operator's socket is remembered so children can refuse it");
    assert.match(seen.TMUX_TMPDIR, /^\/tmp\/aot-run-/, `an unsafe TMUX_TMPDIR (${tmpdirValue}) is replaced`);
  }
  // A private TMUX_TMPDIR someone already chose is kept.
  const chosen = mkdtempSync("/tmp/aot-keep-");
  try {
    const { stdout } = await execFile(process.execPath, ["--import", preflight, "-e", read], { env: { ...base, TMUX: "", TMUX_TMPDIR: chosen } });
    assert.equal(JSON.parse(stdout).TMUX_TMPDIR, chosen);
  } finally { rmSync(chosen, { recursive: true, force: true }); }
});

test("an isolated server is reachable three ways and the teardown removes it", { skip: haveTmux ? false : "no tmux" }, async () => {
  const iso = isolatedTmux(null);
  try {
    assert.match(iso.socket, /^\/tmp\/aot-[^/]+\/tmux-\d+\/default$/);
    assert.ok(iso.socket.length < 108, "a unix socket path is capped at 108 bytes");
    assert.equal(iso.env.TMUX, "");
    await iso.tmux(["new-session", "-d", "-s", "probe", "sleep", "30"]);
    // An implicit tmux under the helper's env, and a library call under within(), reach the same server.
    const implicit = (await execFile("tmux", ["display-message", "-p", "-t", "probe", "#{socket_path}"], { env: iso.env })).stdout.trim();
    assert.equal(implicit, iso.socket);
    const listed = await iso.within(async () => (await import("../../topology/lib/tmux.mjs")).hasSession("probe"));
    assert.equal(listed, true);
  } finally { await iso.teardown(); }
  assert.equal(existsSync(iso.dir), false, "the teardown removes the directory");
  await assert.rejects(execFile("tmux", ["-S", iso.socket, "has-session"]), "and the server is gone");
});
