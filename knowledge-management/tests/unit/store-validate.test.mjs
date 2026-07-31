import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createConcept, initBundle, listConcepts, readConcept, writeConcept } from "../../lib/store.mjs";
import { validateBundle, trustTier } from "../../lib/validate.mjs";
import { reindex } from "../../lib/index.mjs";
import { withBundle, loadFixture } from "./helpers.mjs";
import { paths } from "../../lib/paths.mjs";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("store + validate", () => {
  it("init creates OKF index and validate passes empty bundle", () => {
    withBundle((p) => {
      assert.ok(existsSync(p.indexMd));
      assert.ok(existsSync(p.logMd));
      assert.ok(existsSync(p.config));
      const r = validateBundle(p);
      assert.equal(r.ok, true);
      assert.equal(r.conceptCount, 0);
    });
  });

  it("create concept then validate + reindex", () => {
    withBundle((p) => {
      const doc = createConcept({ type: "Playbook", title: "Deploy", dir: "runbooks", description: "How to deploy" }, p);
      assert.equal(doc.type, "Playbook");
      assert.ok(doc.id.includes("deploy"));
      const r = validateBundle(p);
      assert.equal(r.ok, true);
      assert.equal(r.conceptCount, 1);
      const idx = reindex(p);
      assert.equal(idx.concepts.length, 1);
      assert.ok(existsSync(p.indexJson));
    });
  });

  it("good fixture validates; bad fixture fails", () => {
    const good = loadFixture("good");
    try {
      const r = validateBundle(good.paths);
      assert.equal(r.ok, true);
      assert.ok(r.conceptCount >= 2);
    } finally {
      good.restore();
    }

    const bad = loadFixture("bad");
    try {
      const r = validateBundle(bad.paths);
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /frontmatter|type/i.test(e)));
    } finally {
      bad.restore();
    }
  });

  it("does not treat .km runtime files as concepts", () => {
    withBundle((p) => {
      writeFileSync(join(p.runtime, "note.md"), "---\ntype: X\n---\n\nnope\n");
      const r = validateBundle(p);
      assert.equal(r.ok, true);
      assert.equal(listConcepts(p).length, 0);
    });
  });

  it("trust tiers from verified", () => {
    assert.equal(trustTier({}), "unverified");
    assert.equal(trustTier({ verified: { by: "process:ci", at: "t" } }), "machine-confirmed");
    assert.equal(trustTier({ verified: { by: "human:ryan", at: "t" } }), "human-reviewed");
  });
});
