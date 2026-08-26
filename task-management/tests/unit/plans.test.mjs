/**
 * BDM-72 — plans are a derived inbox + epic.plan pointer, not a KIND.
 *
 * Chooser/capture had no tests. handleWrite is driven on a real temp store
 * (see dashboard-api.test.mjs); this file covers the helper and tm show.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, readEvents, writeState } from "../../lib/store.mjs";
import { choosePlanSource, capturePlan, newestPlanFile, payloadPlanPath } from "../../lib/plans.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

function seedFile(dir, name, body, mtimeMs) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, name);
  writeFileSync(dest, body);
  if (mtimeMs != null) {
    const at = new Date(mtimeMs);
    utimesSync(dest, at, at);
  }
  return dest;
}

describe("choosePlanSource", () => {
  it("uses the payload path when that file exists", () => {
    const p = store();
    const hinted = seedFile(p.root, "hinted.md", "# Hinted\n");
    const dir = join(p.root, "claude-plans");
    seedFile(dir, "older.md", "# Older\n", 1_000);
    seedFile(dir, "newer.md", "# Newer\n", 2_000);

    const src = choosePlanSource({ tool_input: { file_path: hinted } }, { dir });
    assert.equal(src, hinted);
  });

  it("falls back to newest-mtime when the payload path is missing or gone", () => {
    const p = store();
    const dir = join(p.root, "claude-plans");
    seedFile(dir, "older.md", "# Older\n", 1_000);
    const newer = seedFile(dir, "newer.md", "# Newer\n", 2_000);

    assert.equal(choosePlanSource({}, { dir }), newer);
    assert.equal(
      choosePlanSource({ tool_input: { path: join(p.root, "nope.md") } }, { dir }),
      newer,
    );
    assert.equal(newestPlanFile(dir), newer);
  });

  it("does not treat a Codex plan array as a path", () => {
    assert.equal(payloadPlanPath({ tool_input: { plan: [{ step: "x" }] } }), null);
    assert.equal(payloadPlanPath({ tool_input: { plan: "a whole body\n# heading" } }), null);
  });

  it("returns null when there is no payload path and the dir is empty", () => {
    const p = store();
    const dir = join(p.root, "empty-plans");
    mkdirSync(dir, { recursive: true });
    assert.equal(choosePlanSource({}, { dir }), null);
  });
});

describe("capturePlan", () => {
  it("copies the source into p.plans and sets epic.plan", () => {
    const p = store();
    const src = seedFile(p.root, "approved.md", "# Close the gaps\n\nDo the work.\n");
    const res = capturePlan({ tool_input: { path: src } }, p);
    assert.ok(res);
    assert.match(res.rel, /^\.bytedesk\/task-management\/plans\/\d{4}-\d{2}-\d{2}-close-the-gaps\.md$/);
    assert.equal(read(res.epicId, p).plan, res.rel);
    assert.ok(readEvents(p).some((e) => e.event === "plan_captured" && e.id === res.epicId));
    assert.equal(res.created, true);
  });

  it("links the active epic rather than minting another", () => {
    const p = store();
    const epic = create("epic", { title: "already open" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    const src = seedFile(p.root, "next.md", "# Next\n");
    const res = capturePlan({ tool_input: { path: src } }, p);
    assert.equal(res.epicId, epic.id);
    assert.equal(res.created, false);
    assert.equal(read(epic.id, p).plan, res.rel);
  });

  it("returns null when there is nothing to capture", () => {
    const p = store();
    assert.equal(capturePlan({}, p, { claudePlans: join(p.root, "no-such-dir") }), null);
  });
});

describe("tm show", () => {
  it("prints plan: when the epic has one", () => {
    const p = store();
    const e = create("epic", { title: "has a plan", plan: ".bytedesk/task-management/plans/x.md" }, "", p);
    const out = execFileSync(process.execPath, [TM, "show", e.id], {
      env: { ...process.env, TM_ROOT: p.root },
      encoding: "utf8",
    });
    assert.match(out, /plan: \.bytedesk\/task-management\/plans\/x\.md/);
  });

  it("omits plan: when the pointer is unset", () => {
    const p = store();
    const e = create("epic", { title: "no plan" }, "", p);
    const out = execFileSync(process.execPath, [TM, "show", e.id], {
      env: { ...process.env, TM_ROOT: p.root },
      encoding: "utf8",
    });
    assert.equal(out.includes("plan:"), false);
  });
});
