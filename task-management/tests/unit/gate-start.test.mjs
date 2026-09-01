/** gateStart — one WIP check for the CLI, MCP and the board. */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { gateStart, setOverride } from "../../lib/enforce.mjs";
import { create, readEvents, writeConfig } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = (cfg = {}) => {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ enforce: true, wipLimit: 1, ...cfg }, p);
  return p;
};

describe("gateStart", () => {
  it("allows under the limit, refuses at it, and does not count the task against itself", () => {
    const p = store();
    const a = create("task", { title: "a", status: "in_progress" }, "", p);
    const b = create("task", { title: "b" }, "", p);
    assert.equal(gateStart(a.id, p).allow, true, "resuming is not starting");
    const res = gateStart(b.id, p);
    assert.equal(res.allow, false);
    assert.match(res.reason, /WIP limit 1 reached: TM-001/);
  });
  it("spends an override once", () => {
    const p = store();
    create("task", { title: "a", status: "in_progress" }, "", p);
    const b = create("task", { title: "b" }, "", p);
    setOverride("pairing", p);
    assert.equal(gateStart(b.id, p).allow, true);
    assert.equal(gateStart(b.id, p).allow, false);
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 1);
  });
  it("is open when enforcement is off or the limit is 0", () => {
    const off = store({ enforce: false });
    create("task", { title: "a", status: "in_progress" }, "", off);
    assert.equal(gateStart("TM-002", off).allow, true);
    const zero = store({ wipLimit: 0 });
    create("task", { title: "a", status: "in_progress" }, "", zero);
    assert.equal(gateStart("TM-002", zero).allow, true);
  });
});
