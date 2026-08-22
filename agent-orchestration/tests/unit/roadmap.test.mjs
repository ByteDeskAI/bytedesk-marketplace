import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_SEED_TASK_IDS,
  RoadmapInventoryError,
  RoadmapSourceManifestError,
  RoadmapValidationError,
  appendRoadmapInventory,
  deriveRoadmapIndex,
  generateSourceManifest,
  parseRoadmap,
  refreshGeneratedViewsSource,
  renderAllGeneratedViews,
  renderGeneratedViews,
  validateRoadmap,
} from "../../scripts/roadmap.mjs";

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ROADMAP_PATH = join(PLUGIN_ROOT, "ROADMAP.md");
const ROADMAP_SOURCE = readFileSync(ROADMAP_PATH, "utf8");
const SOURCE_MANIFEST = JSON.parse(readFileSync(join(PLUGIN_ROOT, "ROADMAP-SOURCES.json"), "utf8"));
const ROADMAP_INVENTORY = JSON.parse(readFileSync(join(PLUGIN_ROOT, "ROADMAP-INVENTORY.json"), "utf8"));

function freshRoadmap() {
  return parseRoadmap(ROADMAP_SOURCE);
}

function record(parsed, kind, id) {
  const found = parsed.byKind[kind].find((entry) => entry.id === id);
  assert.ok(found, `fixture requires ${id}`);
  return found;
}

function addRecord(parsed, fence, value) {
  const kind = fence.slice("roadmap-".length);
  parsed.byKind[kind].push(value);
  parsed.entries.push({ fence, line: 1, record: value });
}

function removeRecord(parsed, kind, id) {
  parsed.byKind[kind] = parsed.byKind[kind].filter((entry) => entry.id !== id);
  parsed.entries = parsed.entries.filter((entry) => entry.record?.id !== id);
}

function removeUnlockFromSource(parsed, unlockId) {
  const unlock = record(parsed, "unlock", unlockId);
  const source = record(parsed, "task", unlock.from);
  source.unlockIds = source.unlockIds.filter((id) => id !== unlockId);
}

function addFutureTask(parsed, id = "AO-EXT-006") {
  const task = structuredClone(record(parsed, "task", "AO-EXT-005"));
  Object.assign(task, {
    id,
    capabilityKey: "task.extensibility.future-fixture",
    title: "Exercise a future extension seam",
    why: "Future capabilities must remain addable without strategic graph membership.",
    status: "planned",
    readiness: "gated",
    unlockIds: [],
  });
  addRecord(parsed, "roadmap-task", task);
  return task;
}

function connectFutureTaskWithEnhancement(parsed, task) {
  const edge = {
    schemaVersion: 1,
    kind: "unlock",
    id: "AO-U-097",
    from: task.id,
    to: "AO-GOAL-006",
    relation: "enhances",
    capabilityKey: "extensibility.future-fixture-enhancement",
    rationale: "Exercise a connected future roadmap addition.",
    verification: "The new task has one active incident edge without joining a trajectory.",
    helps: "Roadmap extensibility",
    why: "Append validation must distinguish valid additions from isolated records.",
    unlocks: "Optional future leverage for AO-GOAL-006.",
  };
  task.readiness = "ready";
  task.unlockIds = [edge.id];
  addRecord(parsed, "roadmap-unlock", edge);
  return edge;
}

function appendRecordToFence(source, fence, value) {
  const opening = `\`\`\`${fence}\n[`;
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `fixture requires ${fence}`);
  const closing = source.indexOf("\n]\n```", start);
  assert.notEqual(closing, -1, `fixture requires closing ${fence} array`);
  return `${source.slice(0, closing)},\n  ${JSON.stringify(value)}${source.slice(closing)}`;
}

function expectValidationIssues(mutate, patterns, options = {}) {
  const parsed = freshRoadmap();
  mutate(parsed);
  assert.throws(
    () => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, ...options }),
    (error) => {
      assert.ok(error instanceof RoadmapValidationError);
      assert.ok(error.issues.length > 0);
      const output = error.issues.join("\n");
      for (const pattern of patterns) assert.match(output, pattern);
      return true;
    },
  );
}

test("the checked-in roadmap is valid and preserves the canonical seed inventory", () => {
  const parsed = freshRoadmap();
  const index = validateRoadmap(parsed, { rootDir: PLUGIN_ROOT });

  assert.deepEqual(index.counts, {
    task: 55,
    unlock: 96,
    goal: 6,
    trajectory: 7,
    gap: 7,
  });
  for (const id of EXPECTED_SEED_TASK_IDS) assert.ok(parsed.byKind.task.some((task) => task.id === id), `missing seed task ${id}`);
  assert.deepEqual(
    parsed.byKind.task.filter((task) => task.readiness === "ready").map((task) => task.id).sort(),
    ["AO-ORK-001", "AO-RTR-002"],
  );
});

test("parsing, derived indexes, and generated views are deterministic", () => {
  const firstParsed = freshRoadmap();
  const secondParsed = freshRoadmap();
  assert.deepEqual(firstParsed.byKind, secondParsed.byKind);

  const firstIndex = deriveRoadmapIndex(firstParsed);
  const secondIndex = deriveRoadmapIndex(secondParsed);
  assert.deepEqual(firstIndex, secondIndex);

  const firstViews = renderGeneratedViews(firstParsed);
  const secondViews = renderGeneratedViews(secondParsed);
  assert.deepEqual(firstViews, secondViews);
  assert.match(firstViews.mermaid, /^```mermaid\nflowchart LR/m);
  for (const task of firstParsed.byKind.task) assert.match(firstViews.mermaid, new RegExp(`"${task.id}"`));
  for (const unlock of firstParsed.byKind.unlock.filter((edge) => edge.relation === "requires")) assert.match(firstViews.mermaid, new RegExp(unlock.from.replace(/^AO-|-/g, "")));
  for (const trajectory of firstParsed.byKind.trajectory) assert.match(firstViews.trajectoryTable, new RegExp(trajectory.id));
  for (const trajectory of firstParsed.byKind.trajectory) {
    const derived = firstIndex.trajectories[trajectory.id];
    assert.equal(derived.requiredTaskCount, trajectory.taskIds.length);
    assert.equal(derived.remainingTaskCount, derived.remainingTaskIds.length);
    assert.ok(derived.criticalPathHops >= derived.shortestPathHops);
    assert.equal(Object.hasOwn(derived, "hardHops"), false);
  }
  for (const derived of Object.values(firstIndex.tasks)) assert.equal(Object.hasOwn(derived, "unlocksGoals"), false);
});

test("hard dependency cycles report the explicit cycle path", () => {
  expectValidationIssues((parsed) => {
    const edge = {
      schemaVersion: 1,
      kind: "unlock",
      id: "AO-U-999",
      from: "AO-ORK-002",
      to: "AO-ORK-001",
      relation: "requires",
      capabilityKey: "fixture.hard-cycle",
      rationale: "Exercise cycle validation.",
      verification: "The validator reports the complete cycle.",
      helps: "Test coverage",
      why: "Hard dependency cycles must fail closed.",
      unlocks: "Nothing; this is invalid.",
    };
    addRecord(parsed, "roadmap-unlock", edge);
    record(parsed, "task", "AO-ORK-002").unlockIds.push(edge.id);
  }, [/Hard requires dependency cycle: AO-ORK-001 -> AO-ORK-002 -> AO-ORK-001/]);
});

test("task and outgoing unlock reciprocity cannot drift", () => {
  expectValidationIssues((parsed) => {
    const task = record(parsed, "task", "AO-ORK-001");
    task.unlockIds = task.unlockIds.filter((id) => id !== "AO-U-001");
  }, [/AO-ORK-001: unlockIds must exactly equal outgoing unlocks/, /AO-U-001/]);
});

test("a preferred one-hop trajectory is rejected with an actionable distance error", () => {
  expectValidationIssues((parsed) => {
    const trajectory = record(parsed, "trajectory", "AO-TRJ-005");
    trajectory.entryTaskIds = ["AO-REL-002"];
    trajectory.taskIds = ["AO-REL-002"];
    trajectory.unlockIds = ["AO-U-082"];
    trajectory.hopEstimate = { min: 1, max: 1 };
    const gap = record(parsed, "gap", "AO-GAP-005");
    gap.fromAnchorIds = ["AO-REL-002"];
  }, [/AO-TRJ-005\.hopEstimate must satisfy 2 <= min <= max/, /AO-TRJ-005: primary trajectory must have a reachable route of at least 2 hops/]);
});

test("orphan strategic references identify the missing object", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "goal", "AO-GOAL-004").preferredTrajectoryId = "AO-TRJ-999";
  }, [/AO-GOAL-004: preferred trajectory 'AO-TRJ-999' does not resolve/]);
});

test("duplicate live trajectories for one goal are rejected", () => {
  expectValidationIssues((parsed) => {
    const original = record(parsed, "trajectory", "AO-TRJ-005");
    const duplicate = structuredClone(original);
    duplicate.id = "AO-TRJ-999";
    duplicate.title = "Duplicate replay route fixture";
    duplicate.capabilityKey = "trajectory.replay.duplicate-fixture";
    duplicate.strategyKey = "duplicate-fixture";
    addRecord(parsed, "roadmap-trajectory", duplicate);
  }, [/AO-GOAL-004: live trajectories 'AO-TRJ-005' and 'AO-TRJ-999' have duplicate edge sets/]);
});

test("strategic records cannot grant agents execution or budget authority", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "goal", "AO-GOAL-004").runtimeAuthority = {
      agentId: "provider-controlled-agent",
      mayExecute: true,
      maySpendBudget: true,
    };
  }, [/AO-GOAL-004: strategic object encodes execution authority at 'runtimeAuthority'/]);
});

test("source seams must remain inside the plugin and identify real source", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "task", "AO-ORK-001").sourceSeams = ["../outside.mjs:1-1"];
  }, [/AO-ORK-001: source seam '\.\.\/outside\.mjs' escapes the plugin root/]);
});

test("source seam manifests support installed caches and detect source-checkout drift", () => {
  assert.doesNotThrow(() => validateRoadmap(freshRoadmap(), {
    rootDir: join(PLUGIN_ROOT, "fixture-installed-without-src"),
    sourceManifest: SOURCE_MANIFEST,
    roadmapInventory: ROADMAP_INVENTORY,
  }));

  const staleManifest = structuredClone(SOURCE_MANIFEST);
  staleManifest.files["src/cli.mjs"].sha256 = "0".repeat(64);
  assert.throws(
    () => validateRoadmap(freshRoadmap(), { rootDir: PLUGIN_ROOT, sourceManifest: staleManifest }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /source seam 'src\/cli\.mjs' does not match ROADMAP-SOURCES\.json/.test(issue)),
  );
});

test("source manifest generation is deterministic and matches the checked-in inventory", () => {
  const first = generateSourceManifest(freshRoadmap(), { rootDir: PLUGIN_ROOT });
  const second = generateSourceManifest(freshRoadmap(), { rootDir: PLUGIN_ROOT });
  assert.deepEqual(first, second);
  assert.deepEqual(first, SOURCE_MANIFEST);
  assert.equal(`${JSON.stringify(first, null, 2)}\n`, readFileSync(join(PLUGIN_ROOT, "ROADMAP-SOURCES.json"), "utf8"));
  assert.deepEqual(Object.keys(first.files), [...Object.keys(first.files)].sort());
});

test("source manifest generation fails closed for installed, missing, and invalid sources", () => {
  assert.throws(
    () => generateSourceManifest(freshRoadmap(), { rootDir: join(PLUGIN_ROOT, "fixture-installed-without-src") }),
    (error) => error instanceof RoadmapSourceManifestError
      && error.issues.some((issue) => /installed caches do not contain authoritative source/.test(issue)),
  );

  const missing = freshRoadmap();
  record(missing, "task", "AO-ORK-001").sourceSeams = ["src/does-not-exist.mjs:1-1"];
  assert.throws(
    () => generateSourceManifest(missing, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapSourceManifestError
      && error.issues.some((issue) => /Source seam file 'src\/does-not-exist\.mjs' is missing or unreadable/.test(issue)),
  );

  const escaping = freshRoadmap();
  record(escaping, "task", "AO-ORK-001").sourceSeams = ["../outside.mjs:1-1"];
  assert.throws(
    () => generateSourceManifest(escaping, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapSourceManifestError
      && error.issues.some((issue) => /source seam '\.\.\/outside\.mjs' escapes the plugin root/.test(issue)),
  );
});

test("mutating CLI commands use their plugin root and leave installed artifacts untouched", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ao-roadmap-refresh-"));
  const installed = join(root, "cache", "agent-orchestration");
  const decoyCwd = join(root, "decoy");
  try {
    mkdirSync(join(installed, "scripts"), { recursive: true });
    mkdirSync(join(decoyCwd, "src"), { recursive: true });
    for (const path of ["ROADMAP.md", "ROADMAP-SOURCES.json", "ROADMAP-INVENTORY.json", "scripts/roadmap.mjs"]) {
      cpSync(join(PLUGIN_ROOT, path), join(installed, path));
    }
    const protectedFiles = ["ROADMAP.md", "ROADMAP-SOURCES.json", "ROADMAP-INVENTORY.json"];
    const before = Object.fromEntries(protectedFiles.map((path) => [path, readFileSync(join(installed, path), "utf8")]));
    for (const command of ["--refresh-sources", "--refresh-views", "--append-inventory"]) {
      const result = spawnSync(process.execPath, [join(installed, "scripts", "roadmap.mjs"), command], {
        cwd: decoyCwd,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /installed caches are read-only/);
      for (const path of protectedFiles) assert.equal(readFileSync(join(installed, path), "utf8"), before[path]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a disconnected preferred route cannot masquerade as a materialized trajectory", () => {
  expectValidationIssues((parsed) => {
    const trajectory = record(parsed, "trajectory", "AO-TRJ-005");
    trajectory.unlockIds = trajectory.unlockIds.filter((id) => id !== "AO-U-082");
  }, [/AO-TRJ-005: primary trajectory must have a reachable route of at least 2 hops/]);
});

test("checked-in Mermaid and trajectory views cannot drift from canonical records", () => {
  const missingEdge = ROADMAP_SOURCE.replace("  ORK001 --> ORK002\n", "");
  assert.throws(
    () => validateRoadmap(missingEdge, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /Delivery Mermaid hard edges drifted.*AO-ORK-001->AO-ORK-002/.test(issue)),
  );

  const currentRow = renderGeneratedViews(freshRoadmap()).trajectoryTable
    .split("\n")
    .find((line) => line.startsWith("| AO-TRJ-005 |"));
  const staleIndex = ROADMAP_SOURCE.replace(currentRow, currentRow.replace("| 6 | 6 |", "| 6 | 99 |"));
  assert.throws(
    () => validateRoadmap(staleIndex, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.includes("Generated trajectory index drifted; regenerate it from renderGeneratedViews()."),
  );

  const missingStrategicRelation = ROADMAP_SOURCE.replace("  TRJ005 --> GAP005\n", "");
  assert.throws(
    () => validateRoadmap(missingStrategicRelation, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.includes("Strategic overview Mermaid is missing strategic relation AO-TRJ-005->AO-GAP-005."),
  );
});

test("unknown multi-hop distance remains valid for research trajectories and gaps", () => {
  const parsed = freshRoadmap();
  record(parsed, "trajectory", "AO-TRJ-002").hopEstimate.max = null;
  record(parsed, "gap", "AO-GAP-002").hopEstimate.max = null;
  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
});

test("approved strategy records require explicit human approval provenance", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "goal", "AO-GOAL-004").approvalProvenance = null;
    record(parsed, "trajectory", "AO-TRJ-005").approvalProvenance.actorType = "agent";
  }, [
    /AO-GOAL-004\.approvalProvenance must be a human approvalProvenance object for approved records/,
    /AO-TRJ-005\.approvalProvenance\.actorType must be 'human'/,
  ]);
  assert.equal(record(freshRoadmap(), "trajectory", "AO-TRJ-002").approvalProvenance, null);
});

test("retired or invalidated trajectories cannot remain preferred", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").epistemicState = "invalidated";
  }, [/AO-GOAL-004: preferred trajectory is retired or invalidated/]);
});

test("gap materialization and evidence must match lifecycle state", () => {
  expectValidationIssues((parsed) => {
    const gap = record(parsed, "gap", "AO-GAP-005");
    gap.filledByIds = [];
    gap.evidence = [];
  }, [
    /AO-GAP-005: partially-filled gaps require at least one filledById/,
    /AO-GAP-005: evidence must be a non-empty string array/,
  ]);
});

test("realized trajectories and attained goals require completed, validated evidence", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").materializationState = "realized";
    record(parsed, "goal", "AO-GOAL-004").attainmentState = "attained";
  }, [
    /AO-TRJ-005: realized trajectories must be approved and epistemically validated/,
    /AO-TRJ-005: realized trajectory has incomplete tasks/,
    /AO-TRJ-005: realized trajectory has unresolved gaps/,
    /AO-GOAL-004: attained goals require non-empty attainmentEvidence/,
  ]);
});

test("trajectory selections admit only hard and bridge edges", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").unlockIds.push("AO-U-087");
  }, [/AO-TRJ-005: selected unlock 'AO-U-087' must be requires or bridge, not 'enhances'/]);
});

test("trajectory roots, reachability, and global hard prerequisites are enforced", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").entryTaskIds.push("AO-REL-001");
  }, [/AO-TRJ-005: entryTaskIds must exactly equal selected-subgraph roots/]);

  expectValidationIssues((parsed) => {
    const trajectory = record(parsed, "trajectory", "AO-TRJ-001");
    trajectory.unlockIds = trajectory.unlockIds.filter((id) => id !== "AO-U-039");
  }, [/AO-TRJ-001: non-entry member 'AO-TUX-004' must include global hard prerequisite 'AO-U-039'/]);
});

test("task counts and preferred estimates must fit declared ranges", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").hopEstimate = { min: 7, max: 8 };
  }, [/AO-TRJ-005: 6 required tasks must fit hopEstimate 7-8/]);

  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").hopEstimate.max = 99;
  }, [/AO-GOAL-004: preferred trajectory hopEstimate 6-99 must fit horizon 4-8/]);
});

test("append-only inventory preserves every ID and kind-specific identity", () => {
  const deleted = freshRoadmap();
  removeUnlockFromSource(deleted, "AO-U-087");
  removeRecord(deleted, "unlock", "AO-U-087");
  assert.throws(
    () => appendRoadmapInventory(deleted, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /Cannot remove immutable unlock ID 'AO-U-087'/.test(issue)),
  );
  assert.throws(
    () => validateRoadmap(deleted, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /Immutable roadmap inventory ID 'AO-U-087' \(unlock\) must be preserved/.test(issue)),
  );

  const repurposedTask = freshRoadmap();
  record(repurposedTask, "task", "AO-ORK-001").capabilityKey = "task.orchestration.repurposed-fixture";
  assert.throws(
    () => appendRoadmapInventory(repurposedTask, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /Cannot repurpose task ID 'AO-ORK-001'/.test(issue)),
  );

  for (const field of ["from", "relation"]) {
    const repurposedUnlock = freshRoadmap();
    record(repurposedUnlock, "unlock", "AO-U-087")[field] = field === "from" ? "AO-TUX-004" : "requires";
    assert.throws(
      () => appendRoadmapInventory(repurposedUnlock, ROADMAP_INVENTORY),
      (error) => error instanceof RoadmapInventoryError
        && error.issues.some((issue) => /Cannot repurpose unlock ID 'AO-U-087'/.test(issue)),
    );
  }
});

test("inventory appends only contiguous namespace suffixes and unions valid additions", () => {
  const hole = freshRoadmap();
  addFutureTask(hole, "AO-EXT-007");
  assert.throws(
    () => appendRoadmapInventory(hole, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /Cannot append non-contiguous task ID 'AO-EXT-007'; expected suffix 006/.test(issue)),
  );

  const parsed = freshRoadmap();
  addFutureTask(parsed);
  const edge = {
    schemaVersion: 1,
    kind: "unlock",
    id: "AO-U-097",
    from: "AO-EXT-005",
    to: "AO-EXT-006",
    relation: "requires",
    capabilityKey: "extensibility.future-fixture-dependency",
    rationale: "Exercise append-only inventory growth.",
    verification: "The next task and unlock suffixes append without rewriting history.",
    helps: "Roadmap extensibility",
    why: "New roadmap records need stable, monotonically assigned identities.",
    unlocks: "AO-EXT-006 readiness.",
  };
  addRecord(parsed, "roadmap-unlock", edge);
  record(parsed, "task", edge.from).unlockIds.push(edge.id);
  const inventory = appendRoadmapInventory(parsed, ROADMAP_INVENTORY);
  assert.equal(inventory.records.task.some((entry) => entry.id === "AO-EXT-006"), true);
  assert.equal(inventory.records.unlock.at(-1).id, "AO-U-097");
  assert.doesNotThrow(() => validateRoadmap(parsed, {
    rootDir: PLUGIN_ROOT,
    roadmapInventory: inventory,
    skipCheckedViews: true,
  }));
});

test("future tasks need an active incident edge but no trajectory membership", () => {
  const isolated = freshRoadmap();
  addFutureTask(isolated);
  assert.throws(
    () => appendRoadmapInventory(isolated, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /AO-EXT-006: post-seed tasks require at least one incident active unlock edge/.test(issue)),
  );

  const connected = freshRoadmap();
  addFutureTask(connected);
  const edge = {
    schemaVersion: 1,
    kind: "unlock",
    id: "AO-U-097",
    from: "AO-EXT-005",
    to: "AO-EXT-006",
    relation: "requires",
    capabilityKey: "extensibility.future-fixture-dependency",
    rationale: "Connect the future task without selecting it strategically.",
    verification: "The future task remains valid outside every trajectory.",
    helps: "Roadmap extensibility",
    why: "The task DAG must remain extensible independently of today's strategy views.",
    unlocks: "AO-EXT-006 readiness.",
  };
  addRecord(connected, "roadmap-unlock", edge);
  record(connected, "task", edge.from).unlockIds.push(edge.id);
  const inventory = appendRoadmapInventory(connected, ROADMAP_INVENTORY);
  assert.equal(connected.byKind.trajectory.some((trajectory) => trajectory.taskIds.includes("AO-EXT-006")), false);
  assert.doesNotThrow(() => validateRoadmap(connected, {
    rootDir: PLUGIN_ROOT,
    roadmapInventory: inventory,
    skipCheckedViews: true,
  }));
});

test("inventory append validates prospective roadmap semantics without mutating its input", () => {
  const before = `${JSON.stringify(ROADMAP_INVENTORY, null, 2)}\n`;

  const invalidIdentity = freshRoadmap();
  const invalidTask = addFutureTask(invalidIdentity);
  connectFutureTaskWithEnhancement(invalidIdentity, invalidTask);
  invalidTask.category = "";
  assert.throws(
    () => appendRoadmapInventory(invalidIdentity, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /AO-EXT-006: category must be a non-empty string/.test(issue)),
  );
  assert.equal(`${JSON.stringify(ROADMAP_INVENTORY, null, 2)}\n`, before);

  const isolated = freshRoadmap();
  addFutureTask(isolated);
  assert.throws(
    () => appendRoadmapInventory(isolated, ROADMAP_INVENTORY),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /AO-EXT-006: post-seed tasks require at least one incident active unlock edge/.test(issue)),
  );
  assert.equal(`${JSON.stringify(ROADMAP_INVENTORY, null, 2)}\n`, before);

  const valid = freshRoadmap();
  const validTask = addFutureTask(valid);
  connectFutureTaskWithEnhancement(valid, validTask);
  const prospective = appendRoadmapInventory(valid, ROADMAP_INVENTORY);
  assert.equal(prospective.records.task.some((entry) => entry.id === validTask.id), true);
  assert.equal(prospective.records.unlock.some((entry) => entry.id === "AO-U-097"), true);
  assert.equal(`${JSON.stringify(ROADMAP_INVENTORY, null, 2)}\n`, before);
});

test("append-inventory CLI writes only a fully validated prospective inventory", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ao-roadmap-prospective-"));
  const plugin = join(root, "agent-orchestration");
  try {
    mkdirSync(join(plugin, "scripts"), { recursive: true });
    cpSync(join(PLUGIN_ROOT, "src"), join(plugin, "src"), { recursive: true });
    for (const path of ["ROADMAP.md", "ROADMAP-INVENTORY.json", "ROADMAP-SOURCES.json", "scripts/roadmap.mjs"]) {
      cpSync(join(PLUGIN_ROOT, path), join(plugin, path));
    }
    const inventoryPath = join(plugin, "ROADMAP-INVENTORY.json");
    const inventoryBefore = readFileSync(inventoryPath, "utf8");
    const sourceManifestBefore = readFileSync(join(plugin, "ROADMAP-SOURCES.json"), "utf8");

    const invalidParsed = freshRoadmap();
    const invalidTask = addFutureTask(invalidParsed);
    connectFutureTaskWithEnhancement(invalidParsed, invalidTask);
    invalidTask.category = "";
    let invalidSource = ROADMAP_SOURCE;
    invalidSource = appendRecordToFence(invalidSource, "roadmap-task", invalidTask);
    invalidSource = appendRecordToFence(invalidSource, "roadmap-unlock", record(invalidParsed, "unlock", "AO-U-097"));
    writeFileSync(join(plugin, "ROADMAP.md"), invalidSource);
    const rejected = spawnSync(process.execPath, [join(plugin, "scripts", "roadmap.mjs"), "--append-inventory", "ROADMAP.md"], {
      cwd: plugin,
      encoding: "utf8",
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /category must be a non-empty string/);
    assert.equal(readFileSync(inventoryPath, "utf8"), inventoryBefore);

    const validParsed = freshRoadmap();
    const validTask = addFutureTask(validParsed);
    connectFutureTaskWithEnhancement(validParsed, validTask);
    let validSource = ROADMAP_SOURCE;
    validSource = appendRecordToFence(validSource, "roadmap-task", validTask);
    validSource = appendRecordToFence(validSource, "roadmap-unlock", record(validParsed, "unlock", "AO-U-097"));
    writeFileSync(join(plugin, "ROADMAP.md"), validSource);
    const servicePath = join(plugin, "src", "service.mjs");
    writeFileSync(servicePath, `${readFileSync(servicePath, "utf8")}\n`);
    const accepted = spawnSync(process.execPath, [join(plugin, "scripts", "roadmap.mjs"), "--append-inventory", "ROADMAP.md"], {
      cwd: plugin,
      encoding: "utf8",
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    const appended = JSON.parse(readFileSync(inventoryPath, "utf8"));
    assert.equal(appended.records.task.some((entry) => entry.id === "AO-EXT-006"), true);
    assert.equal(appended.records.unlock.some((entry) => entry.id === "AO-U-097"), true);
    assert.equal(readFileSync(join(plugin, "ROADMAP-SOURCES.json"), "utf8"), sourceManifestBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("documented maintenance sequence handles new IDs plus source drift end to end", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ao-roadmap-sequence-"));
  const plugin = join(root, "agent-orchestration");
  const runCli = (command) => spawnSync(
    process.execPath,
    [join(plugin, "scripts", "roadmap.mjs"), command, "ROADMAP.md"],
    { cwd: plugin, encoding: "utf8" },
  );
  try {
    mkdirSync(join(plugin, "scripts"), { recursive: true });
    cpSync(join(PLUGIN_ROOT, "src"), join(plugin, "src"), { recursive: true });
    for (const path of ["ROADMAP.md", "ROADMAP-INVENTORY.json", "ROADMAP-SOURCES.json", "scripts/roadmap.mjs"]) {
      cpSync(join(PLUGIN_ROOT, path), join(plugin, path));
    }
    const roadmapPath = join(plugin, "ROADMAP.md");
    const inventoryPath = join(plugin, "ROADMAP-INVENTORY.json");
    const sourceManifestPath = join(plugin, "ROADMAP-SOURCES.json");
    const sourceManifestBefore = readFileSync(sourceManifestPath, "utf8");
    assert.equal(runCli("--check").status, 0, "pre-edit check must establish a green floor");

    const edited = freshRoadmap();
    const task = addFutureTask(edited);
    connectFutureTaskWithEnhancement(edited, task);
    let editedSource = ROADMAP_SOURCE;
    editedSource = appendRecordToFence(editedSource, "roadmap-task", task);
    editedSource = appendRecordToFence(editedSource, "roadmap-unlock", record(edited, "unlock", "AO-U-097"));
    writeFileSync(roadmapPath, editedSource);
    const servicePath = join(plugin, "src", "service.mjs");
    writeFileSync(servicePath, `${readFileSync(servicePath, "utf8")}\n`);

    const beforeAppend = runCli("--check");
    assert.equal(beforeAppend.status, 1);
    assert.match(beforeAppend.stderr, /must be appended to ROADMAP-INVENTORY\.json/);
    const appended = runCli("--append-inventory");
    assert.equal(appended.status, 0, appended.stderr);
    const prospectiveInventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    assert.equal(prospectiveInventory.records.task.some((entry) => entry.id === "AO-EXT-006"), true);
    assert.equal(prospectiveInventory.records.unlock.some((entry) => entry.id === "AO-U-097"), true);
    assert.equal(readFileSync(sourceManifestPath, "utf8"), sourceManifestBefore);

    const beforeViews = runCli("--check");
    assert.equal(beforeViews.status, 1);
    assert.match(beforeViews.stderr, /source seam 'src\/service\.mjs' does not match ROADMAP-SOURCES\.json/);
    assert.match(beforeViews.stderr, /Delivery Mermaid task nodes drifted/);
    const refreshedViews = runCli("--refresh-views");
    assert.equal(refreshedViews.status, 0, refreshedViews.stderr);
    const refreshedSource = readFileSync(roadmapPath, "utf8");
    assert.match(refreshedSource, /EXT006\["AO-EXT-006"\]/);
    assert.match(refreshedSource, /class [^\n]*EXT006[^\n]* ready/);
    assert.equal(readFileSync(sourceManifestPath, "utf8"), sourceManifestBefore);
    const refreshedParsed = parseRoadmap(refreshedSource);
    const prospectiveSourceManifest = generateSourceManifest(refreshedParsed, { rootDir: plugin });
    assert.doesNotThrow(() => validateRoadmap(refreshedParsed, {
      rootDir: plugin,
      roadmapInventory: prospectiveInventory,
      sourceManifest: prospectiveSourceManifest,
    }));

    const beforeSources = runCli("--check");
    assert.equal(beforeSources.status, 1);
    assert.match(beforeSources.stderr, /source seam 'src\/service\.mjs' does not match ROADMAP-SOURCES\.json/);
    assert.doesNotMatch(beforeSources.stderr, /Mermaid.*drifted|Generated trajectory index drifted/);
    const refreshedSources = runCli("--refresh-sources");
    assert.equal(refreshedSources.status, 0, refreshedSources.stderr);
    const finalManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    assert.notEqual(finalManifest.files["src/service.mjs"].sha256, JSON.parse(sourceManifestBefore).files["src/service.mjs"].sha256);
    assert.deepEqual(finalManifest, generateSourceManifest(parseRoadmap(readFileSync(roadmapPath, "utf8")), { rootDir: plugin }));
    const finalCheck = runCli("--check");
    assert.equal(finalCheck.status, 0, finalCheck.stderr);

    const invalidSource = readFileSync(roadmapPath, "utf8").replace(
      '"title":"Exercise a future extension seam","category":"Extensibility"',
      '"title":"Exercise a future extension seam","category":""',
    );
    assert.notEqual(invalidSource, readFileSync(roadmapPath, "utf8"));
    writeFileSync(roadmapPath, invalidSource);
    const beforeRejectedRefresh = readFileSync(roadmapPath, "utf8");
    const rejectedRefresh = runCli("--refresh-views");
    assert.equal(rejectedRefresh.status, 1);
    assert.match(rejectedRefresh.stderr, /category must be a non-empty string/);
    assert.equal(readFileSync(roadmapPath, "utf8"), beforeRejectedRefresh);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gap fillers are reciprocal, goal-local lineage owned by the parent trajectory", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "gap", "AO-GAP-007").filledByIds.push("AO-TRJ-001");
  }, [
    /AO-GAP-007: trajectory filler 'AO-TRJ-001' must target goal 'AO-GOAL-006'/,
    /AO-GAP-007: trajectory filler 'AO-TRJ-001' must declare parentGapId 'AO-GAP-007'/,
  ], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-002").parentGapId = "AO-GAP-001";
    record(parsed, "gap", "AO-GAP-002").filledByIds.push("AO-TRJ-002");
  }, [
    /AO-GAP-002: trajectory filler 'AO-TRJ-002' must declare parentGapId 'AO-GAP-002'/,
    /AO-TRJ-002: parent gap 'AO-GAP-001' must reciprocally list it/,
  ], { skipCheckedViews: true });

  const valid = freshRoadmap();
  record(valid, "trajectory", "AO-TRJ-002").parentGapId = "AO-GAP-001";
  record(valid, "gap", "AO-GAP-001").filledByIds.push("AO-TRJ-002");
  assert.doesNotThrow(() => validateRoadmap(valid, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
});

test("filled gaps require completed fillers, exact completion evidence, and cleared nextGapId", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "gap", "AO-GAP-007").state = "filled";
  }, [
    /AO-GAP-007: filled gaps require completionEvidence with exactly exitCriterion and evidenceRefs/,
    /AO-GAP-007: filled gap task filler 'AO-EXT-005' must have status done/,
    /AO-TRJ-007: nextGapId may reference only an unresolved open, researching, or partially-filled gap/,
  ], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const gap = record(parsed, "gap", "AO-GAP-005");
    gap.state = "filled";
    gap.completionEvidence = { exitCriterion: "paraphrased", evidenceRefs: ["fixture://replay"] };
    record(parsed, "trajectory", "AO-TRJ-005").nextGapId = null;
  }, [/AO-GAP-005: completionEvidence.exitCriterion must preserve the gap exitCriterion verbatim/], { skipCheckedViews: true });
});

test("operational strategic state always rests on an approved human decision", () => {
  expectValidationIssues((parsed) => {
    const preferred = record(parsed, "trajectory", "AO-TRJ-001");
    preferred.decisionState = "proposed";
    preferred.approvalProvenance = null;
  }, [/AO-GOAL-001: approved goal requires an approved preferred trajectory/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const goal = record(parsed, "goal", "AO-GOAL-001");
    goal.decisionState = "proposed";
    goal.attainmentState = "active";
    goal.approvalProvenance = null;
  }, [/AO-GOAL-001: active, paused, or attained goals require decisionState approved/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const trajectory = record(parsed, "trajectory", "AO-TRJ-001");
    trajectory.decisionState = "proposed";
    trajectory.materializationState = "active";
    trajectory.approvalProvenance = null;
  }, [/AO-TRJ-001: active or realized materialization requires decisionState approved/], { skipCheckedViews: true });
});

test("done tasks require completion evidence distinct from baseline evidence", () => {
  expectValidationIssues((parsed) => {
    const task = record(parsed, "task", "AO-RTR-002");
    task.status = "done";
    task.readiness = "done";
  }, [/AO-RTR-002: done tasks require non-empty completionEvidence/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const task = record(parsed, "task", "AO-RTR-002");
    task.status = "done";
    task.readiness = "done";
    task.completionEvidence = [task.evidence[0]];
  }, [/AO-RTR-002: completionEvidence must be distinct from baseline evidence/], { skipCheckedViews: true });

  const parsed = freshRoadmap();
  const task = record(parsed, "task", "AO-RTR-002");
  task.status = "done";
  task.readiness = "done";
  task.completionEvidence = ["fixture://capability-card-conformance"];
  record(parsed, "task", "AO-EXT-001").readiness = "ready";
  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
});

test("hop ranges reject alternate or extra field shapes", () => {
  expectValidationIssues((parsed) => {
    record(parsed, "goal", "AO-GOAL-004").horizon.min = 4;
  }, [/AO-GOAL-004\.horizon must contain exactly minHops and maxHops/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    record(parsed, "trajectory", "AO-TRJ-005").hopEstimate.minHops = 6;
  }, [/AO-TRJ-005\.hopEstimate must contain exactly min and max/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    record(parsed, "gap", "AO-GAP-005").hopEstimate.confidence = 0.8;
  }, [/AO-GAP-005\.hopEstimate must contain exactly min and max/], { skipCheckedViews: true });
});

test("object source seams must use anchors that occur exactly once", () => {
  const parsed = freshRoadmap();
  record(parsed, "task", "AO-ORK-001").sourceSeams = [{ path: "src/service.mjs", anchor: "return" }];
  assert.throws(
    () => generateSourceManifest(parsed, { rootDir: PLUGIN_ROOT }),
    (error) => error instanceof RoadmapSourceManifestError
      && error.issues.some((issue) => /Anchor 'return' must occur exactly once/.test(issue)),
  );
});

test("canonical generated views recover every stale marked projection", () => {
  const parsed = freshRoadmap();
  const views = renderAllGeneratedViews(parsed);
  assert.equal(views.deliveryMermaid, renderGeneratedViews(parsed).mermaid);
  assert.match(views.printable, /AO-TRJ-007/);
  assert.match(views.printable, /Unresolved gaps/);

  let stale = ROADMAP_SOURCE.replace("  ORK001 --> ORK002\n", "");
  stale = stale.replace("  TRJ005 --> GAP005\n", "");
  stale = stale.replace("| AO-TRJ-005 | AO-GOAL-004 |", "| AO-TRJ-005 | AO-GOAL-999 |");
  const refreshed = refreshGeneratedViewsSource(stale);
  assert.notEqual(refreshed, stale);
  assert.doesNotThrow(() => validateRoadmap(refreshed, { rootDir: PLUGIN_ROOT }));
  for (const marker of [
    "ROADMAP_DELIVERY_MERMAID",
    "ROADMAP_STRATEGIC_MERMAID",
    "ROADMAP_PER_GOAL_MERMAID",
    "ROADMAP_TRAJECTORY_INDEX",
  ]) {
    assert.match(refreshed, new RegExp(`<!-- ${marker}_START -->[\\s\\S]*<!-- ${marker}_END -->`));
  }
});

test("CLI accepts only the canonical roadmap path and prints stale canonical views", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ao-roadmap-path-"));
  const outside = join(root, "outside.md");
  const alias = join(PLUGIN_ROOT, ".roadmap-test-alias.md");
  try {
    writeFileSync(outside, ROADMAP_SOURCE);
    symlinkSync(ROADMAP_PATH, alias);
    for (const path of [outside, alias]) {
      const result = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "roadmap.mjs"), "--check", path], {
        cwd: PLUGIN_ROOT,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Roadmap path must be canonical plugin file/);
    }
    const printed = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "roadmap.mjs"), "--print-views", ROADMAP_PATH], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /flowchart LR/);
    assert.match(printed.stdout, /AO-TRJ-007/);
    assert.match(printed.stdout, /Unresolved gaps/);
  } finally {
    rmSync(alias, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("trajectory reachability derives from the full declared gap set and lifecycle", () => {
  const partial = freshRoadmap();
  let derived = deriveRoadmapIndex(partial).trajectories["AO-TRJ-005"];
  assert.equal(derived.state, "bridged");
  assert.deepEqual(derived.unresolvedGapIds, ["AO-GAP-005"]);
  assert.equal(derived.unresolvedGapCount, 1);

  const filled = freshRoadmap();
  record(filled, "gap", "AO-GAP-005").state = "filled";
  derived = deriveRoadmapIndex(filled).trajectories["AO-TRJ-005"];
  assert.equal(derived.state, "reachable");
  assert.deepEqual(derived.unresolvedGapIds, []);

  const invalidated = freshRoadmap();
  record(invalidated, "gap", "AO-GAP-005").state = "invalidated";
  derived = deriveRoadmapIndex(invalidated).trajectories["AO-TRJ-005"];
  assert.equal(derived.state, "unreachable");
  assert.equal(derived.shortestPathHops, null);

  const multiple = freshRoadmap();
  record(multiple, "trajectory", "AO-TRJ-005").gapIds.push("AO-GAP-006");
  derived = deriveRoadmapIndex(multiple).trajectories["AO-TRJ-005"];
  assert.deepEqual(derived.unresolvedGapIds, ["AO-GAP-005", "AO-GAP-006"]);
  assert.equal(derived.unresolvedGapCount, 2);

  const retired = freshRoadmap();
  record(retired, "trajectory", "AO-TRJ-005").decisionState = "rejected";
  derived = deriveRoadmapIndex(retired).trajectories["AO-TRJ-005"];
  assert.equal(derived.state, "retired");
  assert.equal(derived.shortestPathHops, null);
});

test("same-kind supersession permits acyclic chains to a live terminal", () => {
  const parsed = freshRoadmap();
  for (const [id, replacement] of [["AO-U-087", "AO-U-088"], ["AO-U-088", "AO-U-089"]]) {
    const unlock = record(parsed, "unlock", id);
    unlock.lifecycleState = "superseded";
    unlock.supersededById = replacement;
    removeUnlockFromSource(parsed, id);
  }
  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));

  const cycle = structuredClone(parsed);
  const terminal = record(cycle, "unlock", "AO-U-089");
  terminal.lifecycleState = "superseded";
  terminal.supersededById = "AO-U-087";
  removeUnlockFromSource(cycle, "AO-U-089");
  assert.throws(
    () => validateRoadmap(cycle, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /unlock supersession cycle detected/.test(issue)),
  );

  const missingTerminal = freshRoadmap();
  record(missingTerminal, "unlock", "AO-U-089").lifecycleState = "superseded";
  removeUnlockFromSource(missingTerminal, "AO-U-089");
  assert.throws(
    () => validateRoadmap(missingTerminal, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /AO-U-089: superseded unlock requires supersededById/.test(issue)),
  );
});

test("active projections ignore superseded history while retired routes retain it", () => {
  const operational = freshRoadmap();
  const edge = record(operational, "unlock", "AO-U-015");
  edge.lifecycleState = "superseded";
  edge.supersededById = "AO-U-087";
  removeUnlockFromSource(operational, edge.id);
  record(operational, "task", "AO-COL-004").readiness = "ready";
  assert.doesNotThrow(() => validateRoadmap(operational, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
  assert.deepEqual(deriveRoadmapIndex(operational).tasks["AO-COL-004"].directlyRequires, []);

  const historical = freshRoadmap();
  const historicalTrajectory = record(historical, "trajectory", "AO-TRJ-002");
  historicalTrajectory.decisionState = "rejected";
  const historicalEdge = record(historical, "unlock", "AO-U-036");
  historicalEdge.lifecycleState = "superseded";
  historicalEdge.supersededById = "AO-U-087";
  removeUnlockFromSource(historical, historicalEdge.id);
  assert.doesNotThrow(() => validateRoadmap(historical, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
  assert.equal(deriveRoadmapIndex(historical).trajectories["AO-TRJ-002"].state, "retired");
  assert.equal(historicalTrajectory.unlockIds.includes("AO-U-036"), true);
});

test("history-only reverse edges cannot introduce an operational dependency cycle", () => {
  const parsed = freshRoadmap();
  addRecord(parsed, "roadmap-unlock", {
    schemaVersion: 1,
    kind: "unlock",
    id: "AO-U-097",
    from: "AO-COL-004",
    to: "AO-COL-003",
    relation: "requires",
    capabilityKey: "collaboration.superseded-reverse-fixture",
    lifecycleState: "superseded",
    supersededById: "AO-U-087",
    rationale: "Represent a historical dependency opposite the active path.",
    verification: "Operational DAG validation ignores the superseded edge.",
    helps: "Lifecycle projection tests",
    why: "Historical dependency records must not corrupt current planning.",
    unlocks: "Nothing operational; it is history only.",
  });
  const inventory = appendRoadmapInventory(parsed, ROADMAP_INVENTORY);
  assert.doesNotThrow(() => validateRoadmap(parsed, {
    rootDir: PLUGIN_ROOT,
    roadmapInventory: inventory,
    skipCheckedViews: true,
  }));
  assert.equal(deriveRoadmapIndex(parsed).tasks["AO-COL-003"].directlyRequires.includes("AO-COL-004"), false);
});

test("live routes reject history-only selections and active edges reject superseded endpoints", () => {
  expectValidationIssues((parsed) => {
    const edge = record(parsed, "unlock", "AO-U-036");
    edge.lifecycleState = "superseded";
    edge.supersededById = "AO-U-087";
    removeUnlockFromSource(parsed, edge.id);
  }, [/AO-TRJ-002: selected unlock 'AO-U-036' is superseded and history-only/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const task = record(parsed, "task", "AO-TUX-005");
    task.status = "superseded";
    task.supersededById = "AO-TUX-006";
  }, [/active unlock cannot originate from superseded task 'AO-TUX-005'/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    record(parsed, "gap", "AO-GAP-002").state = "invalidated";
    record(parsed, "trajectory", "AO-TRJ-002").nextGapId = null;
  }, [/AO-TRJ-002: selected gap 'AO-GAP-002' is retired and history-only/], { skipCheckedViews: true });
});

test("superseded gaps remain reciprocal history on retired trajectories", () => {
  const parsed = freshRoadmap();
  const trajectory = record(parsed, "trajectory", "AO-TRJ-002");
  trajectory.decisionState = "rejected";
  trajectory.nextGapId = null;
  const gap = record(parsed, "gap", "AO-GAP-002");
  gap.state = "superseded";
  gap.supersededById = "AO-GAP-001";
  const bridge = record(parsed, "unlock", "AO-U-079");
  bridge.lifecycleState = "superseded";
  bridge.supersededById = "AO-U-078";
  removeUnlockFromSource(parsed, bridge.id);
  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
  assert.equal(trajectory.gapIds.includes(gap.id), true);
  assert.equal(deriveRoadmapIndex(parsed).trajectories[trajectory.id].state, "retired");
});

test("retired goals may retain their retired preferred trajectory as history", () => {
  const parsed = freshRoadmap();
  const goal = record(parsed, "goal", "AO-GOAL-001");
  goal.decisionState = "rejected";
  goal.approvalProvenance = null;
  const trajectory = record(parsed, "trajectory", "AO-TRJ-001");
  trajectory.decisionState = "rejected";
  trajectory.approvalProvenance = null;
  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
  assert.equal(goal.preferredTrajectoryId, trajectory.id);
  assert.equal(deriveRoadmapIndex(parsed).trajectories[trajectory.id].state, "retired");
});

test("capability keys are globally unique across roadmap record kinds", () => {
  const parsed = freshRoadmap();
  const collision = record(parsed, "goal", "AO-GOAL-004").capabilityKey;
  record(parsed, "unlock", "AO-U-087").capabilityKey = collision;
  const inventory = structuredClone(ROADMAP_INVENTORY);
  inventory.records.unlock.find((entry) => entry.id === "AO-U-087").capabilityKey = collision;

  assert.throws(
    () => validateRoadmap(parsed, {
      rootDir: PLUGIN_ROOT,
      roadmapInventory: inventory,
      skipCheckedViews: true,
    }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /global capabilityKey 'goal\.replay-time-travel'.*AO-GOAL-004.*AO-U-087/.test(issue)),
  );
});

test("inventory schema and append reject cross-kind capability collisions", () => {
  const parsed = freshRoadmap();
  const collision = record(parsed, "goal", "AO-GOAL-004").capabilityKey;
  record(parsed, "unlock", "AO-U-087").capabilityKey = collision;
  const inventory = structuredClone(ROADMAP_INVENTORY);
  inventory.records.unlock.find((entry) => entry.id === "AO-U-087").capabilityKey = collision;

  assert.throws(
    () => appendRoadmapInventory(parsed, inventory),
    (error) => error instanceof RoadmapInventoryError
      && error.issues.some((issue) => /global capabilityKey 'goal\.replay-time-travel'.*goal 'AO-GOAL-004'.*unlock 'AO-U-087'/.test(issue)),
  );
});

test("supersession chains may traverse retired records but must terminate live", () => {
  const parsed = freshRoadmap();
  const first = record(parsed, "gap", "AO-GAP-001");
  first.state = "superseded";
  first.supersededById = "AO-GAP-002";
  const middle = record(parsed, "gap", "AO-GAP-002");
  middle.state = "invalidated";
  middle.supersededById = "AO-GAP-003";
  for (const trajectoryId of ["AO-TRJ-001", "AO-TRJ-002"]) {
    const trajectory = record(parsed, "trajectory", trajectoryId);
    trajectory.decisionState = "rejected";
    trajectory.approvalProvenance = null;
    trajectory.nextGapId = null;
  }
  const goal = record(parsed, "goal", "AO-GOAL-001");
  goal.decisionState = "rejected";
  goal.approvalProvenance = null;
  for (const [unlockId, replacementId] of [["AO-U-078", "AO-U-079"], ["AO-U-079", "AO-U-080"]]) {
    const unlock = record(parsed, "unlock", unlockId);
    unlock.lifecycleState = "superseded";
    unlock.supersededById = replacementId;
    removeUnlockFromSource(parsed, unlockId);
  }

  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));

  middle.supersededById = undefined;
  assert.throws(
    () => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }),
    (error) => error instanceof RoadmapValidationError
      && error.issues.some((issue) => /gap supersession chain must terminate at a non-retired record/.test(issue)),
  );
});

test("retired gaps preserve completion evidence and retired child lineage", () => {
  const parsed = freshRoadmap();
  const goal = record(parsed, "goal", "AO-GOAL-001");
  goal.decisionState = "rejected";
  goal.approvalProvenance = null;
  const parent = record(parsed, "trajectory", "AO-TRJ-001");
  parent.decisionState = "rejected";
  parent.approvalProvenance = null;
  parent.nextGapId = null;
  const child = record(parsed, "trajectory", "AO-TRJ-002");
  child.decisionState = "rejected";
  child.parentGapId = "AO-GAP-001";
  const gap = record(parsed, "gap", "AO-GAP-001");
  gap.state = "superseded";
  gap.supersededById = "AO-GAP-002";
  gap.filledByIds.push(child.id);
  gap.completionEvidence = {
    exitCriterion: gap.exitCriterion,
    evidenceRefs: ["fixture://historical-terminal-acceptance"],
  };
  const bridge = record(parsed, "unlock", "AO-U-078");
  bridge.lifecycleState = "superseded";
  bridge.supersededById = "AO-U-079";
  removeUnlockFromSource(parsed, bridge.id);

  assert.doesNotThrow(() => validateRoadmap(parsed, { rootDir: PLUGIN_ROOT, skipCheckedViews: true }));
});

test("active gaps reject completion history or retired children, and retired gaps reject live children", () => {
  expectValidationIssues((parsed) => {
    const gap = record(parsed, "gap", "AO-GAP-001");
    gap.completionEvidence = { exitCriterion: gap.exitCriterion, evidenceRefs: ["fixture://premature"] };
  }, [/AO-GAP-001: completionEvidence is allowed only for filled or retired gaps/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const child = record(parsed, "trajectory", "AO-TRJ-002");
    child.decisionState = "rejected";
    child.parentGapId = "AO-GAP-001";
    record(parsed, "gap", "AO-GAP-001").filledByIds.push(child.id);
  }, [/AO-GAP-001: active gap trajectory filler 'AO-TRJ-002' must be non-retired/], { skipCheckedViews: true });

  expectValidationIssues((parsed) => {
    const child = record(parsed, "trajectory", "AO-TRJ-002");
    child.parentGapId = "AO-GAP-001";
    const gap = record(parsed, "gap", "AO-GAP-001");
    gap.state = "invalidated";
    gap.filledByIds.push(child.id);
    record(parsed, "trajectory", "AO-TRJ-001").nextGapId = null;
  }, [
    /AO-GAP-001: retired gap may retain only retired trajectory filler 'AO-TRJ-002'/,
    /AO-U-078: active bridge cannot reference retired gap 'AO-GAP-001'/,
  ], { skipCheckedViews: true });
});
