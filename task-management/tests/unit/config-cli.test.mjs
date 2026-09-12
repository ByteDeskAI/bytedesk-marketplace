/**
 * TM-174 — `tm config` reads without writing, and a dotted key is a path, not a name.
 *
 * B1: `tm config <key>` with no value passed `{ [key]: undefined }` to writeConfig, and
 *     JSON.stringify dropped the key — so asking for a value deleted it.
 * B2: `tm config dispatch.enabled true` (what the pool docs tell you to run) wrote a literal
 *     top-level "dispatch.enabled" key that nothing reads.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, git, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { writeConfig } from "../../lib/store.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const roots = [];
after(() => cleanup(...roots));

function store() {
  const p = tempStore();
  roots.push(p.root);
  writeConfig({ wipLimit: 3, dispatch: { enabled: false, poolWip: 2 } }, p);
  return p;
}

function tm(p, ...args) {
  return spawnSync(process.execPath, [TM, "config", ...args], {
    env: { ...process.env, TM_ROOT: p.root },
    encoding: "utf8",
  });
}

describe("tm config <key> reads (B1)", () => {
  for (const [key, expected] of [
    ["wipLimit", 3],
    ["dispatch.enabled", false],
  ]) {
    it(`prints ${key} and leaves config.json byte-identical`, () => {
      const p = store();
      const before = readFileSync(p.config);
      const r = tm(p, key);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), expected);
      assert.ok(readFileSync(p.config).equals(before), "a read must not rewrite the file");
    });
  }

  it("with no key still prints the whole config", () => {
    const p = store();
    const r = tm(p);
    assert.equal(r.status, 0, r.stderr);
    const shown = JSON.parse(r.stdout);
    assert.equal(shown.wipLimit, 3);
    assert.equal(shown.dispatch.poolWip, 2);
  });
});

describe("tm config <dotted.key> <value> sets a path (B2)", () => {
  it("sets dispatch.enabled inside dispatch and keeps its siblings", () => {
    const p = store();
    const r = tm(p, "dispatch.enabled", "true");
    assert.equal(r.status, 0, r.stderr);
    const onDisk = JSON.parse(readFileSync(p.config, "utf8"));
    assert.equal(onDisk.dispatch.enabled, true);
    assert.equal(onDisk.dispatch.poolWip, 2, "sibling dispatch keys survive");
    assert.equal("dispatch.enabled" in onDisk, false, "no literal top-level dotted key");
  });

  it("a non-dotted key still writes as before", () => {
    const p = store();
    const r = tm(p, "wipLimit", "5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).wipLimit, 5);
  });
});

describe("read-only identity keys", () => {
  it("owner reads freely but refuses a value when git answers", () => {
    const root = tempRepo();
    roots.push(root);
    const p = paths(root);
    ensureDirs(p);
    git(root, "config", "user.name", "Test");
    const read = tm(p, "owner");
    assert.equal(read.status, 0, read.stderr);
    const write = tm(p, "owner", '"Someone Else"');
    assert.equal(write.status, 2);
    assert.match(write.stderr, /read-only/);
  });
});
