/**
 * TM-530: the hook wiring around uncommittedEntities(), run as a real `tm hook` process against a
 * real store in a git clone of a bare remote.
 *
 *   Stop          warns once per fingerprint, re-warns when the set changes, forgets the
 *                 fingerprint once the store is clean, and never warns on a stop the gate refused.
 *   SessionStart  names `tm doctor` errors, and says nothing for a healthy store.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, state, update, writeConfig, writeState } from "../../lib/store.mjs";

const TM = new URL("../../bin/tm", import.meta.url).pathname;
const SESSION = "stop-warn-session";
const trash = [];
after(() => cleanup(...trash));

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A store whose repo is a clone of a bare remote, with everything committed and pushed. */
function pushedStore() {
  const p = tempStore();
  trash.push(p.root);
  const remote = mkdtempSync(join(tmpdir(), "tm-stop-remote-"));
  trash.push(remote);
  git(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  git(p.root, "init", "--quiet", "--initial-branch=main");
  git(p.root, "config", "user.email", "t@example.com");
  git(p.root, "config", "user.name", "Test");
  git(p.root, "remote", "add", "origin", remote);
  git(p.root, "add", "-A");
  git(p.root, "commit", "--quiet", "-m", "seed");
  git(p.root, "push", "--quiet", "-u", "origin", "main");
  return p;
}

function childEnv() {
  // No TM_ROOT or CLAUDE_PROJECT_DIR and a foreign cwd: the store must come from the payload cwd,
  // which is the one the Stop gate reads (the warning once read the module-level store instead).
  const env = { ...process.env, TMUX: "" };
  for (const k of ["TM_ENFORCE", "TM_ROOT", "CLAUDE_PROJECT_DIR"]) delete env[k];
  return env;
}

function hook(p, event) {
  const r = spawnSync(process.execPath, [TM, "hook", event], {
    input: JSON.stringify({ cwd: p.root, session_id: SESSION }),
    cwd: tmpdir(),
    env: childEnv(),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

const warned = (r) => /store record\(s\)/.test(r.stderr);
const record = (p, name) => writeFileSync(join(p.base, "tasks", name), `# ${name}\n`);

describe("Stop: the uncommitted-record warning", () => {
  it("warns once per fingerprint and again when the set changes", () => {
    const p = pushedStore();
    assert.equal(warned(hook(p, "stop")), false, "precondition: a pushed store is quiet");

    record(p, "TM-901-a.md");
    const first = hook(p, "stop");
    assert.match(first.stderr, /1 store record\(s\) not on origin\/main/);
    assert.match(first.stderr, /TM-901-a\.md/);
    const fp = state(p).lastStoreWarn;
    assert.match(fp, /^[0-9a-f]{16}$/);

    assert.equal(warned(hook(p, "stop")), false, "the same set is reported once");

    record(p, "TM-902-b.md");
    const grown = hook(p, "stop");
    assert.match(grown.stderr, /2 store record\(s\)/);
    assert.notEqual(state(p).lastStoreWarn, fp);
  });

  it("forgets the fingerprint once clean, so the same set warns again", () => {
    const p = pushedStore();
    record(p, "TM-903-c.md");
    assert.equal(warned(hook(p, "stop")), true);
    const fp = state(p).lastStoreWarn;

    rmSync(join(p.base, "tasks", "TM-903-c.md"));
    assert.equal(warned(hook(p, "stop")), false);
    assert.equal(state(p).lastStoreWarn, null, "a clean store resets lastStoreWarn");

    record(p, "TM-903-c.md");
    assert.equal(warned(hook(p, "stop")), true, "without the reset this identical set would stay silent");
    assert.equal(state(p).lastStoreWarn, fp);
  });

  it("does not warn on a stop the gate blocked", () => {
    const p = pushedStore();
    writeConfig({ enforce: true }, p);
    const t = create("task", { title: "open work", status: "in_progress", session: SESSION }, "", p);
    writeState({ claims: { [t.id]: { session: SESSION, actor: "main", pid: 1, ts: new Date().toISOString() } } }, p);
    record(p, "TM-904-d.md");

    const r = hook(p, "stop");
    assert.match(r.stdout, /"decision":"block"/, "precondition: the gate refused this stop");
    assert.equal(warned(r), false, "one refusal per stop");
    assert.equal(state(p).lastStoreWarn ?? null, null, "a blocked stop records no fingerprint either");
  });

  it("says the remote may be stale when the fetch fails", () => {
    const p = pushedStore();
    git(p.root, "remote", "set-url", "origin", join(p.root, "no-such-remote.git"));
    record(p, "TM-905-e.md");
    const r = hook(p, "stop");
    assert.match(r.stderr, /1 store record\(s\) not on origin\/main \(fetch failed, so origin\/main may be stale: /);
  });
});

describe("SessionStart: tm doctor errors", () => {
  const doctorLine = (p) => {
    // The notice is for the person, so it rides systemMessage, not the model's context.
    const msg = JSON.parse(hook(p, "session-start").stdout).systemMessage || "";
    return msg.split("\n").find((l) => l.includes("`tm doctor` reports")) || null;
  };

  it("names the errors of an inconsistent store", () => {
    const p = tempStore();
    trash.push(p.root);
    const t = create("task", { title: "in a missing epic" }, "", p);
    update(t.id, { epic: "EP-999" }, p);
    assert.match(doctorLine(p), /`tm doctor` reports 1 error\(s\) \(orphan-epic\)/);
  });

  it("says nothing for a healthy store", () => {
    const p = tempStore();
    trash.push(p.root);
    create("task", { title: "fine" }, "", p);
    assert.equal(doctorLine(p), null);
  });
});
