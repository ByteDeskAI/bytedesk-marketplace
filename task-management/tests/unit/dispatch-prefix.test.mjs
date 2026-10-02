/**
 * TM-300 — tmux and manual workers get agent-orchestration's global prompts.prefix in front of
 * their handoff; the topology backend (which ao composes for) does not get it twice; a missing or
 * failing ao warns and never blocks. Every ao here is a fake script on PATH — the real
 * ~/.config/agent-orchestration is never read.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, readEvents, seedGitContract } from "../../lib/store.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { aoGlobalPrefix } from "../../lib/dispatch/prefix.mjs";

const trash = [];
after(() => cleanup(...trash));

/** A bin dir holding a fake `ao-topology` that prints `reply` and records its argv. */
function fakeAo(reply, { status = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tm-fake-ao-"));
  trash.push(dir);
  writeFileSync(join(dir, "reply.json"), typeof reply === "string" ? reply : JSON.stringify(reply));
  const bin = join(dir, "ao-topology");
  writeFileSync(bin, `#!/bin/sh\necho "$@" > '${dir}/argv'\ncat '${dir}/reply.json'\nexit ${status}\n`);
  chmodSync(bin, 0o755);
  return { dir, bin, argv: () => readFileSync(join(dir, "argv"), "utf8").trim() };
}

const layer = (dir, document) => ({ ok: true, scope: "global", path: join(dir, "config.json"), present: true, revision: "r", document });
const onPath = (dir) => ({ ...process.env, PATH: `${dir}:/usr/bin:/bin` });

describe("aoGlobalPrefix", () => {
  it("reads a path prefix relative to the global config file, via config get --scope global", () => {
    const ao = fakeAo("");
    writeFileSync(join(ao.dir, "prefix.md"), "Operator rule: be kind.\n");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify(layer(ao.dir, { prompts: { prefix: "prefix.md" } })));
    const got = aoGlobalPrefix({ env: onPath(ao.dir) });
    assert.deepEqual(got, { text: "Operator rule: be kind.", warning: null });
    assert.equal(ao.argv(), "config get --scope global --json");
  });

  it("takes inline {text} and {file} entries", () => {
    const ao = fakeAo("");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify(layer(ao.dir, { prompts: { prefix: { text: "inline rule" } } })));
    assert.equal(aoGlobalPrefix({ bin: ao.bin }).text, "inline rule");
    writeFileSync(join(ao.dir, "p2.md"), "from file");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify(layer(ao.dir, { prompts: { prefix: { file: join(ao.dir, "p2.md") } } })));
    assert.equal(aoGlobalPrefix({ bin: ao.bin }).text, "from file");
  });

  it("no prefix configured, or no global layer: nothing to add and nothing to warn about", () => {
    const ao = fakeAo({ ok: true, scope: "global", path: "/x/config.json", present: false, revision: "absent", document: null });
    assert.deepEqual(aoGlobalPrefix({ bin: ao.bin }), { text: null, warning: null });
  });

  it("ao not installed: a warning, no text", () => {
    const empty = mkdtempSync(join(tmpdir(), "tm-no-ao-"));
    trash.push(empty);
    const got = aoGlobalPrefix({ env: { ...process.env, PATH: empty } });
    assert.equal(got.text, null);
    assert.match(got.warning, /ao-topology is not installed/);
  });

  it("ao refuses: the warning carries ao's own message from stdout", () => {
    const ao = fakeAo({ ok: false, code: "X", message: "global config is not valid JSON" }, { status: 1 });
    assert.match(aoGlobalPrefix({ bin: ao.bin }).warning, /global config is not valid JSON/);
  });

  it("ao reports the global layer invalid: the prefix is not applied, and the warning says why", () => {
    const ao = fakeAo("");
    writeFileSync(join(ao.dir, "p.md"), "should not be used");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify({ ...layer(ao.dir, { prompts: { prefix: "p.md" }, bogus: 1 }), errors: ['config.json: unknown key "bogus"'] }));
    const got = aoGlobalPrefix({ bin: ao.bin });
    assert.equal(got.text, null);
    assert.match(got.warning, /global ao config is invalid: .*bogus/);
  });

  it("an unreadable prefix file: a warning naming the path", () => {
    const ao = fakeAo("");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify(layer(ao.dir, { prompts: { prefix: "gone.md" } })));
    assert.match(aoGlobalPrefix({ bin: ao.bin }).warning, /gone\.md: ENOENT/);
  });
});

describe("dispatch prepends the prefix for tmux and manual only", () => {
  function repoStore() {
    const root = tempRepo();
    trash.push(root);
    const p = paths(root);
    ensureDirs(p);
    seedGitContract(p);
    return p;
  }
  function backend(name) {
    const calls = [];
    return { name, calls, available: () => true, spawn: (req) => (calls.push(req), { ok: true, run: `${name}:1` }) };
  }
  function aoWithPrefix() {
    const ao = fakeAo("");
    writeFileSync(join(ao.dir, "reply.json"), JSON.stringify(layer(ao.dir, { prompts: { prefix: { text: "GLOBAL PREFIX" } } })));
    return ao;
  }

  for (const name of ["tmux", "manual"]) {
    it(`${name}: the worker's prompt starts with the prefix`, async () => {
      const p = repoStore();
      const t = create("task", { title: `prefix ${name}` }, "the body", p);
      const fake = backend(name);
      const ao = aoWithPrefix();
      const res = await dispatch(t.id, { backend: fake, session: "s1", p, caps: { backends: { topology: { path: ao.bin } } } });
      assert.equal(res.ok, true, res.reason);
      assert.ok(fake.calls[0].prompt.startsWith("GLOBAL PREFIX\n\n"), fake.calls[0].prompt.slice(0, 80));
      assert.match(fake.calls[0].prompt, new RegExp(t.id));
      assert.equal(res.prefixWarning, undefined);
    });
  }

  it("topology: ao composes the prefix itself, so dispatch never reads it", async () => {
    const p = repoStore();
    const t = create("task", { title: "prefix topology" }, "the body", p);
    const fake = backend("topology");
    let asked = 0;
    const res = await dispatch(t.id, { backend: fake, session: "s1", p, caps: {}, aoPrefix: () => (asked++, { text: "GLOBAL PREFIX", warning: null }) });
    assert.equal(res.ok, true, res.reason);
    assert.equal(asked, 0);
    assert.ok(!fake.calls[0].prompt.includes("GLOBAL PREFIX"));
  });

  it("ao missing: the dispatch still succeeds, with a recorded warning", async () => {
    const p = repoStore();
    const t = create("task", { title: "no ao" }, "the body", p);
    const fake = backend("tmux");
    const res = await dispatch(t.id, { backend: fake, session: "s1", p, caps: {} });
    assert.equal(res.ok, true, res.reason);
    assert.match(res.prefixWarning, /not installed/);
    assert.equal(fake.calls.length, 1);
    const ev = readEvents(p).find((e) => e.event === "dispatched" && e.id === t.id);
    assert.match(ev.prefixWarning, /not installed/);
  });
});
