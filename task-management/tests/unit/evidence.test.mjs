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
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, update } from "../../lib/store.mjs";
import { attachEvidence, detachEvidence, evidenceDest, listEvidence, servableEvidencePath } from "../../lib/evidence.mjs";
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

const task = (p, title = "a task", fields = {}) => create("task", { title, acceptance: [], ...fields }, "", p);
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
