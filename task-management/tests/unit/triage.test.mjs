/**
 * TM-176. Agent readiness is one check, and the `ready-for-agent` label is kept in sync by the
 * store's own write — with a sticky human veto.
 *
 * The rules under test, in the order the readiness check applies them:
 *   - the start gate's field list (`requireOnStart`) is complete;
 *   - it has an epic when `requireEpic` is on;
 *   - no human-only label: ready-for-human, needs-info, wontfix, human-gate;
 *   - no decision role an agent cannot answer alone: interview, prototype, unblock, map.
 * Status and dependencies are deliberately NOT part of it: the label means "specified", and the
 * pool separately checks "startable now".
 *
 * Every veto test first proves the sync is live on that task. A veto test that only checks "the
 * person's label is still there" passes on a store with no sync at all, which is how the first
 * draft of this file passed four of them before any implementation existed.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import * as completeness from "../../lib/completeness.mjs";
import * as issue from "../../lib/issue.mjs";
import * as decision from "../../lib/decision.mjs";
import { config, create, editTask, read, update, writeConfig, writeState } from "../../lib/store.mjs";
import { CATALOG } from "../../lib/settings.mjs";
import { handleRequest } from "../../lib/mcp.mjs";
import { handleWrite } from "../../lib/dashboard-api.mjs";

const { agentReadiness } = completeness;
const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const CFG = { requireOnStart: ["body", "acceptance"], requireEpic: true };
const COMPLETE = { id: "TM-001", epic: "EP-001", body: "what and why", acceptance: [{ text: "verifiable", done: false }] };

/** A store with an active epic, and a way to file complete or sparse tasks under it. */
function board() {
  const p = store();
  const epic = create("epic", { title: "wave" }, "", p);
  writeState({ activeEpic: epic.id }, p);
  const task = (fields = {}, body = "what and why") =>
    create("task", { title: `task ${Math.random()}`, epic: epic.id, acceptance: [{ text: "verifiable", done: false }], ...fields }, body, p);
  return { p, epic, task };
}

const eventLines = (p) => readFileSync(p.events, "utf8").split("\n").filter(Boolean);

describe("agentReadiness — the one readiness check", () => {
  it("is ready when every rule holds, and names nothing missing", () => {
    assert.deepEqual(agentReadiness(COMPLETE, CFG), { ready: true, missing: [] });
  });

  it("requires the start gate's fields, named for a person", () => {
    assert.deepEqual(agentReadiness({ ...COMPLETE, body: "  " }, CFG), { ready: false, missing: ["body"] });
    assert.deepEqual(agentReadiness({ ...COMPLETE, acceptance: [] }, CFG), { ready: false, missing: ["acceptance criteria"] });
    // The list comes from config, so a project that turned the start gate's half off is not held to it.
    assert.deepEqual(agentReadiness({ ...COMPLETE, body: "", acceptance: [] }, { ...CFG, requireOnStart: [] }), { ready: true, missing: [] });
  });

  it("requires an epic only when requireEpic is on", () => {
    assert.deepEqual(agentReadiness({ ...COMPLETE, epic: null }, CFG), { ready: false, missing: ["epic"] });
    assert.deepEqual(agentReadiness({ ...COMPLETE, epic: null }, { ...CFG, requireEpic: false }), { ready: true, missing: [] });
  });

  it("is never ready while a human-only label is on it", () => {
    for (const label of ["ready-for-human", "needs-info", "wontfix", "human-gate"]) {
      assert.deepEqual(agentReadiness({ ...COMPLETE, labels: ["ui", label] }, CFG), { ready: false, missing: [`label ${label}`] }, label);
    }
  });

  it("is never ready under a decision role an agent cannot answer alone — research is allowed", () => {
    for (const label of ["decision:interview", "decision:prototype", "decision:unblock", "decision:map"]) {
      assert.deepEqual(agentReadiness({ ...COMPLETE, labels: [label] }, CFG), { ready: false, missing: [`label ${label}`] }, label);
    }
    assert.deepEqual(agentReadiness({ ...COMPLETE, labels: ["decision:research"] }, CFG), { ready: true, missing: [] });
  });

  it("ignores status and dependencies: specified is not the same as startable", () => {
    const blocked = { ...COMPLETE, status: "blocked", blockedBy: ["TM-009"] };
    assert.deepEqual(agentReadiness(blocked, CFG), { ready: true, missing: [] });
  });

  it("reports every gap at once, not just the first", () => {
    const res = agentReadiness({ id: "TM-002", labels: ["needs-info"] }, CFG);
    assert.deepEqual(res, { ready: false, missing: ["body", "acceptance criteria", "epic", "label needs-info"] });
  });

  it("owns the triage and decision vocabularies; issue.mjs and decision.mjs re-export the same arrays", () => {
    assert.deepEqual(completeness.TRIAGE_LABELS, ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"]);
    assert.equal(issue.TRIAGE_LABELS, completeness.TRIAGE_LABELS);
    assert.equal(issue.DECISION_KIND, completeness.DECISION_KIND);
    assert.equal(decision.DECISION_KIND, completeness.DECISION_KIND);
  });
});

describe("label sync inside the store write", () => {
  it("labels a complete task ready-for-agent at create, stamped auto", () => {
    const { p, task } = board();
    const t = read(task().id, p);
    assert.deepEqual(t.labels, ["ready-for-agent"]);
    assert.equal(t.triagedBy, "auto");
    assert.equal(t.triageMissing, undefined);
  });

  it("labels an incomplete task needs-triage and names what is missing", () => {
    const { p, task } = board();
    const t = read(task({ acceptance: [] }, "").id, p);
    assert.deepEqual(t.labels, ["needs-triage"]);
    assert.equal(t.triagedBy, "auto");
    assert.deepEqual(t.triageMissing, ["body", "acceptance criteria"]);
  });

  it("keeps every non-triage label", () => {
    const { p, task } = board();
    assert.deepEqual(read(task({ labels: ["ui", "tech-debt"] }).id, p).labels, ["ui", "tech-debt", "ready-for-agent"]);
  });

  it("flips an auto label when a later write completes the task, in that same write", () => {
    const { p, task } = board();
    const t = task({ acceptance: [] });
    const before = eventLines(p).length;

    update(t.id, { acceptance: [{ text: "now specified", done: false }] }, p);

    const lines = eventLines(p);
    assert.equal(lines.length, before + 1, "one write, one event — the sync is not a second write");
    const row = JSON.parse(lines.at(-1));
    assert.equal(row.event, "update");
    assert.equal(row.id, t.id);
    assert.deepEqual(row.patch.split(","), ["acceptance", "labels", "triageMissing"], "the event names what the write changed");
    const now = read(t.id, p);
    assert.deepEqual(now.labels, ["ready-for-agent"]);
    assert.equal(now.triageMissing, undefined);
  });

  it("editing an unrelated field adds no label event and leaves the triage fields alone", () => {
    const { p, task } = board();
    const t = task({ labels: ["ui"] });
    assert.deepEqual(read(t.id, p).labels, ["ui", "ready-for-agent"], "precondition: the sync labelled it at create");
    const before = eventLines(p);

    editTask(t.id, { title: "a better title" }, p);

    const lines = eventLines(p);
    assert.equal(lines.length, before.length + 2, "exactly update + edit");
    const added = lines.slice(before.length).map((l) => JSON.parse(l));
    assert.deepEqual(added.map((e) => e.event), ["update", "edit"]);
    assert.equal(added[0].patch, "title", "labels are not in the write");
    assert.equal(added.some((e) => e.event === "labels"), false);
    assert.deepEqual(read(t.id, p).labels, ["ui", "ready-for-agent"]);
  });

  it("does not touch a resolved task", () => {
    const { p, task } = board();
    const t = task();
    update(t.id, { status: "done", body: "" }, p);
    assert.deepEqual(read(t.id, p).labels, ["ready-for-agent"], "done work is not re-triaged");
  });

  it("unset autoReady means label; dispatch.autoReady off disables it on create and update", () => {
    const { p, task } = board();
    assert.equal(config(p).dispatch.autoReady, undefined, "a fresh store has no setting");
    assert.deepEqual(read(task().id, p).labels, ["ready-for-agent"], "unset behaves as label");

    writeConfig({ dispatch: { autoReady: "off" } }, p);
    const t = read(task().id, p);
    assert.equal(t.labels, undefined);
    assert.equal(t.triagedBy, undefined);
    update(t.id, { title: "edited while off" }, p);
    assert.equal(read(t.id, p).labels, undefined);
  });
});

describe("the human veto", () => {
  it("a triage label set by a person survives edits of other fields, and clears the auto stamp", () => {
    const { p, task } = board();
    const t = task({ acceptance: [] }, "");
    assert.equal(read(t.id, p).triagedBy, "auto");

    issue.labels(t.id, { add: ["ready-for-agent"] }, p);
    let now = read(t.id, p);
    assert.deepEqual(now.labels, ["ready-for-agent"]);
    assert.equal(now.triagedBy, undefined, "setting a triage label hands the decision to the person");
    assert.equal(now.triageMissing, undefined);

    editTask(t.id, { title: "renamed", body: "" }, p);
    update(t.id, { priority: "high" }, p);
    now = read(t.id, p);
    assert.deepEqual(now.labels, ["ready-for-agent"], "an incomplete task a person marked ready stays marked");
    assert.equal(now.triagedBy, undefined);
  });

  it("a direct update that changes the triage label is a person's choice too, whichever surface sent it", () => {
    // The veto lives in the funnel, not only in labels(): a write that swaps the triage label and
    // does not say the store did it came from a person. Found by the pool-policy fixture, which
    // marks work ready with a plain update and was being relabelled needs-triage underneath.
    const { p, task } = board();
    const t = task({ acceptance: [] });
    assert.equal(read(t.id, p).triagedBy, "auto", "precondition: the sync owns this task's label");

    update(t.id, { labels: ["ready-for-agent"] }, p);
    update(t.id, { title: "a later edit" }, p);

    const now = read(t.id, p);
    assert.deepEqual(now.labels, ["ready-for-agent"]);
    assert.equal(now.triagedBy, undefined);
    assert.equal(now.triageMissing, undefined);
  });

  it("leaves a hand-labelled task alone even with no triagedBy at all, while its unlabelled sibling is triaged", () => {
    const { p, task } = board();
    writeConfig({ dispatch: { autoReady: "off" } }, p);
    const handLabelled = task({ labels: ["needs-info"] });
    const sibling = task();
    writeConfig({ dispatch: { autoReady: "label" } }, p);

    update(handLabelled.id, { title: "touched" }, p);
    update(sibling.id, { title: "touched too" }, p);

    assert.deepEqual(read(sibling.id, p).labels, ["ready-for-agent"], "control: the same write does triage an unlabelled task");
    const now = read(handLabelled.id, p);
    assert.deepEqual(now.labels, ["needs-info"]);
    assert.equal(now.triagedBy, undefined);
  });

  it("removing a triage label the task does not carry leaves the auto label auto", () => {
    // A no-op removal decides nothing, so it must not quietly turn the store's label into a person's.
    const { p, task } = board();
    const t = task();
    issue.labels(t.id, { remove: ["wontfix"] }, p);
    assert.equal(read(t.id, p).triagedBy, "auto");

    update(t.id, { body: "" }, p);
    const now = read(t.id, p);
    assert.deepEqual(now.labels, ["needs-triage"], "still the store's label to change");
    assert.deepEqual(now.triageMissing, ["body"]);
  });

  it("holds through MCP tm_label", () => {
    const { p, task } = board();
    const t = task();
    assert.equal(read(t.id, p).triagedBy, "auto", "precondition: the sync owns this task's label");
    const res = handleRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tm_label", arguments: { id: t.id, add: ["ready-for-human"] } } },
      { p },
    );
    assert.deepEqual(JSON.parse(res.result.content[0].text).labels, ["ready-for-human"]);
    update(t.id, { title: "edited after" }, p);
    assert.deepEqual(read(t.id, p).labels, ["ready-for-human"]);
    assert.equal(read(t.id, p).triagedBy, undefined);
  });

  it("holds through the HTTP labels action and PATCH edit", () => {
    const { p, task } = board();
    const t = task();
    assert.equal(read(t.id, p).triagedBy, "auto", "precondition: the sync owns this task's label");
    handleWrite("POST", `/api/task/${t.id}/labels`, { add: ["wontfix"] }, { p });
    handleWrite("PATCH", `/api/task/${t.id}`, { title: "edited over http" }, { p });
    const now = read(t.id, p);
    assert.equal(now.title, "edited over http");
    assert.deepEqual(now.labels, ["wontfix"]);
    assert.equal(now.triagedBy, undefined);
  });
});

describe("settings catalog", () => {
  it("lists dispatch.autoReady in the Agent dispatch group, label by default", () => {
    const field = CATALOG.find((f) => f.key === "dispatch.autoReady");
    assert.ok(field, "dispatch.autoReady is in the catalog");
    assert.equal(field.group, "agents");
    assert.equal(field.type, "enum");
    assert.equal(field.default, "label");
    assert.deepEqual(field.options.map((o) => o.value), ["label", "off"]);
  });
});

describe("the CLI", () => {
  const tm = (p, ...args) => spawnSync(process.execPath, [TM, ...args], { env: { ...process.env, TM_ROOT: p.root }, encoding: "utf8" });

  /** Every file under the store, as bytes, so "writes nothing" is checked rather than assumed. */
  function snapshot(dir, out = new Map()) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) snapshot(full, out);
      else out.set(full, readFileSync(full));
    }
    return out;
  }

  it("tm task new --human files the task ready-for-human, set by a person", () => {
    const { p } = board();
    const res = tm(p, "task", "new", "needs a person", "--body", "context", "--ac", "a person looked", "--human");
    assert.equal(res.status, 0, res.stderr);
    const id = res.stdout.split(" ")[0];
    const t = read(id, p);
    assert.equal(t.title, "needs a person", "the flag is not baked into the title");
    assert.deepEqual(t.labels, ["ready-for-human"]);
    assert.equal(t.triagedBy, undefined, "sticky: the store will not re-triage it");
  });

  it("tm triage --dry-run lists what would change and writes nothing; --all applies it", () => {
    const { p, task } = board();
    writeConfig({ dispatch: { autoReady: "off" } }, p);
    const ready = task();
    const sparse = task({ acceptance: [] });
    const human = task({ labels: ["needs-info"] });
    writeConfig({ dispatch: { autoReady: "label" } }, p);

    const before = snapshot(p.base);
    const dry = tm(p, "triage", "--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    const lines = dry.stdout.trim().split("\n");
    assert.deepEqual(lines, [
      `${ready.id}: (none) → ready-for-agent`,
      `${sparse.id}: (none) → needs-triage (missing: acceptance criteria)`,
    ]);
    assert.equal(lines.some((l) => l.startsWith(human.id)), false, "a person's label is not a candidate");
    const afterDry = snapshot(p.base);
    assert.deepEqual([...afterDry.keys()], [...before.keys()], "no file added or removed");
    for (const [file, bytes] of before) assert.ok(bytes.equals(afterDry.get(file)), `${file} is byte-identical`);

    const applied = tm(p, "triage", "--all");
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(applied.stdout.trim().split("\n"), lines);
    assert.deepEqual(read(ready.id, p).labels, ["ready-for-agent"]);
    assert.deepEqual(read(sparse.id, p).labels, ["needs-triage"]);
    assert.deepEqual(read(human.id, p).labels, ["needs-info"]);

    const again = tm(p, "triage");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), "", "nothing left to change, so nothing listed");
  });

  it("tm triage covers open-column tasks by default; --all reaches the backlog too", () => {
    const { p, task } = board();
    writeConfig({ dispatch: { autoReady: "off" } }, p);
    const parked = task({ status: "backlog" });
    writeConfig({ dispatch: { autoReady: "label" } }, p);

    assert.equal(tm(p, "triage", "--dry-run").stdout.trim(), "", "backlog is not in the default sweep");
    assert.equal(tm(p, "triage", "--all", "--dry-run").stdout.trim(), `${parked.id}: (none) → ready-for-agent`);
  });

  it("tm triage refuses while dispatch.autoReady is off, rather than reporting nothing to change", () => {
    // Silence would read as "every task is already triaged" when the truth is "triage is disabled".
    const { p, task } = board();
    writeConfig({ dispatch: { autoReady: "off" } }, p);
    task();
    const res = tm(p, "triage", "--dry-run");
    assert.equal(res.status, 2, res.stdout);
    assert.match(res.stderr, /dispatch\.autoReady is off/);
  });

  it("tm triage refuses a flag it does not take", () => {
    const { p } = board();
    const res = tm(p, "triage", "--everything");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /unknown option --everything/);
  });

  it("tm help lists triage", () => {
    const { p } = board();
    assert.match(tm(p, "help").stdout, /triage \[--all\] \[--dry-run\]/);
  });
});
