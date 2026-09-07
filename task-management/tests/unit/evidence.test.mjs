/**
 * BDM-69 — dest+ref naming and the guarded file GET allowlist.
 *
 * The dashboard must never become a file server for the rest of the disk. Serving is
 * allowed only when the ref is on that task's evidence[] AND the resolved path sits
 * inside p.evidence (realpath prefix). URLs, schemes, traversal and other-task files
 * are 404, not 403 — the response must not confirm that the path exists.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, update } from "../../lib/store.mjs";
import { PROVENANCE, attachEvidence, detachEvidence, evidenceDest, evidenceSync, listEvidence, servableEvidencePath } from "../../lib/evidence.mjs";
import { diagnose, repairAll } from "../../lib/doctor.mjs";
import { handleWrite } from "../../lib/dashboard-api.mjs";
import { writeConfig } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, requireAcceptance: true, wipLimit: 99 }, p);
  return p;
}
after(() => cleanup(...stores));

const task = (p, title = "a task", fields = {}) =>
  create("task", { title, acceptance: [{ text: "done means", done: false }], ...fields }, "context\n", p);
const get = (p, path) => handleWrite("GET", path, {}, { p });
const post = (p, id, body) => handleWrite("POST", `/api/task/${id}/evidence`, body, { p });

describe("dest + ref", () => {
  it("names a copied file TM-NNN-<basename>, the same as `tm evidence <id> <path>`", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "out.txt");
    writeFileSync(src, "from a path\n");
    const { dest, ref } = evidenceDest(t.id, { path: src }, p);
    assert.equal(dest, join(p.evidence, `${t.id}-out.txt`));
    assert.equal(ref, `.bytedesk/task-management/evidence/${t.id}-out.txt`);
  });

  it("names stdin/text TM-NNN-<ts>.log, the same as `tm evidence <id> -`", () => {
    const p = store();
    const t = task(p);
    const { dest, ref } = evidenceDest(t.id, { text: "log", ts: 1700000000000 }, p);
    assert.equal(dest, join(p.evidence, `${t.id}-1700000000000.log`));
    assert.equal(ref, `.bytedesk/task-management/evidence/${t.id}-1700000000000.log`);
  });
});

describe("POST appends", () => {
  it("writes the log and appends the ref via mutate", () => {
    const p = store();
    const t = task(p);
    const first = post(p, t.id, { text: "one" });
    const second = post(p, t.id, { text: "two" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const after = read(t.id, p);
    assert.equal(after.evidence.length, 2);
    assert.match(after.evidence[0], new RegExp(`^\\.bytedesk/task-management/evidence/${t.id}-\\d+\\.log$`));
    assert.equal(readFileSync(join(p.root, after.evidence[0]), "utf8"), "one");
    assert.equal(readFileSync(join(p.root, after.evidence[1]), "utf8"), "two");
  });

  it("copies a path as TM-NNN-<basename>", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "bench.json");
    writeFileSync(src, "{\"ok\":true}\n");
    const res = post(p, t.id, { path: src });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).evidence[0], `.bytedesk/task-management/evidence/${t.id}-bench.json`);
    assert.equal(readFileSync(join(p.evidence, `${t.id}-bench.json`), "utf8"), "{\"ok\":true}\n");
  });
});

describe("allowlist GET", () => {
  it("200s only when the ref is on this task and the realpath is inside p.evidence", () => {
    const p = store();
    const t = task(p);
    const { ref } = attachEvidence(t.id, { text: "inside", ts: 1 }, p);
    const res = get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(ref)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, `${t.id}-1.log`);
  });

  it("404s a URL, even when the task lists it", () => {
    const p = store();
    const url = "https://github.com/ByteDeskAI/bytedesk-marketplace/pull/69";
    const t = task(p, "proven", { evidence: [url] });
    assert.equal(get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(url)}`).status, 404);
  });

  it("404s a browser: handle and any other scheme", () => {
    const p = store();
    const ref = "browser:019fb067-1c42-79bc-9e8c-1ab8a2b9ddf8";
    const t = task(p, "seen", { evidence: [ref] });
    assert.equal(get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(ref)}`).status, 404);
  });

  it("404s another task's file", () => {
    const p = store();
    const a = task(p, "owner");
    const b = task(p, "other");
    const { ref } = attachEvidence(a.id, { text: "a only", ts: 2 }, p);
    assert.equal(get(p, `/api/task/${b.id}/file?ref=${encodeURIComponent(ref)}`).status, 404);
  });

  it("404s traversal even if the traversal string is listed", () => {
    const p = store();
    const t = task(p);
    const secret = join(p.base, "config.json");
    const ref = ".bytedesk/task-management/evidence/../config.json";
    update(t.id, { evidence: [ref] }, p);
    assert.equal(existsSync(secret), true);
    assert.equal(get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(ref)}`).status, 404);
    assert.equal(servableEvidencePath(read(t.id, p), ref, p), null);
  });

  it("404s an absolute path outside p.evidence", () => {
    const p = store();
    const outside = join(p.root, "outside.log");
    writeFileSync(outside, "not in the store\n");
    const t = task(p, "abs", { evidence: [outside] });
    assert.equal(get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(outside)}`).status, 404);
  });

  it("404s a symlink that escapes p.evidence", () => {
    const p = store();
    const t = task(p);
    mkdirSync(p.evidence, { recursive: true });
    const outside = join(p.root, "secret.log");
    writeFileSync(outside, "secret\n");
    const link = join(p.evidence, `${t.id}-link.log`);
    symlinkSync(outside, link);
    const ref = `.bytedesk/task-management/evidence/${t.id}-link.log`;
    update(t.id, { evidence: [ref] }, p);
    assert.equal(get(p, `/api/task/${t.id}/file?ref=${encodeURIComponent(ref)}`).status, 404);
  });
});

describe("list, detach, doctor", () => {
  it("GET /evidence derives kind/name/exists/previewable and writes no frontmatter", () => {
    const p = store();
    const url = "https://example.com/pr/1";
    const handle = "browser:abc";
    const t = task(p, "mixed", { evidence: [url, handle] });
    attachEvidence(t.id, { text: "log", ts: 9 }, p);
    const before = readFileSync(t.file, "utf8");
    const res = get(p, `/api/task/${t.id}/evidence`);
    assert.equal(res.status, 200);
    const items = res.body.evidence;
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((i) => i.kind),
      ["url", "uri", "file"],
    );
    assert.equal(items[0].exists, true, "a URL is not a missing file");
    assert.equal(items[0].previewable, false);
    assert.equal(items[1].previewable, false);
    assert.equal(items[2].exists, true);
    assert.equal(items[2].previewable, true);
    assert.ok(items.every((i) => "name" in i && "ref" in i));
    const after = readFileSync(t.file, "utf8");
    assert.equal(after, before, "listing must not invent frontmatter or rewrite the file");
  });

  it("detach filters the array and leaves the file on disk", () => {
    const p = store();
    const t = task(p);
    const { dest, ref } = attachEvidence(t.id, { text: "keep the bytes", ts: 3 }, p);
    const res = post(p, t.id, { detach: ref });
    assert.equal(res.status, 200);
    assert.deepEqual(read(t.id, p).evidence, []);
    assert.equal(existsSync(dest), true);
    assert.equal(readFileSync(dest, "utf8"), "keep the bytes");
    // detachEvidence is the same contract the route uses
    assert.deepEqual(detachEvidence(t.id, ref, p), []);
  });

  it("a URL survives doctor --fix (TM-007 / TM-016)", () => {
    const p = store();
    const url = "https://github.com/ByteDeskAI/bytedesk-marketplace/pull/69";
    const t = task(p, "proven", { evidence: [url] });
    assert.deepEqual(
      diagnose(p).map((f) => f.code),
      [],
      "nothing on disk answers to a url, so there is nothing to report",
    );
    repairAll(p);
    assert.deepEqual(read(t.id, p).evidence, [url]);
    assert.equal(listEvidence(t, p)[0].exists, true);
  });
});

/**
 * TM-125 — an attachment is a COPY, so the source can move on without it. These tests exist
 * because that happened: TM-123's evidence drifted within an hour of being attached and the
 * board said nothing, because nothing recorded where the file came from.
 *
 * Each one is written so that removing the provenance write, or the doctor check, makes it
 * fail — a test that passes with the fix reverted is guarding a different property than its
 * name claims.
 */
describe("evidence provenance", () => {
  const codes = (p) => diagnose(p).map((f) => f.code);
  const at = (p, code) => diagnose(p).find((f) => f.code === code);

  it("records the absolute source path and a content hash at attach time", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "measure.txt");
    writeFileSync(src, "22/123/14\n");
    const { ref, provenance } = attachEvidence(t.id, { path: src }, p);

    assert.equal(provenance.source, src, "the source path is what makes drift detectable at all");
    assert.equal(provenance.sha256, createHash("sha256").update("22/123/14\n").digest("hex"));
    assert.equal(provenance.bytes, 10);
    // …and it survives the round trip through frontmatter, which is where it has to live.
    const stored = read(t.id, p)[PROVENANCE][ref];
    assert.equal(stored.source, src);
    assert.equal(stored.sha256, provenance.sha256);
    assert.equal(evidenceSync(read(t.id, p), ref, p).state, "in-sync");
  });

  it("reports drift, naming the source, when the source is edited after the copy", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "rate.md");
    writeFileSync(src, "buckets 22/123/14\n");
    const { dest, ref } = attachEvidence(t.id, { path: src }, p);
    assert.deepEqual(codes(p), [], "in sync the moment it is attached");

    // The live failure, reproduced: an addendum appended to the source after the copy.
    writeFileSync(src, "buckets 22/123/14\n\n## ten-run addendum\n55/90/14\n");

    const f = at(p, "evidence-drift");
    assert.ok(f, "an edited source must be reported, not silently tolerated");
    assert.equal(f.id, t.id);
    assert.ok(f.message.includes(src), "the finding must carry the source path — it is the actionable part");
    assert.ok(f.message.includes(ref));
    assert.equal(evidenceSync(read(t.id, p), ref, p).state, "drifted");
    // The copy itself is untouched; it is the pointer that is stale, not the bytes.
    assert.equal(readFileSync(dest, "utf8"), "buckets 22/123/14\n");
  });

  it("keeps drift a warning, so an edited source cannot turn the board red", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "out.log");
    writeFileSync(src, "before\n");
    attachEvidence(t.id, { path: src }, p);
    writeFileSync(src, "after\n");

    const f = at(p, "evidence-drift");
    assert.equal(f.level, "warning");
    assert.equal(f.fixable, false, "refreshing evidence a task was closed on is a decision, not a repair");
    assert.equal(
      diagnose(p).filter((x) => x.level === "error").length,
      0,
      "`tm doctor` exits 1 on an error; drift must not gate every commit after an ordinary edit",
    );
  });

  it("leaves a drifted attachment alone under --fix", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "proof.txt");
    writeFileSync(src, "one\n");
    const { dest, ref } = attachEvidence(t.id, { path: src }, p);
    writeFileSync(src, "two\n");

    repairAll(p);
    assert.deepEqual(read(t.id, p).evidence, [ref], "the ref must survive a repair pass");
    assert.equal(readFileSync(dest, "utf8"), "one\n", "--fix must not overwrite reviewed evidence with newer bytes");
    assert.ok(at(p, "evidence-drift"), "and it is still reported afterwards");
  });

  it("distinguishes a deleted source from a changed one, and from a missing copy", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "gone.txt");
    writeFileSync(src, "present\n");
    const { dest, ref } = attachEvidence(t.id, { path: src }, p);
    rmSync(src);

    const found = codes(p);
    assert.ok(found.includes("evidence-source-gone"), "a source that has moved or been deleted is its own fact");
    assert.ok(!found.includes("evidence-drift"), "a deleted source has not 'changed' — that would be a different claim");
    assert.ok(!found.includes("missing-evidence"), "the copy in the store is still there; only the source is gone");
    assert.equal(existsSync(dest), true);
    assert.equal(evidenceSync(read(t.id, p), ref, p).state, "source-missing");

    // And when the COPY goes instead, it is the old finding, not a provenance one.
    rmSync(dest);
    const after = codes(p);
    assert.ok(after.includes("missing-evidence"));
    assert.ok(!after.includes("evidence-source-gone"));
  });

  it("calls an attachment with no recorded provenance unknown, and says nothing about it", () => {
    const p = store();
    const t = task(p);
    // Exactly the shape of a store written before this existed: a ref, no evidenceSources.
    const ref = `.bytedesk/task-management/evidence/${t.id}-legacy.log`;
    mkdirSync(p.evidence, { recursive: true });
    writeFileSync(join(p.evidence, `${t.id}-legacy.log`), "attached last year\n");
    update(t.id, { evidence: [ref] }, p);

    const doc = read(t.id, p);
    assert.equal(doc[PROVENANCE], undefined, "an old store gains no frontmatter by being read");
    assert.equal(evidenceSync(doc, ref, p).state, "unknown", "unknown is not drifted — nothing was ever recorded");
    assert.deepEqual(codes(p), [], "an older board must not light up with findings nobody can act on");
    assert.equal(listEvidence(doc, p)[0].sync, "unknown", "…but asking directly still gets an honest answer");
  });

  it("treats an inline capture as inline, not as a source that vanished", () => {
    const p = store();
    const t = task(p);
    const { ref } = attachEvidence(t.id, { text: "pasted output\n", ts: 7 }, p);
    const doc = read(t.id, p);
    assert.equal(doc[PROVENANCE][ref].source, null, "stdin has no upstream file");
    assert.equal(evidenceSync(doc, ref, p).state, "inline");
    assert.deepEqual(codes(p), []);
  });

  it("clears the drift when the source is attached again", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "refresh.txt");
    writeFileSync(src, "v1\n");
    attachEvidence(t.id, { path: src }, p);
    writeFileSync(src, "v2\n");
    assert.ok(at(p, "evidence-drift"));

    const { dest, ref } = attachEvidence(t.id, { path: src }, p);
    assert.equal(readFileSync(dest, "utf8"), "v2\n");
    assert.equal(evidenceSync(read(t.id, p), ref, p).state, "in-sync");
    assert.equal(at(p, "evidence-drift"), undefined, "the refresh is what makes the warning actionable");
  });

  it("drops the provenance entry when the ref is detached", () => {
    const p = store();
    const t = task(p);
    const src = join(p.root, "detach.txt");
    writeFileSync(src, "x\n");
    const { ref } = attachEvidence(t.id, { path: src }, p);
    detachEvidence(t.id, ref, p);
    const doc = read(t.id, p);
    assert.deepEqual(doc.evidence, []);
    assert.ok(!doc[PROVENANCE] || !(ref in doc[PROVENANCE]), "a stale record would mis-report the next attach of the same name");
  });

  it("says nothing about a url — there is no source path to compare", () => {
    const p = store();
    const t = task(p, "proven", { evidence: ["https://example.com/pull/69"] });
    assert.equal(evidenceSync(read(t.id, p), "https://example.com/pull/69", p).state, "external");
    assert.deepEqual(codes(p), []);
  });
});
