/** Schema registry (CONTRACT §1): upcasting, read-only passthrough, and the plugin extension point. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertWritable, decode, encode, register, ReadOnlySchemaError } from "../../lib/storage/registry.mjs";
import "../../lib/storage/types.mjs";

describe("registry", () => {
  it("lifts a legacy (schema 0) task through the upcaster and keeps the field it has never heard of", () => {
    const legacy = { type: "tm/task", schema: 0, id: "TM-7", data: { id: "TM-7", title: "old", futureField: { keep: ["me"] } }, meta: {} };
    const out = decode(legacy);
    console.log("before:", JSON.stringify(legacy.data));
    console.log("after: ", JSON.stringify(out.data), `current=${out.current} readOnly=${out.readOnly}`);
    assert.equal(out.current, false);
    assert.equal(out.readOnly, false);
    assert.equal(out.data.kind, "task", "upcaster adds kind");
    assert.deepEqual(out.data.labels, [], "upcaster adds labels");
    assert.deepEqual(out.data.futureField, { keep: ["me"] }, "unknown field preserved verbatim");
    const rewritten = encode("tm/task", out.data, {});
    console.log("rewritten at schema", rewritten.schema, JSON.stringify(rewritten.data));
    assert.equal(rewritten.schema, 1);
    assert.deepEqual(rewritten.data.futureField, { keep: ["me"] });
  });

  it("treats a higher schema as read-only passthrough and refuses a write over it", () => {
    const future = { type: "tm/task", schema: 99, id: "TM-8", data: { id: "TM-8", shiny: true }, meta: {} };
    const out = decode(future);
    assert.equal(out.readOnly, true);
    assert.deepEqual(out.data, future.data, "data returned untouched");
    assert.throws(() => assertWritable(future), (e) => {
      console.log("refusal:", e.message);
      return e instanceof ReadOnlySchemaError && /schema 99/.test(e.message);
    });
  });

  it("treats an unregistered type as read-only", () => {
    const env = { type: "nobody/thing", schema: 1, id: "x", data: { a: 1 }, meta: {} };
    assert.equal(decode(env).readOnly, true);
    assert.throws(() => assertWritable(env), ReadOnlySchemaError);
  });

  it("lets another plugin register a type and a v2 with an upcaster, no core edit", () => {
    register("acme/widget", { current: 1, validate: (d) => assert.ok(d.id), upcasters: { 0: (d) => ({ ...d, size: d.size ?? "m" }) } });
    assert.equal(decode({ type: "acme/widget", schema: 0, id: "w", data: { id: "w" }, meta: {} }).data.size, "m");
    register("acme/widget", { current: 2, upcasters: { 0: (d) => ({ ...d, size: d.size ?? "m" }), 1: (d) => ({ ...d, dim: d.size, size: undefined }) } });
    const out = decode({ type: "acme/widget", schema: 1, id: "w", data: { id: "w", size: "l" }, meta: {} });
    assert.equal(out.data.dim, "l");
    assert.equal(encode("acme/widget", out.data).schema, 2);
  });

  it("rejects a registration with a missing upcaster, a lowered schema, or a bad name", () => {
    assert.throws(() => register("acme/gap", { current: 2, upcasters: { 0: (d) => d } }), /no upcaster from schema 1/);
    assert.throws(() => register("tm/task", { current: 0 }), /cannot lower/);
    assert.throws(() => register("NoSlash", { current: 0 }), /<owner>\/<name>/);
  });

  it("encode validates", () => {
    assert.throws(() => encode("tm/task", { title: "no id" }), /id is required/);
  });
});
