/** The markdown store behind the Backend interface: same guards, honest about what it cannot do. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { FileBackend } from "../../lib/storage/file-backend.mjs";
import { ConflictError, UnsupportedError } from "../../lib/storage/backend.mjs";
import { create, read, writeConfig } from "../../lib/store.mjs";
import { decode, encode } from "../../lib/storage/registry.mjs";
import "../../lib/storage/types.mjs";

const p = tempStore();
after(() => cleanup(p.root));
writeConfig({ enforce: false, requireEpic: false }, p);

describe("file backend", () => {
  it("reads a markdown task as a schema-0 envelope that upcasts, and writes through the store's own write()", async () => {
    const b = new FileBackend(p);
    const t = create("task", { title: "from markdown", weird: 1 }, "body\n", p);
    const bodyBefore = read(t.id, p).body;
    const got = await b.get("tm/task", t.id);
    assert.equal(got.envelope.schema, 0);
    assert.equal(decode(got.envelope).data.kind, "task");
    assert.equal(got.envelope.data.weird, 1);
    const { rev } = await b.put("tm/task", t.id, encode("tm/task", { ...decode(got.envelope).data, title: "retitled" }), { ifRev: got.rev });
    assert.equal(read(t.id, p).title, "retitled");
    assert.equal(read(t.id, p).body, bodyBefore, "body round-trips unchanged");
    await assert.rejects(b.put("tm/task", t.id, got.envelope, { ifRev: got.rev }), (e) => e instanceof ConflictError && e.currentRev === rev);
    assert.equal((await b.list("tm/task")).length, 1);
  });

  it("says so when it cannot do something", async () => {
    const b = new FileBackend(p);
    await assert.rejects(b.history("tm/task", "TM-1"), UnsupportedError);
    await assert.rejects(b.stateGet("claims.TM-1"), UnsupportedError);
    await assert.rejects(b.get("tm/plan", "x"), UnsupportedError);
  });

  it("blobs are content addressed", async () => {
    const b = new FileBackend(p);
    const d = await b.blobPut("abc");
    assert.equal((await b.blobGet(d)).toString(), "abc");
    assert.deepEqual(await b.blobList(), [d]);
  });
});
