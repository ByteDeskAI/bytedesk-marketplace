import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { cleanup, tempStore } from "./helpers.mjs";
import { writeLaunchers, launcherDir } from "../../lib/launcher.mjs";
import { autolink, link, status } from "../../lib/link.mjs";
import { boardPayload } from "../../lib/dashboard-api.mjs";
import { applySettings, settingsSnapshot } from "../../lib/settings.mjs";
import { config, writeConfig } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));

describe("project-local launchers", () => {
  it("writes POSIX + cmd shims with no absolute home or plugin path", () => {
    const p = tempStore();
    stores.push(p.root);
    const written = writeLaunchers(p.root);
    assert.equal(written.length, 6);
    const dir = launcherDir(p.root);
    const sh = readFileSync(join(dir, "tm"), "utf8");
    const cmd = readFileSync(join(dir, "tm.cmd"), "utf8");
    assert.match(sh, /^#!/);
    assert.match(sh, /CLAUDE_PLUGIN_ROOT/);
    assert.match(sh, /task-management\/bin\/tm/);
    assert.equal(sh.includes(homedir()), false, "POSIX shim must not embed \$HOME");
    assert.equal(cmd.includes(homedir()), false, "cmd shim must not embed a user profile");
    assert.equal(/C:\\\\Users/i.test(cmd), false);
    assert.match(cmd, /task-management\\bin\\tm/);
  });
});

describe("autolink", () => {
  it("is skipped when TM_NO_AUTOLINK or TM_AUTOLINK=0", () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-link-"));
    const prev = { no: process.env.TM_NO_AUTOLINK, on: process.env.TM_AUTOLINK };
    try {
      process.env.TM_NO_AUTOLINK = "1";
      delete process.env.TM_AUTOLINK;
      assert.equal(autolink({ dir }), null);
      delete process.env.TM_NO_AUTOLINK;
      process.env.TM_AUTOLINK = "0";
      assert.equal(autolink({ dir }), null);
      assert.equal(existsSync(join(dir, "tm")), false);
    } finally {
      if (prev.no === undefined) delete process.env.TM_NO_AUTOLINK;
      else process.env.TM_NO_AUTOLINK = prev.no;
      if (prev.on === undefined) delete process.env.TM_AUTOLINK;
      else process.env.TM_AUTOLINK = prev.on;
    }
  });

  it("writes Windows .cmd wrappers without requiring a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-win-"));
    const res = link({ dir, platform: "win32", force: true });
    assert.equal(res.ok, true);
    const cmd = readFileSync(join(dir, "tm.cmd"), "utf8");
    assert.match(cmd, /@echo off/i);
    assert.match(cmd, /node /);
    assert.equal(status(dir, "win32").linked, true);
  });
});

describe("settings catalog", () => {
  it("writes launchBrowser and refuses boardId", () => {
    const p = tempStore();
    stores.push(p.root);
    const snap = settingsSnapshot(p);
    assert.ok(snap.fields.some((f) => f.key === "board.launchBrowser"));
    applySettings({ "board.launchBrowser": true, enforce: false }, p);
    assert.equal(config(p).board.launchBrowser, true);
    assert.equal(config(p).enforce, false);
    assert.throws(() => applySettings({ boardId: "acme/hijack" }, p), /read-only/);
  });

  it("plugin.autolink false skips autolink for that store", () => {
    const p = tempStore();
    stores.push(p.root);
    writeConfig({ plugin: { autolink: false } }, p);
    const dir = mkdtempSync(join(tmpdir(), "tm-skip-"));
    const prev = process.env.TM_NO_AUTOLINK;
    delete process.env.TM_NO_AUTOLINK;
    delete process.env.TM_AUTOLINK;
    try {
      assert.equal(autolink({ dir, p }), null);
    } finally {
      if (prev === undefined) delete process.env.TM_NO_AUTOLINK;
      else process.env.TM_NO_AUTOLINK = prev;
    }
  });
});

describe("board payload", () => {
  it("includes the label catalog even on an empty board", () => {
    const p = tempStore();
    stores.push(p.root);
    const cat = boardPayload(p).labelCatalog;
    assert.ok(Array.isArray(cat));
    assert.ok(cat.includes("decision:interview"));
    assert.ok(cat.includes("needs-triage"));
  });
});
