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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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

/**
 * TM-300 — the JSON contract the gateway settings UI uses: whole effective config, one value,
 * a revision-guarded whole-document write, and bare-string values on the key verb.
 */
describe("tm config JSON contract (TM-300)", () => {
  const json = (r) => JSON.parse(r.stdout);
  const docFile = (p, doc) => {
    const f = `${p.root}/doc-${Math.random().toString(36).slice(2)}.json`;
    writeFileSync(f, JSON.stringify(doc));
    return f;
  };

  it("a bare string value is stored as a string, with no JSON parse error", () => {
    const p = store();
    const r = tm(p, "dispatch.integrationBranch", "develop");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).dispatch.integrationBranch, "develop");
    assert.equal(json(tm(p, "dispatch.integrationBranch", "--json")), "develop");
  });

  it("--json prints the whole effective config; --with-revision pairs it with the file's sha256", () => {
    const p = store();
    assert.equal(json(tm(p, "--json")).dispatch.poolWip, 2);
    const r = json(tm(p, "--with-revision", "--json"));
    assert.equal(r.revision, createHash("sha256").update(readFileSync(p.config)).digest("hex"));
    assert.equal(r.config.wipLimit, 3);
  });

  it("--set-file round-trips the effective config, returns the new revision, and refuses a stale one", () => {
    const p = store();
    const { revision, config: cfg } = json(tm(p, "--with-revision"));
    const w = tm(p, "--set-file", docFile(p, { ...cfg, wipLimit: 7 }), "--if-revision", revision, "--json");
    assert.equal(w.status, 0, w.stderr);
    const res = json(w);
    assert.equal(res.previous_revision, revision);
    assert.equal(res.revision, createHash("sha256").update(readFileSync(p.config)).digest("hex"));
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).wipLimit, 7);

    const before = readFileSync(p.config);
    const stale = tm(p, "--set-file", docFile(p, { ...cfg, wipLimit: 9 }), "--if-revision", revision, "--json");
    assert.equal(stale.status, 2);
    assert.equal(json(stale).code, "TM_CONFIG_STALE");
    assert.ok(readFileSync(p.config).equals(before), "a stale write changes nothing");
  });

  it("--set-file refuses unknown keys by name and wrong types, writing nothing", () => {
    const p = store();
    const before = readFileSync(p.config);
    const unknown = tm(p, "--set-file", docFile(p, { wipLimit: 3, wiplimit: 4, bogus: true }), "--json");
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown config keys: wiplimit, bogus/);
    const typed = tm(p, "--set-file", docFile(p, { wipLimit: "lots", webhooks: {} }));
    assert.equal(typed.status, 2);
    assert.match(typed.stderr, /wipLimit must be an integer/);
    assert.match(typed.stderr, /webhooks must be an array/);
    assert.ok(readFileSync(p.config).equals(before));
  });
});
