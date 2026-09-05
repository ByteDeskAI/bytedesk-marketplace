#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FENCE_TO_KIND = Object.freeze({
  "roadmap-task": "task",
  "roadmap-unlock": "unlock",
  "roadmap-goal": "goal",
  "roadmap-trajectory": "trajectory",
  "roadmap-gap": "gap",
});

const TASK_RANGES = Object.freeze({
  ORK: 5,
  RTR: 5,
  COL: 6,
  DEL: 5,
  GOV: 6,
  TUX: 7,
  OBS: 5,
  REL: 5,
  EXT: 4,
  LRN: 6,
});

export const EXPECTED_SEED_TASK_IDS = Object.freeze(Object.entries(TASK_RANGES)
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, index) =>
    `AO-${prefix}-${String(index + 1).padStart(3, "0")}`)));

const REQUIRED_KEYS = Object.freeze({
  task: [
    "schemaVersion", "kind", "id", "title", "category", "capabilityKey", "status", "readiness",
    "baseline", "independent", "helps", "why", "unlockIds", "acceptance",
    "sourceSeams", "evidence", "unlocks",
  ],
  unlock: [
    "schemaVersion", "kind", "id", "from", "to", "relation", "capabilityKey",
    "rationale", "verification", "helps", "why", "unlocks",
  ],
  goal: [
    "schemaVersion", "kind", "id", "title", "capabilityKey", "decisionState",
    "attainmentState", "outcome", "scope", "successMeasures", "nonGoals", "horizon",
    "evidence", "approvalProvenance", "preferredTrajectoryId", "helps", "why", "unlocks",
  ],
  trajectory: [
    "schemaVersion", "kind", "id", "goalId", "title", "capabilityKey", "strategyKey",
    "epistemicState", "decisionState", "materializationState", "entryTaskIds", "taskIds",
    "unlockIds", "gapIds", "alternativeTo", "assumptions", "disconfirmingSignals",
    "confidence", "hopEstimate", "nextGapId", "approvalProvenance", "helps", "why", "unlocks",
  ],
  gap: [
    "schemaVersion", "recordType", "kind", "id", "trajectoryId", "capabilityKey", "state", "fromAnchorIds",
    "missingCapability", "exitCriterion", "hopEstimate", "filledByIds", "evidence", "helps", "why",
    "unlocks",
  ],
});

const ALLOWED_KEYS = Object.freeze({
  task: new Set([...REQUIRED_KEYS.task, "completionEvidence", "supersededById"]),
  unlock: new Set([...REQUIRED_KEYS.unlock, "gapId", "gap", "exitCriterion", "lifecycleState", "supersededById"]),
  goal: new Set([...REQUIRED_KEYS.goal, "attainmentEvidence", "supersededById"]),
  trajectory: new Set([...REQUIRED_KEYS.trajectory, "primary", "parentGapId", "supersededById"]),
  gap: new Set([...REQUIRED_KEYS.gap, "completionEvidence", "supersededById"]),
});

const ID_PATTERNS = Object.freeze({
  task: /^AO-(?:ORK|RTR|COL|DEL|GOV|TUX|OBS|REL|EXT|LRN)-\d{3}$/,
  unlock: /^AO-U-\d{3}$/,
  goal: /^AO-GOAL-\d{3}$/,
  trajectory: /^AO-TRJ-\d{3}$/,
  gap: /^AO-GAP-\d{3}$/,
});

const STRATEGIC_FORBIDDEN_KEYS = new Set([
  "agent", "agentid", "agentids", "assignedagent", "provider", "providerid", "model",
  "modelid", "executor", "runtimeauthority", "runtimeowner", "scheduler", "worker",
  "command", "permissionprofile", "dispatchto", "spawn", "spawns",
]);

export class RoadmapValidationError extends Error {
  constructor(issues) {
    super(`Roadmap validation failed with ${issues.length} error${issues.length === 1 ? "" : "s"}.`);
    this.name = "RoadmapValidationError";
    this.issues = issues;
  }
}

export class RoadmapSourceManifestError extends Error {
  constructor(issues) {
    super(`Roadmap source manifest generation failed with ${issues.length} error${issues.length === 1 ? "" : "s"}.`);
    this.name = "RoadmapSourceManifestError";
    this.issues = issues;
  }
}

export class RoadmapInventoryError extends Error {
  constructor(issues) {
    super(`Roadmap inventory update failed with ${issues.length} error${issues.length === 1 ? "" : "s"}.`);
    this.name = "RoadmapInventoryError";
    this.issues = issues;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function canonicalSourceText(value) {
  return value.replace(/\r\n?/g, "\n");
}

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
}

function nonEmptyStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRetiredGoal(record) {
  return ["rejected", "superseded"].includes(record?.decisionState)
    || ["abandoned", "superseded"].includes(record?.attainmentState);
}

function isRetiredTrajectory(record) {
  return ["rejected", "superseded"].includes(record?.decisionState)
    || record?.epistemicState === "invalidated";
}

function isSupersededRecord(kind, record) {
  if (kind === "task") return record?.status === "superseded";
  if (kind === "unlock") return record?.lifecycleState === "superseded";
  if (kind === "goal") return record?.decisionState === "superseded" || record?.attainmentState === "superseded";
  if (kind === "trajectory") return record?.decisionState === "superseded";
  return record?.state === "superseded";
}

function isRetiredRecord(kind, record) {
  if (isSupersededRecord(kind, record)) return true;
  if (kind === "task") return record?.status === "dropped";
  if (kind === "unlock") return false;
  if (kind === "goal") return isRetiredGoal(record);
  if (kind === "trajectory") return isRetiredTrajectory(record);
  return record?.state === "invalidated";
}

function isActiveUnlock(record) {
  return (record?.lifecycleState ?? "active") === "active";
}

function capabilityCollision(key, left, right) {
  const [first, second] = [left, right].sort((a, b) => a.id.localeCompare(b.id));
  return `global capabilityKey '${key}' is reused across ${first.kind} '${first.id}' and ${second.kind} '${second.id}'`;
}

function validateSupersessions(model, issue) {
  for (const kind of INVENTORY_KINDS) {
    for (const record of model[kind].values()) {
      const superseded = isSupersededRecord(kind, record);
      const retired = isRetiredRecord(kind, record);
      const replacementId = record.supersededById;
      if (superseded && !nonEmptyString(replacementId)) {
        issue(`${record.id}: superseded ${kind} requires supersededById.`);
        continue;
      }
      if (!retired && replacementId !== undefined) {
        issue(`${record.id}: supersededById requires the ${kind} to be in a retired state.`);
        continue;
      }
      if (!nonEmptyString(replacementId)) continue;
      const replacement = model[kind].get(replacementId);
      if (!replacement) issue(`${record.id}: supersededById '${replacementId}' must resolve to a ${kind}.`);
      else if (replacementId === record.id) issue(`${record.id}: supersededById cannot reference itself.`);
      else if (replacement.capabilityKey === record.capabilityKey) issue(`${record.id}: replacement '${replacementId}' must use a distinct capabilityKey.`);
    }

    for (const start of model[kind].values()) {
      if (!nonEmptyString(start.supersededById)) continue;
      const seen = new Set();
      let current = start;
      let broken = false;
      while (nonEmptyString(current?.supersededById)) {
        if (seen.has(current.id)) {
          issue(`${start.id}: ${kind} supersession cycle detected through '${current.id}'.`);
          broken = true;
          break;
        }
        seen.add(current.id);
        current = model[kind].get(current.supersededById);
        if (!current) {
          broken = true;
          break;
        }
      }
      if (!broken && current && isRetiredRecord(kind, current)) issue(`${start.id}: ${kind} supersession chain must terminate at a non-retired record.`);
    }
  }
}

function validateApprovalProvenance(value, label, issue, required) {
  if (value === null && !required) return;
  if (!isPlainObject(value)) {
    issue(`${label} must be a human approvalProvenance object${required ? " for approved records" : " or null"}.`);
    return;
  }
  const expectedKeys = ["actorType", "actorId", "decidedAt", "evidenceRef"];
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    issue(`${label} must contain exactly actorType, actorId, decidedAt, and evidenceRef.`);
  }
  if (value.actorType !== "human") issue(`${label}.actorType must be 'human'.`);
  for (const key of ["actorId", "evidenceRef"]) {
    if (!nonEmptyString(value[key])) issue(`${label}.${key} must be a non-empty string.`);
  }
  if (!nonEmptyString(value.decidedAt)
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.decidedAt)
      || Number.isNaN(Date.parse(`${value.decidedAt}T00:00:00Z`))) {
    issue(`${label}.decidedAt must be a valid YYYY-MM-DD date.`);
  }
}

function validateHopRange(value, label, issue, minimum = 0, shape = "estimate") {
  const [minKey, maxKey] = shape === "horizon" ? ["minHops", "maxHops"] : ["min", "max"];
  if (!isPlainObject(value)) {
    issue(`${label} must contain exactly ${minKey} and ${maxKey}.`);
    return;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([maxKey, minKey].sort())) {
    issue(`${label} must contain exactly ${minKey} and ${maxKey}.`);
    return;
  }
  const min = value[minKey];
  const max = value[maxKey];
  if (!Number.isInteger(min) || !(Number.isInteger(max) || max === null)) {
    issue(`${label} must contain integer ${minKey} and integer-or-null ${maxKey} values.`);
    return;
  }
  if (min < minimum || (max !== null && max < min)) issue(`${label} must satisfy ${minimum} <= min <= max when max is known.`);
}

function sourceLocation(entry) {
  return `${entry.record?.id ?? entry.fence} (line ${entry.line})`;
}

function sourceSeamDescriptor(seam, label, issue) {
  if (typeof seam === "string") {
    const match = /^(.*):(\d+)-(\d+)$/.exec(seam);
    if (!match) {
      issue(`${label}: source seam '${seam}' must use path:start-end.`);
      return null;
    }
    return { path: match[1], span: [Number(match[2]), Number(match[3])], anchor: null };
  }
  if (isPlainObject(seam)) {
    if (!nonEmptyString(seam.path) || !nonEmptyString(seam.anchor)) {
      issue(`${label}: object source seam needs non-empty path and anchor values.`);
      return null;
    }
    return { path: seam.path, span: null, anchor: seam.anchor };
  }
  issue(`${label}: source seam must be path:start-end or {path,anchor}.`);
  return null;
}

function resolveSourceSeam(rootDir, seamPath, label, issue) {
  if (!nonEmptyString(seamPath) || isAbsolute(seamPath)) {
    issue(`${label}: source seam path must be repository-relative.`);
    return null;
  }
  const absolute = resolve(rootDir, seamPath);
  const inside = relative(rootDir, absolute);
  if (inside === ".." || inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(inside)) {
    issue(`${label}: source seam '${seamPath}' escapes the plugin root.`);
    return null;
  }
  return absolute;
}

function exactOccurrenceCount(contents, anchor) {
  let count = 0;
  let offset = 0;
  while (offset <= contents.length - anchor.length) {
    const found = contents.indexOf(anchor, offset);
    if (found === -1) break;
    count += 1;
    offset = found + anchor.length;
  }
  return count;
}

/**
 * Parse machine-readable roadmap fences. Each fence may contain one object or
 * an array; arrays are flattened while retaining fence and line provenance.
 */
export function parseRoadmap(source) {
  if (typeof source !== "string") throw new TypeError("Roadmap source must be a string.");
  const lines = source.split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^```(roadmap-(?:task|unlock|goal|trajectory|gap))\s*$/.exec(lines[index]);
    if (!match) continue;
    const fence = match[1];
    const startLine = index + 1;
    const body = [];
    index += 1;
    while (index < lines.length && !/^```\s*$/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) {
      throw new SyntaxError(`Unclosed ${fence} fence starting at line ${startLine}.`);
    }
    let decoded;
    try {
      decoded = JSON.parse(body.join("\n"));
    } catch (error) {
      throw new SyntaxError(`Invalid JSON in ${fence} fence at line ${startLine}: ${error.message}`);
    }
    const records = Array.isArray(decoded) ? decoded : [decoded];
    if (records.length === 0) throw new SyntaxError(`Empty ${fence} fence at line ${startLine}.`);
    for (const record of records) entries.push({ fence, line: startLine, record });
  }
  const byKind = Object.fromEntries(Object.values(FENCE_TO_KIND).map((kind) => [kind, []]));
  for (const entry of entries) byKind[FENCE_TO_KIND[entry.fence]].push(entry.record);
  return { source, entries, byKind };
}

/**
 * Derive the complete source-seam integrity manifest from real plugin source.
 * The default root is the script's plugin root and never process.cwd().
 */
export function generateSourceManifest(source, { rootDir = PLUGIN_ROOT } = {}) {
  if (!isAbsolute(rootDir)) throw new TypeError("Source-manifest rootDir must be an absolute plugin root.");
  const parsed = asParsed(source);
  const issues = [];
  const issue = (message) => issues.push(message);
  if (!existsSync(join(rootDir, "src"))) {
    throw new RoadmapSourceManifestError([
      `Cannot refresh ROADMAP-SOURCES.json because '${join(rootDir, "src")}' is absent; installed caches do not contain authoritative source.`,
    ]);
  }

  const references = new Map();
  for (const task of parsed.byKind.task) {
    const label = task?.id ?? "roadmap task";
    if (!Array.isArray(task?.sourceSeams) || task.sourceSeams.length === 0) {
      issue(`${label}: sourceSeams must be a non-empty array.`);
      continue;
    }
    for (const seam of task.sourceSeams) {
      const descriptor = sourceSeamDescriptor(seam, label, issue);
      if (!descriptor) continue;
      const absolute = resolveSourceSeam(rootDir, descriptor.path, label, issue);
      if (!absolute) continue;
      if (!references.has(descriptor.path)) references.set(descriptor.path, { absolute, anchors: new Set(), spans: [] });
      const reference = references.get(descriptor.path);
      if (descriptor.anchor) reference.anchors.add(descriptor.anchor);
      if (descriptor.span) reference.spans.push(descriptor.span);
    }
  }
  if (references.size === 0) issue("Roadmap tasks do not reference any valid source seams.");

  const files = {};
  for (const seamPath of [...references.keys()].sort()) {
    const reference = references.get(seamPath);
    let contents;
    try {
      contents = readFileSync(reference.absolute, "utf8");
    } catch {
      issue(`Source seam file '${seamPath}' is missing or unreadable under the plugin root.`);
      continue;
    }
    contents = canonicalSourceText(contents);
    const lineCount = contents.split("\n").length;
    for (const [start, end] of reference.spans) {
      if (start < 1 || end < start || end > lineCount) issue(`Source seam '${seamPath}:${start}-${end}' is outside 1-${lineCount}.`);
    }
    for (const anchor of reference.anchors) {
      const occurrences = exactOccurrenceCount(contents, anchor);
      if (occurrences !== 1) issue(`Anchor '${anchor}' must occur exactly once in source seam file '${seamPath}'; found ${occurrences}.`);
    }
    files[seamPath] = {
      sha256: createHash("sha256").update(contents).digest("hex"),
      lineCount,
      anchors: [...reference.anchors].sort(),
    };
  }
  if (issues.length > 0) throw new RoadmapSourceManifestError(issues);
  return { schemaVersion: 1, hashAlgorithm: "sha256", files };
}

const INVENTORY_KINDS = Object.freeze(["task", "unlock", "goal", "trajectory", "gap"]);
const INVENTORY_IDENTITY_FIELDS = Object.freeze({
  task: ["capabilityKey", "category"],
  unlock: ["capabilityKey", "from", "to", "relation"],
  goal: ["capabilityKey"],
  trajectory: ["capabilityKey", "goalId", "strategyKey"],
  gap: ["capabilityKey", "trajectoryId", "kind"],
});

function inventoryRecord(kind, record) {
  return Object.fromEntries(["id", ...INVENTORY_IDENTITY_FIELDS[kind]].map((key) => [key, record?.[key]]));
}

function validateInventorySchema(inventory, issue) {
  if (!isPlainObject(inventory)) {
    issue("ROADMAP-INVENTORY.json must be an object.");
    return null;
  }
  if (JSON.stringify(Object.keys(inventory).sort()) !== JSON.stringify(["records", "schemaVersion"])) {
    issue("ROADMAP-INVENTORY.json must contain exactly schemaVersion and records.");
  }
  if (inventory.schemaVersion !== 1) issue("ROADMAP-INVENTORY.json schemaVersion must be 1.");
  if (!isPlainObject(inventory.records)) {
    issue("ROADMAP-INVENTORY.json records must be an object.");
    return null;
  }
  const actualKinds = Object.keys(inventory.records).sort();
  if (JSON.stringify(actualKinds) !== JSON.stringify([...INVENTORY_KINDS].sort())) {
    issue(`ROADMAP-INVENTORY.json records must contain exactly [${INVENTORY_KINDS.join(", ")}].`);
  }
  const globalIds = new Map();
  const globalCapabilityKeys = new Map();
  for (const kind of INVENTORY_KINDS) {
    const records = inventory.records[kind];
    if (!Array.isArray(records)) {
      issue(`ROADMAP-INVENTORY.json ${kind} records must be an array.`);
      continue;
    }
    const ids = new Set();
    for (const record of records) {
      const expectedKeys = ["id", ...INVENTORY_IDENTITY_FIELDS[kind]].sort();
      if (!isPlainObject(record) || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) {
        issue(`ROADMAP-INVENTORY.json ${kind} entries must contain exactly ${expectedKeys.join(", ")}.`);
        continue;
      }
      if (!ID_PATTERNS[kind].test(record.id ?? "")) issue(`ROADMAP-INVENTORY.json has invalid ${kind} ID '${String(record.id)}'.`);
      if (!nonEmptyString(record.capabilityKey)) issue(`ROADMAP-INVENTORY.json ${record.id} requires a capabilityKey.`);
      for (const field of INVENTORY_IDENTITY_FIELDS[kind].filter((field) => field !== "capabilityKey")) {
        if (!nonEmptyString(record[field])) issue(`ROADMAP-INVENTORY.json ${record.id} requires identity field '${field}'.`);
      }
      if (ids.has(record.id)) issue(`ROADMAP-INVENTORY.json duplicates ${kind} ID '${record.id}'.`);
      ids.add(record.id);
      if (nonEmptyString(record.capabilityKey)) {
        const identity = { kind, id: record.id };
        if (globalCapabilityKeys.has(record.capabilityKey)) {
          issue(`ROADMAP-INVENTORY.json ${capabilityCollision(record.capabilityKey, globalCapabilityKeys.get(record.capabilityKey), identity)}.`);
        } else {
          globalCapabilityKeys.set(record.capabilityKey, identity);
        }
      }
      if (globalIds.has(record.id)) issue(`ROADMAP-INVENTORY.json ID '${record.id}' is duplicated across ${globalIds.get(record.id)} and ${kind}.`);
      else globalIds.set(record.id, kind);
    }
    const recordIds = records.map((record) => record?.id);
    if (JSON.stringify(recordIds) !== JSON.stringify([...recordIds].sort())) issue(`ROADMAP-INVENTORY.json ${kind} records must be sorted by ID.`);
  }
  return inventory.records;
}

function loadRoadmapInventory(rootDir, supplied, issue) {
  let inventory = supplied;
  if (inventory === undefined) {
    const inventoryPath = join(rootDir, "ROADMAP-INVENTORY.json");
    if (!existsSync(inventoryPath)) {
      issue("ROADMAP-INVENTORY.json is required to preserve immutable roadmap IDs.");
      return null;
    }
    try {
      inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    } catch (error) {
      issue(`ROADMAP-INVENTORY.json is invalid JSON: ${error.message}`);
      return null;
    }
  }
  return validateInventorySchema(inventory, issue);
}

/** Validate and union current roadmap IDs into an existing append-only inventory. */
export function appendRoadmapInventory(source, inventory, { rootDir = PLUGIN_ROOT } = {}) {
  const parsed = asParsed(source);
  const issues = [];
  const issue = (message) => issues.push(message);
  const existing = validateInventorySchema(inventory, issue);
  const current = Object.fromEntries(INVENTORY_KINDS.map((kind) => [kind, new Map()]));
  const globalIds = new Map();
  const globalCapabilityKeys = new Map();
  for (const kind of INVENTORY_KINDS) {
    for (const record of parsed.byKind[kind]) {
      const id = record?.id;
      if (!ID_PATTERNS[kind].test(id ?? "")) issue(`Cannot inventory invalid ${kind} ID '${String(id)}'.`);
      if (!nonEmptyString(record?.capabilityKey)) issue(`Cannot inventory ${kind} '${id}' without capabilityKey.`);
      else {
        const identity = { kind, id };
        if (globalCapabilityKeys.has(record.capabilityKey)) {
          issue(`Cannot inventory roadmap because ${capabilityCollision(record.capabilityKey, globalCapabilityKeys.get(record.capabilityKey), identity)}.`);
        } else {
          globalCapabilityKeys.set(record.capabilityKey, identity);
        }
      }
      if (current[kind].has(id)) issue(`Cannot inventory duplicate ${kind} ID '${id}'.`);
      current[kind].set(id, inventoryRecord(kind, record));
      if (globalIds.has(id)) issue(`Cannot inventory global ID '${id}' twice (${globalIds.get(id)} and ${kind}).`);
      else globalIds.set(id, kind);
    }
  }
  if (issues.length > 0 || !existing) throw new RoadmapInventoryError(issues);
  for (const kind of INVENTORY_KINDS) {
    for (const record of existing[kind]) {
      if (!current[kind].has(record.id)) issue(`Cannot remove immutable ${kind} ID '${record.id}' from ROADMAP.md.`);
    }
  }
  if (issues.length > 0) throw new RoadmapInventoryError(issues);
  for (const kind of INVENTORY_KINDS) {
    const existingIds = new Set(existing[kind].map((record) => record.id));
    const groups = new Map();
    for (const id of current[kind].keys()) {
      if (existingIds.has(id)) continue;
      const match = /^(.*-)(\d{3})$/.exec(id);
      if (!match) continue;
      const namespace = kind === "task" ? match[1] : kind;
      if (!groups.has(namespace)) groups.set(namespace, []);
      groups.get(namespace).push({ id, suffix: Number(match[2]) });
    }
    for (const [namespace, additions] of groups) {
      const existingSuffixes = existing[kind]
        .map((record) => /^(.*-)(\d{3})$/.exec(record.id))
        .filter((match) => match && (kind !== "task" || match[1] === namespace))
        .map((match) => Number(match[2]));
      let expected = (existingSuffixes.length > 0 ? Math.max(...existingSuffixes) : 0) + 1;
      for (const addition of additions.sort((left, right) => left.suffix - right.suffix)) {
        if (addition.suffix !== expected) {
          issue(`Cannot append non-contiguous ${kind} ID '${addition.id}'; expected suffix ${String(expected).padStart(3, "0")} in namespace '${namespace}'.`);
          break;
        }
        expected += 1;
      }
    }
  }
  if (issues.length > 0) throw new RoadmapInventoryError(issues);
  const records = {};
  for (const kind of INVENTORY_KINDS) {
    const merged = new Map(existing[kind].map((record) => [record.id, record]));
    for (const [id, identity] of current[kind]) {
      if (merged.has(id) && JSON.stringify(merged.get(id)) !== JSON.stringify(identity)) {
        issue(`Cannot repurpose ${kind} ID '${id}'; immutable identity changed.`);
      } else {
        merged.set(id, identity);
      }
    }
    records[kind] = [...merged].sort(([left], [right]) => left.localeCompare(right))
      .map(([, identity]) => identity);
  }
  if (issues.length > 0) throw new RoadmapInventoryError(issues);
  const prospective = { schemaVersion: 1, records };
  try {
    // Inventory allocation intentionally precedes generated-view and source-manifest
    // refreshes. Validate the edited roadmap against in-memory prospective integrity
    // data so only stale checked views are tolerated and no invalid identity is written.
    const prospectiveSourceManifest = generateSourceManifest(parsed, { rootDir });
    validateRoadmap(parsed, {
      rootDir,
      roadmapInventory: prospective,
      sourceManifest: prospectiveSourceManifest,
      skipCheckedViews: true,
    });
  } catch (error) {
    if (error instanceof RoadmapValidationError || error instanceof RoadmapSourceManifestError) {
      throw new RoadmapInventoryError(error.issues);
    }
    throw error;
  }
  return prospective;
}

function asParsed(source) {
  return typeof source === "string" ? parseRoadmap(source) : source;
}

function buildModel(parsed) {
  const maps = Object.fromEntries(Object.keys(parsed.byKind).map((kind) => [kind, new Map()]));
  for (const [kind, records] of Object.entries(parsed.byKind)) {
    for (const record of records) {
      if (nonEmptyString(record?.id) && !maps[kind].has(record.id)) maps[kind].set(record.id, record);
    }
  }
  return { parsed, ...maps };
}

function compareCosts(left, right) {
  if (left.bridgeCount !== right.bridgeCount) return left.bridgeCount - right.bridgeCount;
  if (left.hops !== right.hops) return left.hops - right.hops;
  const edgeOrder = left.edgeIds.join("\0").localeCompare(right.edgeIds.join("\0"));
  if (edgeOrder !== 0) return edgeOrder;
  return left.nodeIds.join("\0").localeCompare(right.nodeIds.join("\0"));
}

function shortestPath(trajectory, model, relations) {
  const selected = trajectory.unlockIds
    .map((id) => model.unlock.get(id))
    .filter((edge) => edge
      && isActiveUnlock(edge)
      && relations.has(edge.relation)
      && (edge.relation !== "bridge" || !["invalidated", "superseded"].includes(model.gap.get(edge.gapId)?.state)));
  const adjacency = new Map();
  for (const edge of selected) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => left.id.localeCompare(right.id));

  const queue = [...trajectory.entryTaskIds].sort().map((entry) => ({
    node: entry,
    nodeIds: [entry],
    edgeIds: [],
    bridgeCount: 0,
    hops: 0,
  }));
  const best = new Map();
  while (queue.length > 0) {
    queue.sort(compareCosts);
    const current = queue.shift();
    const prior = best.get(current.node);
    if (prior && compareCosts(prior, current) <= 0) continue;
    best.set(current.node, current);
    if (current.node === trajectory.goalId) return current;
    for (const edge of adjacency.get(current.node) ?? []) {
      if (current.nodeIds.includes(edge.to)) continue;
      queue.push({
        node: edge.to,
        nodeIds: [...current.nodeIds, edge.to],
        edgeIds: [...current.edgeIds, edge.id],
        bridgeCount: current.bridgeCount + (edge.relation === "bridge" && model.gap.get(edge.gapId)?.state !== "filled" ? 1 : 0),
        hops: current.hops + 1,
      });
    }
  }
  return null;
}

function compareLongest(left, right) {
  if (!left) return 1;
  if (!right) return -1;
  if (left.hops !== right.hops) return right.hops - left.hops;
  const edgeOrder = left.edgeIds.join("\0").localeCompare(right.edgeIds.join("\0"));
  if (edgeOrder !== 0) return edgeOrder;
  return left.nodeIds.join("\0").localeCompare(right.nodeIds.join("\0"));
}

function criticalPath(trajectory, model) {
  const adjacency = new Map();
  for (const id of trajectory.unlockIds ?? []) {
    const edge = model.unlock.get(id);
    if (!edge || !isActiveUnlock(edge) || !["requires", "bridge"].includes(edge.relation)) continue;
    if (edge.relation === "bridge" && ["invalidated", "superseded"].includes(model.gap.get(edge.gapId)?.state)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => left.id.localeCompare(right.id));

  const visit = (node, active) => {
    if (node === trajectory.goalId) return { nodeIds: [node], edgeIds: [], hops: 0 };
    if (active.has(node)) return null;
    const nextActive = new Set(active).add(node);
    const candidates = [];
    for (const edge of adjacency.get(node) ?? []) {
      const tail = visit(edge.to, nextActive);
      if (!tail) continue;
      candidates.push({
        nodeIds: [node, ...tail.nodeIds],
        edgeIds: [edge.id, ...tail.edgeIds],
        hops: tail.hops + 1,
      });
    }
    return candidates.sort(compareLongest)[0] ?? null;
  };

  return [...(trajectory.entryTaskIds ?? [])]
    .sort()
    .map((entry) => visit(entry, new Set()))
    .filter(Boolean)
    .sort(compareLongest)[0] ?? null;
}

function transitive(start, adjacency) {
  const seen = new Set();
  const pending = [...(adjacency.get(start) ?? [])];
  while (pending.length > 0) {
    const node = pending.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push(...(adjacency.get(node) ?? []));
  }
  return [...seen].sort();
}

/** Derive deterministic reachability, AND-required work, and unlock lineage. */
export function deriveRoadmapIndex(source) {
  const parsed = asParsed(source);
  const model = buildModel(parsed);
  const hardOut = new Map();
  const hardIn = new Map();
  for (const edge of model.unlock.values()) {
    if (!isActiveUnlock(edge) || edge.relation !== "requires") continue;
    if (!hardOut.has(edge.from)) hardOut.set(edge.from, []);
    if (!hardIn.has(edge.to)) hardIn.set(edge.to, []);
    hardOut.get(edge.from).push(edge.to);
    hardIn.get(edge.to).push(edge.from);
  }
  for (const values of [...hardOut.values(), ...hardIn.values()]) values.sort();

  const tasks = {};
  for (const task of [...model.task.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const directUnlocks = [...(hardOut.get(task.id) ?? [])].sort();
    const transitiveUnlocks = transitive(task.id, hardOut);
    tasks[task.id] = {
      directlyRequires: [...(hardIn.get(task.id) ?? [])].sort(),
      requiredAncestors: transitive(task.id, hardIn),
      directlyUnlocks: directUnlocks,
      transitivelyUnlocks: transitiveUnlocks,
    };
  }

  const trajectories = {};
  for (const trajectory of [...model.trajectory.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const best = shortestPath(trajectory, model, new Set(["requires", "bridge"]));
    const critical = criticalPath(trajectory, model);
    const activeGaps = (trajectory.gapIds ?? []).map((id) => model.gap.get(id)).filter((gap) => gap && gap.state !== "superseded");
    const unresolvedGapIds = activeGaps
      .filter((gap) => ["open", "researching", "partially-filled"].includes(gap.state))
      .map((gap) => gap.id)
      .sort();
    const hasInvalidatedGap = activeGaps.some((gap) => gap.state === "invalidated");
    const retired = isRetiredTrajectory(trajectory);
    const requiredTaskIds = [...(trajectory.taskIds ?? [])].sort();
    const remainingTaskIds = requiredTaskIds.filter((id) => model.task.get(id)?.status !== "done");
    trajectories[trajectory.id] = {
      goalId: trajectory.goalId,
      state: retired ? "retired" : hasInvalidatedGap || !best ? "unreachable" : unresolvedGapIds.length > 0 ? "bridged" : "reachable",
      requiredTaskIds,
      requiredTaskCount: requiredTaskIds.length,
      remainingTaskIds,
      remainingTaskCount: remainingTaskIds.length,
      criticalPathHops: !retired && !hasInvalidatedGap ? critical?.hops ?? null : null,
      criticalPathNodeIds: !retired && !hasInvalidatedGap ? critical?.nodeIds ?? [] : [],
      criticalPathUnlockIds: !retired && !hasInvalidatedGap ? critical?.edgeIds ?? [] : [],
      shortestPathHops: !retired && !hasInvalidatedGap ? best?.hops ?? null : null,
      unresolvedGapIds,
      unresolvedGapCount: unresolvedGapIds.length,
      shortestNodePath: !retired && !hasInvalidatedGap ? best?.nodeIds ?? [] : [],
      shortestUnlockPath: !retired && !hasInvalidatedGap ? best?.edgeIds ?? [] : [],
    };
  }

  const goals = {};
  for (const goal of [...model.goal.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const trajectoryIds = [...model.trajectory.values()]
      .filter((trajectory) => trajectory.goalId === goal.id)
      .map((trajectory) => trajectory.id)
      .sort();
    goals[goal.id] = {
      trajectoryIds,
      preferredTrajectoryId: goal.preferredTrajectoryId,
      trajectories: Object.fromEntries(trajectoryIds.map((id) => [id, trajectories[id]])),
    };
  }

  return {
    schemaVersion: 1,
    inputDigest: `sha256:${digest(parsed.entries.map((entry) => entry.record))}`,
    counts: Object.fromEntries(Object.entries(parsed.byKind).map(([kind, records]) => [kind, records.length])),
    tasks,
    goals,
    trajectories,
  };
}

function escapeMermaid(value) {
  return String(value).replace(/["\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

function mermaidId(id) {
  const match = /^AO-([A-Z]+)-(\d{3})$/.exec(id);
  return match ? `${match[1]}${match[2]}` : id.replaceAll("-", "_");
}

/** Render stable GitHub Mermaid and trajectory summary views. */
export function renderGeneratedViews(source) {
  const parsed = asParsed(source);
  const model = buildModel(parsed);
  const index = deriveRoadmapIndex(parsed);
  const nodes = [];
  const operationalTasks = [...model.task.values()]
    .filter((task) => !isSupersededRecord("task", task))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const task of operationalTasks) {
    nodes.push(`  ${mermaidId(task.id)}["${task.id}"]`);
  }
  const edges = [...model.unlock.values()]
    .filter((edge) => isActiveUnlock(edge)
      && edge.relation === "requires"
      && !isSupersededRecord("task", model.task.get(edge.from))
      && !isSupersededRecord("task", model.task.get(edge.to)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => `  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
  const classes = ["ready", "gated", "done"].flatMap((readiness) => {
    const aliases = operationalTasks.filter((task) => task.readiness === readiness).map((task) => mermaidId(task.id));
    return aliases.length > 0 ? [`  class ${aliases.join(",")} ${readiness}`] : [];
  });
  const mermaid = [
    "```mermaid", "flowchart LR", ...nodes, "", ...edges, "",
    "  classDef ready fill:#d1fae5,stroke:#047857,color:#064e3b,stroke-width:2px",
    "  classDef gated fill:#f3f4f6,stroke:#6b7280,color:#111827",
    "  classDef done fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px",
    ...classes, "```",
  ].join("\n");

  const tableRows = Object.entries(index.trajectories).map(([id, derived]) => {
    const trajectory = model.trajectory.get(id);
    const path = derived.shortestNodePath.join(" → ") || "—";
    return `| ${id} | ${trajectory.goalId} | ${derived.state} | ${derived.requiredTaskCount} | ${derived.remainingTaskCount} | ${derived.criticalPathHops ?? "—"} | ${derived.shortestPathHops ?? "—"} | ${derived.unresolvedGapCount ?? "—"} | ${path} |`;
  });
  const trajectoryTable = [
    "| Trajectory | Goal | Reachability | Required tasks | Remaining tasks | Critical-path hops | Shortest-path hops | Unresolved gaps | Shortest path |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ...tableRows,
  ].join("\n");
  return { mermaid, trajectoryTable, index };
}

function strategicMermaid(model, trajectories) {
  const selectedTrajectories = [...trajectories].sort((left, right) => left.id.localeCompare(right.id));
  const goalIds = [...new Set(selectedTrajectories.map((trajectory) => trajectory.goalId))].sort();
  const gapIds = [...new Set(selectedTrajectories.flatMap((trajectory) => trajectory.gapIds ?? []))].sort();
  const lines = ["```mermaid", "flowchart LR"];
  for (const trajectory of selectedTrajectories) lines.push(`  ${mermaidId(trajectory.id)}("${trajectory.id}")`);
  for (const gapId of gapIds) lines.push(`  ${mermaidId(gapId)}{"${gapId}"}`);
  for (const goalId of goalIds) lines.push(`  ${mermaidId(goalId)}(["${goalId}"])`);
  lines.push("");
  for (const trajectory of selectedTrajectories) {
    for (const gapId of [...(trajectory.gapIds ?? [])].sort()) {
      lines.push(`  ${mermaidId(trajectory.id)} --> ${mermaidId(gapId)}`);
      lines.push(`  ${mermaidId(gapId)} -. bridge .-> ${mermaidId(trajectory.goalId)}`);
    }
    for (const alternativeId of [...(trajectory.alternativeTo ?? [])].sort()) {
      lines.push(`  ${mermaidId(trajectory.id)} -. alternative to .-> ${mermaidId(alternativeId)}`);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

/** Render every canonical checked-in view without depending on current view text. */
export function renderAllGeneratedViews(source) {
  const parsed = asParsed(source);
  const model = buildModel(parsed);
  const generated = renderGeneratedViews(parsed);
  const strategicOverview = strategicMermaid(model, model.trajectory.values());
  const perGoal = [...model.goal.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((goal) => {
      const trajectories = [...model.trajectory.values()].filter((trajectory) => trajectory.goalId === goal.id);
      return `#### ${goal.id} — ${goal.title}\n\n${strategicMermaid(model, trajectories)}`;
    })
    .join("\n\n");
  const perGoalSection = [
    "### Per-goal trajectory views",
    "",
    "These views are canonical strategic slices; the delivery graph remains the executable task DAG.",
    "",
    perGoal,
  ].join("\n");
  return {
    deliveryMermaid: generated.mermaid,
    strategicOverview,
    perGoalSection,
    trajectoryTable: generated.trajectoryTable,
    index: generated.index,
    printable: [generated.mermaid, strategicOverview, perGoalSection, generated.trajectoryTable].join("\n\n"),
  };
}

const VIEW_MARKERS = Object.freeze({
  delivery: ["<!-- ROADMAP_DELIVERY_MERMAID_START -->", "<!-- ROADMAP_DELIVERY_MERMAID_END -->"],
  strategic: ["<!-- ROADMAP_STRATEGIC_MERMAID_START -->", "<!-- ROADMAP_STRATEGIC_MERMAID_END -->"],
  perGoal: ["<!-- ROADMAP_PER_GOAL_MERMAID_START -->", "<!-- ROADMAP_PER_GOAL_MERMAID_END -->"],
  trajectory: ["<!-- ROADMAP_TRAJECTORY_INDEX_START -->", "<!-- ROADMAP_TRAJECTORY_INDEX_END -->"],
});

function markerWrapped([start, end], content) {
  return `${start}\n${content}\n${end}`;
}

function replaceMarked(source, markers, content) {
  const [start, end] = markers;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;
  return `${source.slice(0, startIndex)}${markerWrapped(markers, content)}${source.slice(endIndex + end.length)}`;
}

function replaceFirstMermaidAfter(source, heading, markers, content) {
  const headingIndex = source.indexOf(heading);
  if (headingIndex === -1) throw new Error(`Cannot bootstrap generated views: missing '${heading}'.`);
  const tail = source.slice(headingIndex);
  const match = /```mermaid\s*\n[\s\S]*?\n```/.exec(tail);
  if (!match) throw new Error(`Cannot bootstrap generated views: '${heading}' has no Mermaid block.`);
  const start = headingIndex + match.index;
  return `${source.slice(0, start)}${markerWrapped(markers, content)}${source.slice(start + match[0].length)}`;
}

/** Replace stale checked views, bootstrapping stable marker sections when absent. */
export function refreshGeneratedViewsSource(source) {
  const views = renderAllGeneratedViews(source);
  let refreshed = replaceMarked(source, VIEW_MARKERS.delivery, views.deliveryMermaid)
    ?? replaceFirstMermaidAfter(source, "## Delivery graph", VIEW_MARKERS.delivery, views.deliveryMermaid);
  refreshed = replaceMarked(refreshed, VIEW_MARKERS.strategic, views.strategicOverview)
    ?? replaceFirstMermaidAfter(refreshed, "## Strategic graph", VIEW_MARKERS.strategic, views.strategicOverview);
  const markedPerGoal = replaceMarked(refreshed, VIEW_MARKERS.perGoal, views.perGoalSection);
  if (markedPerGoal) {
    refreshed = markedPerGoal;
  } else {
    const match = /### Per-goal trajectory views[\s\S]*?(?=\n## Derived trajectory index)/.exec(refreshed);
    if (!match) throw new Error("Cannot bootstrap generated views: missing per-goal trajectory section.");
    refreshed = `${refreshed.slice(0, match.index)}${markerWrapped(VIEW_MARKERS.perGoal, views.perGoalSection)}${refreshed.slice(match.index + match[0].length)}`;
  }
  const markedTrajectory = replaceMarked(refreshed, VIEW_MARKERS.trajectory, views.trajectoryTable);
  if (!markedTrajectory) throw new Error("Cannot refresh generated views: missing trajectory-index markers.");
  return markedTrajectory;
}

function validateCheckedInViews(parsed, model, issue) {
  const blocks = [...parsed.source.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  const expectedViewCount = model.goal.size + 2;
  if (blocks.length !== expectedViewCount) {
    issue(`ROADMAP.md must contain exactly ${expectedViewCount} Mermaid views (delivery, strategic, and one per goal); found ${blocks.length}.`);
  }
  if (blocks.length === 0) {
    return;
  }

  const delivery = blocks[0];
  const nodeIds = new Map();
  for (const line of delivery.split("\n")) {
    const match = /^\s*([A-Z]+\d+)\["(AO-[A-Z]+-\d{3})"\]\s*$/.exec(line);
    if (match) nodeIds.set(match[1], match[2]);
  }
  const expectedTasks = new Set([...model.task.values()]
    .filter((task) => !isSupersededRecord("task", task))
    .map((task) => task.id));
  const renderedTasks = new Set(nodeIds.values());
  const missingTasks = [...expectedTasks].filter((id) => !renderedTasks.has(id));
  const unexpectedTasks = [...renderedTasks].filter((id) => !expectedTasks.has(id));
  if (missingTasks.length > 0 || unexpectedTasks.length > 0 || renderedTasks.size !== expectedTasks.size) {
    issue(`Delivery Mermaid task nodes drifted; missing [${missingTasks.join(", ")}], unexpected [${unexpectedTasks.join(", ")}].`);
  }

  const renderedEdges = new Set();
  for (const line of delivery.split("\n")) {
    const match = /^\s*([A-Z]+\d+)\s+-->\s+([A-Z]+\d+)\s*$/.exec(line);
    if (match && nodeIds.has(match[1]) && nodeIds.has(match[2])) {
      renderedEdges.add(`${nodeIds.get(match[1])}->${nodeIds.get(match[2])}`);
    }
  }
  const expectedEdges = new Set([...model.unlock.values()]
    .filter((edge) => isActiveUnlock(edge) && edge.relation === "requires" && model.task.has(edge.to))
    .map((edge) => `${edge.from}->${edge.to}`));
  const missingEdges = [...expectedEdges].filter((edge) => !renderedEdges.has(edge));
  const unexpectedEdges = [...renderedEdges].filter((edge) => !expectedEdges.has(edge));
  if (missingEdges.length > 0 || unexpectedEdges.length > 0 || renderedEdges.size !== expectedEdges.size) {
    issue(`Delivery Mermaid hard edges drifted; missing [${missingEdges.join(", ")}], unexpected [${unexpectedEdges.join(", ")}].`);
  }

  const renderedReadiness = new Map();
  for (const line of delivery.split("\n")) {
    const match = /^\s*class\s+([A-Z0-9,]+)\s+(ready|gated|done)\s*$/.exec(line);
    if (!match) continue;
    for (const alias of match[1].split(",")) {
      if (nodeIds.has(alias)) renderedReadiness.set(nodeIds.get(alias), match[2]);
    }
  }
  for (const id of expectedTasks) {
    const expectedReadiness = model.task.get(id).readiness;
    if (renderedReadiness.get(id) !== expectedReadiness) {
      issue(`Delivery Mermaid readiness for ${id} drifted; expected '${expectedReadiness}', found '${renderedReadiness.get(id) ?? "missing"}'.`);
    }
  }

  const strategicIds = (block) => new Set(block?.match(/\bAO-(?:GOAL|TRJ|GAP)-\d{3}\b/g) ?? []);
  const strategicRelations = (block) => {
    const aliasToId = new Map();
    for (const line of block.split("\n")) {
      for (const match of line.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\[|\(\(|\(|\{|\[)\s*"(AO-(?:GOAL|TRJ|GAP)-\d{3})(?:\s|·|")/g)) {
        aliasToId.set(match[1], match[2]);
      }
    }
    const relations = new Set();
    for (const line of block.split("\n")) {
      const arrow = /-->|-\..*?\.->/.exec(line);
      if (!arrow) continue;
      const left = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(line.slice(0, arrow.index))?.[1];
      const right = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(line.slice(arrow.index + arrow[0].length))?.[1];
      if (aliasToId.has(left) && aliasToId.has(right)) relations.add(`${aliasToId.get(left)}->${aliasToId.get(right)}`);
    }
    return relations;
  };
  const validateStrategicSlice = (block, expectedIds, trajectories, label) => {
    const idList = block?.match(/\bAO-(?:GOAL|TRJ|GAP)-\d{3}\b/g) ?? [];
    const actualIds = strategicIds(block);
    const missing = [...expectedIds].filter((id) => !actualIds.has(id));
    const unexpected = [...actualIds].filter((id) => !expectedIds.has(id));
    if (missing.length > 0 || unexpected.length > 0 || actualIds.size !== expectedIds.size) {
      issue(`${label} strategic nodes drifted; missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}].`);
    }
    const duplicates = [...actualIds].filter((id) => idList.filter((candidate) => candidate === id).length !== 1);
    if (duplicates.length > 0) issue(`${label} must render each strategic ID exactly once; repeated [${duplicates.join(", ")}].`);
    const relations = strategicRelations(block);
    for (const trajectory of trajectories) {
      for (const gapId of trajectory.gapIds ?? []) {
        if (!relations.has(`${trajectory.id}->${gapId}`)) issue(`${label} is missing strategic relation ${trajectory.id}->${gapId}.`);
        if (!relations.has(`${gapId}->${trajectory.goalId}`)) issue(`${label} is missing strategic relation ${gapId}->${trajectory.goalId}.`);
      }
      for (const alternativeId of trajectory.alternativeTo ?? []) {
        if (!relations.has(`${trajectory.id}->${alternativeId}`)) issue(`${label} is missing strategic alternative ${trajectory.id}->${alternativeId}.`);
      }
    }
  };

  if (blocks[1]) {
    const allIds = new Set([
      ...model.goal.keys(), ...model.trajectory.keys(), ...model.gap.keys(),
    ]);
    validateStrategicSlice(blocks[1], allIds, [...model.trajectory.values()], "Strategic overview Mermaid");
  } else {
    issue("ROADMAP.md is missing the strategic overview Mermaid.");
  }

  const perGoalSections = new Map();
  for (const match of parsed.source.matchAll(/^####\s+(AO-GOAL-\d{3})[^\n]*\n\s*```mermaid\s*\n([\s\S]*?)\n```/gm)) {
    if (perGoalSections.has(match[1])) issue(`Per-goal Mermaid for ${match[1]} is duplicated.`);
    else perGoalSections.set(match[1], match[2]);
  }
  for (const goal of model.goal.values()) {
    const block = perGoalSections.get(goal.id);
    if (!block) {
      issue(`ROADMAP.md is missing a per-goal Mermaid for ${goal.id}.`);
      continue;
    }
    const trajectories = [...model.trajectory.values()].filter((trajectory) => trajectory.goalId === goal.id);
    const expectedIds = new Set([goal.id]);
    for (const trajectory of trajectories) {
      expectedIds.add(trajectory.id);
      for (const gapId of trajectory.gapIds ?? []) expectedIds.add(gapId);
    }
    validateStrategicSlice(block, expectedIds, trajectories, `${goal.id} Mermaid`);
  }
  for (const goalId of perGoalSections.keys()) if (!model.goal.has(goalId)) issue(`Per-goal Mermaid references unknown goal ${goalId}.`);

  const marker = /<!-- ROADMAP_TRAJECTORY_INDEX_START -->\s*\n([\s\S]*?)\n<!-- ROADMAP_TRAJECTORY_INDEX_END -->/.exec(parsed.source);
  if (!marker) {
    issue("ROADMAP.md is missing the generated trajectory-index markers.");
  } else {
    const expectedTable = renderGeneratedViews(parsed).trajectoryTable.trim();
    if (marker[1].trim() !== expectedTable) issue("Generated trajectory index drifted; regenerate it from renderGeneratedViews().");
  }
}

function hardCycle(tasks, unlocks) {
  const adjacency = new Map([...tasks.keys()].map((id) => [id, []]));
  for (const edge of unlocks.values()) {
    if (isActiveUnlock(edge) && edge.relation === "requires" && tasks.has(edge.from) && tasks.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }
  for (const values of adjacency.values()) values.sort();
  const state = new Map();
  const stack = [];
  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node)) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  }
  for (const node of [...adjacency.keys()].sort()) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

function strategicAuthorityPaths(value, path = "") {
  if (Array.isArray(value)) return value.flatMap((child, index) => strategicAuthorityPaths(child, `${path}[${index}]`));
  if (!isPlainObject(value)) return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (STRATEGIC_FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) paths.push(childPath);
    paths.push(...strategicAuthorityPaths(child, childPath));
  }
  return paths;
}

function loadSourceManifest(rootDir, supplied, issue) {
  let manifest = supplied;
  if (manifest === undefined) {
    const manifestPath = join(rootDir, "ROADMAP-SOURCES.json");
    if (!existsSync(manifestPath)) {
      issue("ROADMAP-SOURCES.json is required to validate source seams in source and installed packages.");
      return {};
    }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      issue(`ROADMAP-SOURCES.json is invalid JSON: ${error.message}`);
      return {};
    }
  }
  if (!isPlainObject(manifest)
      || manifest.schemaVersion !== 1
      || manifest.hashAlgorithm !== "sha256"
      || !isPlainObject(manifest.files)) {
    issue("ROADMAP-SOURCES.json must contain schemaVersion 1, hashAlgorithm 'sha256', and a files object.");
    return {};
  }
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (!nonEmptyString(path) || isAbsolute(path) || !isPlainObject(entry)) {
      issue(`ROADMAP-SOURCES.json has an invalid file entry '${path}'.`);
      continue;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["anchors", "lineCount", "sha256"])) {
      issue(`ROADMAP-SOURCES.json entry '${path}' must contain exactly sha256, lineCount, and anchors.`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) issue(`ROADMAP-SOURCES.json entry '${path}' has an invalid sha256.`);
    if (!Number.isInteger(entry.lineCount) || entry.lineCount < 1) issue(`ROADMAP-SOURCES.json entry '${path}' has an invalid lineCount.`);
    if (!uniqueStrings(entry.anchors ?? [])) issue(`ROADMAP-SOURCES.json entry '${path}' anchors must be unique non-empty strings.`);
  }
  return manifest.files;
}

/**
 * Validate the complete roadmap and return its deterministic derived index.
 * All errors are accumulated so CLI output is actionable in one pass.
 */
export function validateRoadmap(source, { rootDir = PLUGIN_ROOT, sourceManifest, roadmapInventory, skipCheckedViews = false } = {}) {
  const parsed = asParsed(source);
  const issues = [];
  const issue = (message) => issues.push(message);
  const model = buildModel(parsed);
  const sourceManifestFiles = loadSourceManifest(rootDir, sourceManifest, issue);
  const inventoryIds = loadRoadmapInventory(rootDir, roadmapInventory, issue);
  const referencedSourcePaths = new Set();
  const sourceTreePresent = existsSync(join(rootDir, "src"));

  const globalIds = new Map();
  for (const entry of parsed.entries) {
    const expectedKind = FENCE_TO_KIND[entry.fence];
    const record = entry.record;
    const label = sourceLocation(entry);
    if (!isPlainObject(record)) {
      issue(`${label}: every flattened fence item must be an object.`);
      continue;
    }
    if (record.schemaVersion !== 1) issue(`${label}: schemaVersion must be 1.`);
    if (expectedKind === "gap") {
      if (record.recordType !== "gap") issue(`${label}: recordType must be 'gap' for ${entry.fence}.`);
      if (!["capability", "dependency", "evidence"].includes(record.kind)) issue(`${label}: gap kind must be capability, dependency, or evidence.`);
    } else if (record.kind !== expectedKind) {
      issue(`${label}: kind must be '${expectedKind}' for ${entry.fence}.`);
    }
    if (!ID_PATTERNS[expectedKind].test(record.id ?? "")) issue(`${label}: invalid ${expectedKind} ID '${String(record.id)}'.`);
    if (globalIds.has(record.id)) issue(`${label}: duplicate global ID '${record.id}', first seen at ${globalIds.get(record.id)}.`);
    else if (nonEmptyString(record.id)) globalIds.set(record.id, label);

    const required = REQUIRED_KEYS[expectedKind];
    for (const key of required) {
      // `kind` is both the record discriminator and the compact gap-kind field.
      if (!(key in record)) issue(`${label}: missing required field '${key}'.`);
    }
    for (const key of Object.keys(record)) {
      if (!ALLOWED_KEYS[expectedKind].has(key)) issue(`${label}: unknown field '${key}'.`);
    }
  }

  if (inventoryIds) {
    for (const kind of INVENTORY_KINDS) {
      const roadmapRecords = new Map(parsed.byKind[kind]
        .filter((record) => nonEmptyString(record?.id))
        .map((record) => [record.id, inventoryRecord(kind, record)]));
      const inventoriedRecords = new Map((inventoryIds[kind] ?? []).map((record) => [record.id, record]));
      const removed = [...inventoriedRecords.keys()].filter((id) => !roadmapRecords.has(id));
      const unregistered = [...roadmapRecords.keys()].filter((id) => !inventoriedRecords.has(id));
      for (const id of removed) issue(`Immutable roadmap inventory ID '${id}' (${kind}) must be preserved in ROADMAP.md.`);
      for (const id of unregistered) issue(`Roadmap ${kind} ID '${id}' must be appended to ROADMAP-INVENTORY.json.`);
      for (const [id, identity] of roadmapRecords) {
        if (inventoriedRecords.has(id) && JSON.stringify(inventoriedRecords.get(id)) !== JSON.stringify(identity)) {
          issue(`Immutable roadmap inventory ID '${id}' cannot change its kind-specific identity.`);
        }
      }
    }
  }

  const expected = new Set(EXPECTED_SEED_TASK_IDS);
  const actual = new Set(model.task.keys());
  const missingTasks = [...expected].filter((id) => !actual.has(id));
  if (missingTasks.length > 0) {
    issue(`All 54 canonical seed task IDs must be preserved; missing [${missingTasks.join(", ")}].`);
  }

  const semanticFingerprints = new Map();
  const capabilityKeys = new Map();
  for (const [kind, records] of Object.entries(parsed.byKind)) {
    for (const record of records) {
      if (!isPlainObject(record) || !nonEmptyString(record.id)) continue;
      if (!nonEmptyString(record.capabilityKey) || !record.capabilityKey.includes(".")) {
        issue(`${record.id}: capabilityKey must be a non-empty namespaced key.`);
      } else if (capabilityKeys.has(record.capabilityKey)) {
        issue(`${capabilityCollision(record.capabilityKey, capabilityKeys.get(record.capabilityKey), { kind, id: record.id })}.`);
      } else {
        capabilityKeys.set(record.capabilityKey, { kind, id: record.id });
      }
      const fingerprint = kind === "task"
        ? `${record.category}|${normalizedText(record.title)}|${normalizedText(record.why)}`
        : kind === "unlock"
          ? `${record.from}|${record.to}|${record.relation}|${record.capabilityKey}`
          : kind === "goal"
            ? `${record.capabilityKey}|${normalizedText(record.outcome)}`
            : kind === "trajectory"
              ? `${record.goalId}|${record.strategyKey}|${[...(record.unlockIds ?? [])].sort().join(",")}`
              : `${record.trajectoryId}|${normalizedText(record.missingCapability)}`;
      const key = `${kind}:${fingerprint}`;
      if (semanticFingerprints.has(key)) issue(`${record.id}: semantic duplicate of ${semanticFingerprints.get(key)}.`);
      else semanticFingerprints.set(key, record.id);
    }
  }

  for (const task of model.task.values()) {
    const label = task.id;
    if (!["proposed", "planned", "ready", "active", "blocked", "done", "deferred", "dropped", "superseded"].includes(task.status)) issue(`${label}: unsupported status '${task.status}'.`);
    if (!["ready", "gated", "done"].includes(task.readiness)) issue(`${label}: readiness must be ready, gated, or done.`);
    if (!["none", "partial", "strong-foundation"].includes(task.baseline)) issue(`${label}: invalid baseline '${task.baseline}'.`);
    if (typeof task.independent !== "boolean") issue(`${label}: independent must be boolean.`);
    for (const key of ["title", "category", "capabilityKey", "helps", "why", "unlocks"]) {
      if (!nonEmptyString(task[key])) issue(`${label}: ${key} must be a non-empty string.`);
    }
    if (task.status === "done") {
      if (!nonEmptyStrings(task.completionEvidence)) issue(`${label}: done tasks require non-empty completionEvidence.`);
      else if (task.completionEvidence.some((entry) => (task.evidence ?? []).includes(entry))) {
        issue(`${label}: completionEvidence must be distinct from baseline evidence.`);
      }
    } else if (task.completionEvidence !== undefined && !nonEmptyStrings(task.completionEvidence)) {
      issue(`${label}: completionEvidence must be a non-empty string array when present.`);
    }
    if (!uniqueStrings(task.unlockIds)) issue(`${label}: unlockIds must contain unique non-empty IDs.`);
    for (const key of ["acceptance", "evidence"]) {
      if (!nonEmptyStrings(task[key])) issue(`${label}: ${key} must be a non-empty string array.`);
    }
    if (!Array.isArray(task.sourceSeams) || task.sourceSeams.length === 0) {
      issue(`${label}: sourceSeams must be a non-empty array.`);
    } else {
      for (const seam of task.sourceSeams) {
        const descriptor = sourceSeamDescriptor(seam, label, issue);
        if (!descriptor) continue;
        const { path: seamPath, anchor, span } = descriptor;
        const absolute = resolveSourceSeam(rootDir, seamPath, label, issue);
        if (!absolute) continue;
        referencedSourcePaths.add(seamPath);
        const manifestEntry = sourceManifestFiles[seamPath];
        if (!isPlainObject(manifestEntry)) {
          issue(`${label}: source seam file '${seamPath}' is absent from ROADMAP-SOURCES.json.`);
          continue;
        }
        if (anchor && !(manifestEntry.anchors ?? []).includes(anchor)) {
          issue(`${label}: anchor '${anchor}' is absent from the '${seamPath}' source manifest entry.`);
        }
        if (span) {
          if (span[0] < 1 || span[1] < span[0] || span[1] > manifestEntry.lineCount) {
            issue(`${label}: source seam '${seamPath}:${span[0]}-${span[1]}' is outside 1-${manifestEntry.lineCount}.`);
          }
        }
        // Source checkouts prove that the shipped manifest still describes the
        // real files. Installed caches intentionally omit src/ and validate
        // bounded seams against this integrity manifest instead.
        if (existsSync(absolute)) {
          let contents;
          try {
            contents = readFileSync(absolute, "utf8");
          } catch {
            issue(`${label}: source seam '${seamPath}' is not a readable file.`);
            continue;
          }
          contents = canonicalSourceText(contents);
          const actualHash = createHash("sha256").update(contents).digest("hex");
          const actualLineCount = contents.split("\n").length;
          if (actualHash !== manifestEntry.sha256 || actualLineCount !== manifestEntry.lineCount) {
            issue(`${label}: source seam '${seamPath}' does not match ROADMAP-SOURCES.json; refresh the manifest from the source checkout.`);
          }
          if (anchor) {
            const occurrences = exactOccurrenceCount(contents, anchor);
            if (occurrences !== 1) issue(`${label}: anchor '${anchor}' must occur exactly once in '${seamPath}'; found ${occurrences}.`);
          }
        } else if (sourceTreePresent) {
          issue(`${label}: source checkout is missing manifest-tracked seam file '${seamPath}'.`);
        }
      }
    }
  }
  const declaredSourcePaths = Object.keys(sourceManifestFiles).sort();
  const referencedPaths = [...referencedSourcePaths].sort();
  if (JSON.stringify(declaredSourcePaths) !== JSON.stringify(referencedPaths)) {
    const missing = referencedPaths.filter((path) => !sourceManifestFiles[path]);
    const unused = declaredSourcePaths.filter((path) => !referencedSourcePaths.has(path));
    issue(`ROADMAP-SOURCES.json must exactly cover sourceSeams; missing [${missing.join(", ")}], unused [${unused.join(", ")}].`);
  }

  for (const unlock of model.unlock.values()) {
    for (const key of ["from", "to", "capabilityKey", "rationale", "verification", "helps", "why", "unlocks"]) {
      if (!nonEmptyString(unlock[key])) issue(`${unlock.id}: ${key} must be a non-empty string.`);
    }
    if (!["requires", "enhances", "bridge"].includes(unlock.relation)) issue(`${unlock.id}: invalid relation '${unlock.relation}'.`);
    if (!['active', 'superseded'].includes(unlock.lifecycleState ?? "active")) issue(`${unlock.id}: lifecycleState must be active or superseded.`);
    if (!model.task.has(unlock.from)) issue(`${unlock.id}: from '${unlock.from}' must resolve to a task.`);
    if (!model.task.has(unlock.to) && !model.goal.has(unlock.to)) issue(`${unlock.id}: to '${unlock.to}' must resolve to a task or goal.`);
    if (unlock.from === unlock.to) issue(`${unlock.id}: self edges are forbidden.`);
    if (unlock.relation === "requires" && !model.task.has(unlock.to)) issue(`${unlock.id}: requires edges may target tasks only.`);
    if (unlock.relation === "bridge") {
      for (const key of ["gapId", "gap", "exitCriterion"]) {
        if (!nonEmptyString(unlock[key])) issue(`${unlock.id}: bridge field '${key}' must be non-empty.`);
      }
    } else if (["gapId", "gap", "exitCriterion"].some((key) => key in unlock)) {
      issue(`${unlock.id}: only bridge edges may carry gap fields.`);
    }
    if (isActiveUnlock(unlock)) {
      if (isSupersededRecord("task", model.task.get(unlock.from))) issue(`${unlock.id}: active unlock cannot originate from superseded task '${unlock.from}'.`);
      if (model.task.has(unlock.to) && isSupersededRecord("task", model.task.get(unlock.to))) issue(`${unlock.id}: active unlock cannot target superseded task '${unlock.to}'.`);
      if (model.goal.has(unlock.to) && isSupersededRecord("goal", model.goal.get(unlock.to))) issue(`${unlock.id}: active unlock cannot target superseded goal '${unlock.to}'.`);
    }
  }


  validateSupersessions(model, issue);

  const seedTaskIds = new Set(EXPECTED_SEED_TASK_IDS);
  for (const task of model.task.values()) {
    if (seedTaskIds.has(task.id)) continue;
    const incident = [...model.unlock.values()].some((edge) => isActiveUnlock(edge) && (edge.from === task.id || edge.to === task.id));
    if (!incident) issue(`${task.id}: post-seed tasks require at least one incident active unlock edge.`);
  }

  for (const task of model.task.values()) {
    const outgoing = [...model.unlock.values()].filter((edge) => isActiveUnlock(edge) && edge.from === task.id).map((edge) => edge.id).sort();
    const declared = Array.isArray(task.unlockIds) ? [...task.unlockIds].sort() : [];
    if (JSON.stringify(outgoing) !== JSON.stringify(declared)) {
      issue(`${task.id}: unlockIds must exactly equal outgoing unlocks; expected [${outgoing.join(", ")}].`);
    }
    const incomingHard = [...model.unlock.values()].filter((edge) => isActiveUnlock(edge) && edge.relation === "requires" && edge.to === task.id);
    const derivedReadiness = task.status === "done"
      ? "done"
      : incomingHard.every((edge) => model.task.get(edge.from)?.status === "done")
        ? "ready"
        : "gated";
    if (task.readiness !== derivedReadiness) issue(`${task.id}: readiness '${task.readiness}' disagrees with derived '${derivedReadiness}'.`);
    if (task.status === "done" && incomingHard.some((edge) => model.task.get(edge.from)?.status !== "done")) {
      issue(`${task.id}: done task has incomplete hard prerequisites.`);
    }
  }

  const cycle = hardCycle(model.task, model.unlock);
  if (cycle) issue(`Hard requires dependency cycle: ${cycle.join(" -> ")}.`);

  for (const goal of model.goal.values()) {
    for (const key of ["title", "capabilityKey", "decisionState", "attainmentState", "outcome", "helps", "why", "unlocks"]) {
      if (!nonEmptyString(goal[key])) issue(`${goal.id}: ${key} must be a non-empty string.`);
    }
    for (const key of ["scope", "successMeasures", "nonGoals", "evidence"]) {
      if (!nonEmptyStrings(goal[key])) issue(`${goal.id}: ${key} must be a non-empty string array.`);
    }
    validateHopRange(goal.horizon, `${goal.id}.horizon`, issue, 2, "horizon");
    if (!["proposed", "approved", "rejected", "superseded"].includes(goal.decisionState)) issue(`${goal.id}: invalid decisionState '${goal.decisionState}'.`);
    if (!["planned", "active", "paused", "attained", "abandoned", "superseded"].includes(goal.attainmentState)) issue(`${goal.id}: invalid attainmentState '${goal.attainmentState}'.`);
    if (["active", "paused", "attained"].includes(goal.attainmentState) && goal.decisionState !== "approved") {
      issue(`${goal.id}: active, paused, or attained goals require decisionState approved.`);
    }
    validateApprovalProvenance(goal.approvalProvenance, `${goal.id}.approvalProvenance`, issue, goal.decisionState === "approved");
    if (!nonEmptyString(goal.preferredTrajectoryId)) issue(`${goal.id}: preferredTrajectoryId is required.`);
    if (goal.attainmentState === "attained" && !nonEmptyStrings(goal.attainmentEvidence)) {
      issue(`${goal.id}: attained goals require non-empty attainmentEvidence tied to success measures.`);
    }
    for (const path of strategicAuthorityPaths(goal)) issue(`${goal.id}: strategic object encodes execution authority at '${path}'.`);
  }

  for (const trajectory of model.trajectory.values()) {
    const liveTrajectory = !isRetiredTrajectory(trajectory);
    for (const key of ["goalId", "title", "capabilityKey", "strategyKey", "epistemicState", "decisionState", "materializationState", "helps", "why", "unlocks"]) {
      if (!nonEmptyString(trajectory[key])) issue(`${trajectory.id}: ${key} must be a non-empty string.`);
    }
    for (const key of ["entryTaskIds", "taskIds", "unlockIds", "gapIds", "alternativeTo"]) {
      if (!uniqueStrings(trajectory[key])) issue(`${trajectory.id}: ${key} must be an array of unique IDs.`);
    }
    for (const key of ["assumptions", "disconfirmingSignals"]) {
      if (!nonEmptyStrings(trajectory[key])) issue(`${trajectory.id}: ${key} must be a non-empty string array.`);
    }
    if (!(typeof trajectory.confidence === "number" && trajectory.confidence >= 0 && trajectory.confidence <= 1)) {
      issue(`${trajectory.id}: confidence must be a number from 0 to 1.`);
    }
    validateHopRange(trajectory.hopEstimate, `${trajectory.id}.hopEstimate`, issue, 2);
    if (!["hypothesis", "supported", "validated", "invalidated"].includes(trajectory.epistemicState)) issue(`${trajectory.id}: invalid epistemicState '${trajectory.epistemicState}'.`);
    if (!["proposed", "approved", "rejected", "superseded"].includes(trajectory.decisionState)) issue(`${trajectory.id}: invalid decisionState '${trajectory.decisionState}'.`);
    if (!["unmaterialized", "materialized", "active", "realized"].includes(trajectory.materializationState)) issue(`${trajectory.id}: invalid materializationState '${trajectory.materializationState}'.`);
    if (["active", "realized"].includes(trajectory.materializationState) && trajectory.decisionState !== "approved") {
      issue(`${trajectory.id}: active or realized materialization requires decisionState approved.`);
    }
    validateApprovalProvenance(trajectory.approvalProvenance, `${trajectory.id}.approvalProvenance`, issue, trajectory.decisionState === "approved");
    if (trajectory.nextGapId !== null && !nonEmptyString(trajectory.nextGapId)) issue(`${trajectory.id}: nextGapId must be an ID or null.`);
    if (trajectory.parentGapId !== undefined && !nonEmptyString(trajectory.parentGapId)) issue(`${trajectory.id}: parentGapId must be a non-empty gap ID when present.`);
    if (!model.goal.has(trajectory.goalId)) issue(`${trajectory.id}: unknown goalId '${trajectory.goalId}'.`);
    for (const id of trajectory.entryTaskIds ?? []) if (!model.task.has(id)) issue(`${trajectory.id}: unknown entry task '${id}'.`);
    for (const id of trajectory.taskIds ?? []) if (!model.task.has(id)) issue(`${trajectory.id}: unknown member task '${id}'.`);
    for (const id of trajectory.unlockIds ?? []) if (!model.unlock.has(id)) issue(`${trajectory.id}: unknown unlock '${id}'.`);
    for (const id of trajectory.gapIds ?? []) if (!model.gap.has(id)) issue(`${trajectory.id}: unknown gap '${id}'.`);
    for (const id of trajectory.alternativeTo ?? []) {
      const alternative = model.trajectory.get(id);
      if (!alternative) issue(`${trajectory.id}: unknown alternative trajectory '${id}'.`);
      else if (alternative.goalId !== trajectory.goalId) issue(`${trajectory.id}: alternative '${id}' belongs to another goal.`);
      if (id === trajectory.id) issue(`${trajectory.id}: cannot be an alternative to itself.`);
    }
    if (trajectory.nextGapId && !(trajectory.gapIds ?? []).includes(trajectory.nextGapId)) issue(`${trajectory.id}: nextGapId must be one of gapIds.`);
    if (trajectory.nextGapId) {
      const nextGap = model.gap.get(trajectory.nextGapId);
      if (nextGap && !["open", "researching", "partially-filled"].includes(nextGap.state)) {
        issue(`${trajectory.id}: nextGapId may reference only an unresolved open, researching, or partially-filled gap.`);
      }
    }
    for (const id of trajectory.entryTaskIds ?? []) {
      if (!(trajectory.taskIds ?? []).includes(id)) issue(`${trajectory.id}: entry '${id}' is not a member task.`);
    }
    const allowedNodes = new Set([...(trajectory.taskIds ?? []), trajectory.goalId]);
    const endpointTasks = new Set(trajectory.entryTaskIds ?? []);
    const selectedEdges = [];
    for (const id of trajectory.unlockIds ?? []) {
      const edge = model.unlock.get(id);
      if (!edge) continue;
      selectedEdges.push(edge);
      if (liveTrajectory && !isActiveUnlock(edge)) issue(`${trajectory.id}: selected unlock '${id}' is superseded and history-only.`);
      if (liveTrajectory && !["requires", "bridge"].includes(edge.relation)) {
        issue(`${trajectory.id}: selected unlock '${id}' must be requires or bridge, not '${edge.relation}'.`);
      }
      if (!allowedNodes.has(edge.from) || !allowedNodes.has(edge.to)) issue(`${trajectory.id}: unlock '${id}' leaves the trajectory member/goal set.`);
      if (model.task.has(edge.from)) endpointTasks.add(edge.from);
      if (model.task.has(edge.to)) endpointTasks.add(edge.to);
    }
    const members = [...new Set(trajectory.taskIds ?? [])].sort();
    for (const member of liveTrajectory ? members : []) {
      if (isSupersededRecord("task", model.task.get(member))) issue(`${trajectory.id}: selected task '${member}' is superseded and history-only.`);
    }
    for (const gapId of liveTrajectory ? (trajectory.gapIds ?? []) : []) {
      const gap = model.gap.get(gapId);
      if (gap && ["invalidated", "superseded"].includes(gap.state)) issue(`${trajectory.id}: selected gap '${gapId}' is retired and history-only.`);
    }
    if (JSON.stringify([...endpointTasks].sort()) !== JSON.stringify(members)) issue(`${trajectory.id}: taskIds must exactly match entry and unlock task endpoints.`);

    const selectedIncoming = new Map(members.map((id) => [id, []]));
    const selectedOutgoing = new Map([...members, trajectory.goalId].map((id) => [id, []]));
    for (const edge of selectedEdges.filter((candidate) => (liveTrajectory ? isActiveUnlock(candidate) : true) && ["requires", "bridge"].includes(candidate.relation))) {
      if (edge.relation === "requires" && selectedIncoming.has(edge.to)) selectedIncoming.get(edge.to).push(edge);
      if (selectedOutgoing.has(edge.from)) selectedOutgoing.get(edge.from).push(edge);
    }
    const selectedRoots = members.filter((id) => (selectedIncoming.get(id) ?? []).length === 0).sort();
    const declaredEntries = [...new Set(trajectory.entryTaskIds ?? [])].sort();
    if (JSON.stringify(selectedRoots) !== JSON.stringify(declaredEntries)) {
      issue(`${trajectory.id}: entryTaskIds must exactly equal selected-subgraph roots; expected [${selectedRoots.join(", ")}].`);
    }

    const forward = new Set(declaredEntries);
    const forwardPending = [...declaredEntries];
    while (forwardPending.length > 0) {
      const node = forwardPending.pop();
      for (const edge of selectedOutgoing.get(node) ?? []) {
        if (!forward.has(edge.to)) {
          forward.add(edge.to);
          forwardPending.push(edge.to);
        }
      }
    }
    const reverse = new Map();
    for (const edge of selectedEdges.filter((candidate) => (liveTrajectory ? isActiveUnlock(candidate) : true) && ["requires", "bridge"].includes(candidate.relation))) {
      if (!reverse.has(edge.to)) reverse.set(edge.to, []);
      reverse.get(edge.to).push(edge.from);
    }
    const backward = new Set([trajectory.goalId]);
    const backwardPending = [trajectory.goalId];
    while (backwardPending.length > 0) {
      const node = backwardPending.pop();
      for (const parent of reverse.get(node) ?? []) {
        if (!backward.has(parent)) {
          backward.add(parent);
          backwardPending.push(parent);
        }
      }
    }
    for (const member of members) {
      if (!forward.has(member)) issue(`${trajectory.id}: member '${member}' is not forward-reachable from an entry root.`);
      if (!backward.has(member)) issue(`${trajectory.id}: member '${member}' cannot reach goal '${trajectory.goalId}'.`);
    }
    for (const member of liveTrajectory ? members.filter((id) => !selectedRoots.includes(id)) : []) {
      const globalIncoming = [...model.unlock.values()]
        .filter((edge) => isActiveUnlock(edge) && edge.relation === "requires" && edge.to === member);
      for (const edge of globalIncoming) {
        if (!members.includes(edge.from) || !(trajectory.unlockIds ?? []).includes(edge.id)) {
          issue(`${trajectory.id}: non-entry member '${member}' must include global hard prerequisite '${edge.id}' from '${edge.from}'.`);
        }
      }
    }
    const taskCount = members.length;
    if (liveTrajectory && Number.isInteger(trajectory.hopEstimate?.min)
        && (taskCount < trajectory.hopEstimate.min
          || (Number.isInteger(trajectory.hopEstimate.max) && taskCount > trajectory.hopEstimate.max))) {
      issue(`${trajectory.id}: ${taskCount} required tasks must fit hopEstimate ${trajectory.hopEstimate.min}-${trajectory.hopEstimate.max ?? "unknown"}.`);
    }
    if (trajectory.materializationState === "realized") {
      if (trajectory.decisionState !== "approved" || trajectory.epistemicState !== "validated") {
        issue(`${trajectory.id}: realized trajectories must be approved and epistemically validated.`);
      }
      const incomplete = members.filter((id) => model.task.get(id)?.status !== "done");
      if (incomplete.length > 0) issue(`${trajectory.id}: realized trajectory has incomplete tasks [${incomplete.join(", ")}].`);
      const unresolved = (trajectory.gapIds ?? []).filter((id) => model.gap.get(id)?.state !== "filled");
      if (unresolved.length > 0) issue(`${trajectory.id}: realized trajectory has unresolved gaps [${unresolved.join(", ")}].`);
    }
    for (const path of strategicAuthorityPaths(trajectory)) issue(`${trajectory.id}: strategic object encodes execution authority at '${path}'.`);
  }

  for (const gap of model.gap.values()) {
    const retiredGap = isRetiredRecord("gap", gap);
    for (const key of ["trajectoryId", "capabilityKey", "state", "missingCapability", "exitCriterion", "helps", "why", "unlocks"]) {
      if (!nonEmptyString(gap[key])) issue(`${gap.id}: ${key} must be a non-empty string.`);
    }
    for (const key of ["fromAnchorIds", "filledByIds"]) {
      if (!uniqueStrings(gap[key])) issue(`${gap.id}: ${key} must be an array of unique IDs.`);
    }
    if (!nonEmptyStrings(gap.evidence)) issue(`${gap.id}: evidence must be a non-empty string array.`);
    validateHopRange(gap.hopEstimate, `${gap.id}.hopEstimate`, issue, 1);
    if (!["open", "researching", "partially-filled", "filled", "invalidated", "superseded"].includes(gap.state)) issue(`${gap.id}: invalid state '${gap.state}'.`);
    const trajectory = model.trajectory.get(gap.trajectoryId);
    if (!trajectory) issue(`${gap.id}: unknown trajectoryId '${gap.trajectoryId}'.`);
    else if (!(trajectory.gapIds ?? []).includes(gap.id)) issue(`${gap.id}: trajectory '${trajectory.id}' does not reciprocally list the gap.`);
    for (const anchor of gap.fromAnchorIds ?? []) {
      if (!model.task.has(anchor)) issue(`${gap.id}: fromAnchorId '${anchor}' must resolve to a task.`);
    }
    // Open gaps carry bounded competing candidates. Once a route is partially
    // filled, filledByIds is materialized lineage and may contain the full task set.
    if (gap.state === "open" && (gap.filledByIds ?? []).length > 3) issue(`${gap.id}: at most 3 candidate fillers are allowed for an open gap.`);
    if (["partially-filled", "filled"].includes(gap.state) && (gap.filledByIds ?? []).length === 0) {
      issue(`${gap.id}: ${gap.state} gaps require at least one filledById.`);
    }
    const completion = gap.completionEvidence;
    if (gap.state === "filled" && (!isPlainObject(completion)
        || JSON.stringify(Object.keys(completion).sort()) !== JSON.stringify(["evidenceRefs", "exitCriterion"]))) {
      issue(`${gap.id}: filled gaps require completionEvidence with exactly exitCriterion and evidenceRefs.`);
    } else if (completion !== undefined) {
      if (!retiredGap && gap.state !== "filled") {
        issue(`${gap.id}: completionEvidence is allowed only for filled or retired gaps.`);
      } else if (!isPlainObject(completion)
          || JSON.stringify(Object.keys(completion).sort()) !== JSON.stringify(["evidenceRefs", "exitCriterion"])) {
        issue(`${gap.id}: completionEvidence must contain exactly exitCriterion and evidenceRefs.`);
      } else {
        if (completion.exitCriterion !== gap.exitCriterion) issue(`${gap.id}: completionEvidence.exitCriterion must preserve the gap exitCriterion verbatim.`);
        if (!nonEmptyStrings(completion.evidenceRefs)) issue(`${gap.id}: completionEvidence.evidenceRefs must be a non-empty string array.`);
      }
    }
    for (const id of gap.filledByIds ?? []) {
      const fillerTask = model.task.get(id);
      const fillerTrajectory = model.trajectory.get(id);
      if (!fillerTask && !fillerTrajectory) {
        issue(`${gap.id}: filledById '${id}' must resolve to a task or child trajectory.`);
      } else if (fillerTask) {
        if (trajectory && !(trajectory.taskIds ?? []).includes(id)) issue(`${gap.id}: task filler '${id}' must belong to parent trajectory '${trajectory.id}'.`);
        if (gap.state === "filled" && fillerTask.status !== "done") issue(`${gap.id}: filled gap task filler '${id}' must have status done.`);
      } else {
        if (retiredGap && !isRetiredTrajectory(fillerTrajectory)) issue(`${gap.id}: retired gap may retain only retired trajectory filler '${id}'.`);
        if (!retiredGap && isRetiredTrajectory(fillerTrajectory)) issue(`${gap.id}: active gap trajectory filler '${id}' must be non-retired.`);
        if (trajectory && fillerTrajectory.goalId !== trajectory.goalId) issue(`${gap.id}: trajectory filler '${id}' must target goal '${trajectory.goalId}'.`);
        if (fillerTrajectory.parentGapId !== gap.id) issue(`${gap.id}: trajectory filler '${id}' must declare parentGapId '${gap.id}'.`);
        if (gap.state === "filled" && fillerTrajectory.materializationState !== "realized") {
          issue(`${gap.id}: filled gap trajectory filler '${id}' must be realized.`);
        }
      }
    }
    for (const path of strategicAuthorityPaths(gap)) issue(`${gap.id}: strategic object encodes execution authority at '${path}'.`);
  }

  const childGapListings = new Map();
  for (const gap of model.gap.values()) {
    for (const fillerId of gap.filledByIds ?? []) {
      if (!model.trajectory.has(fillerId)) continue;
      if (!childGapListings.has(fillerId)) childGapListings.set(fillerId, []);
      childGapListings.get(fillerId).push(gap.id);
    }
  }
  for (const trajectory of model.trajectory.values()) {
    if (trajectory.parentGapId === undefined) continue;
    const parentGap = model.gap.get(trajectory.parentGapId);
    if (!parentGap) issue(`${trajectory.id}: parentGapId '${trajectory.parentGapId}' does not resolve.`);
    else if (!(parentGap.filledByIds ?? []).includes(trajectory.id)) issue(`${trajectory.id}: parent gap '${parentGap.id}' must reciprocally list it in filledByIds.`);
    const listings = childGapListings.get(trajectory.id) ?? [];
    if (listings.length !== 1) issue(`${trajectory.id}: child trajectory must be listed by exactly one parent gap; found [${listings.join(", ")}].`);
  }

  const bridgesByGap = new Map();
  for (const edge of model.unlock.values()) {
    if (edge.relation !== "bridge") continue;
    const gap = model.gap.get(edge.gapId);
    const retiredGap = gap && isRetiredRecord("gap", gap);
    if (retiredGap && isActiveUnlock(edge)) issue(`${edge.id}: active bridge cannot reference retired gap '${gap.id}'.`);
    if ((!retiredGap && !isActiveUnlock(edge)) || (retiredGap && isActiveUnlock(edge))) continue;
    if (!bridgesByGap.has(edge.gapId)) bridgesByGap.set(edge.gapId, []);
    bridgesByGap.get(edge.gapId).push(edge);
    if (!gap) {
      issue(`${edge.id}: bridge gapId '${edge.gapId}' does not resolve.`);
      continue;
    }
    const trajectory = model.trajectory.get(gap.trajectoryId);
    if (trajectory && !(trajectory.unlockIds ?? []).includes(edge.id)) issue(`${edge.id}: gap trajectory '${trajectory.id}' does not list the bridge unlock.`);
    if (trajectory && !(trajectory.taskIds ?? []).includes(edge.from)) issue(`${edge.id}: bridge source '${edge.from}' is not a trajectory member.`);
    if (trajectory && edge.to !== trajectory.goalId) issue(`${edge.id}: bridge target must equal trajectory goal '${trajectory.goalId}'.`);
    if (trajectory) {
      for (const anchor of gap.fromAnchorIds ?? []) {
        if (!(trajectory.taskIds ?? []).includes(anchor)) issue(`${gap.id}: anchor '${anchor}' is not a trajectory member.`);
      }
    }
  }
  for (const gap of model.gap.values()) {
    const bridges = bridgesByGap.get(gap.id) ?? [];
    if (bridges.length !== 1) issue(`${gap.id}: exactly one reciprocal bridge unlock is required; found ${bridges.length}.`);
  }

  for (const goal of model.goal.values()) {
    const live = [...model.trajectory.values()].filter((trajectory) => trajectory.goalId === goal.id && !isRetiredTrajectory(trajectory));
    if (!isRetiredGoal(goal) && live.length === 0) issue(`${goal.id}: active goal must have a live trajectory.`);
    if (!isRetiredGoal(goal) && live.length > 3) issue(`${goal.id}: at most 3 live trajectories are allowed; found ${live.length}.`);
    const preferred = model.trajectory.get(goal.preferredTrajectoryId);
    if (!preferred) issue(`${goal.id}: preferred trajectory '${goal.preferredTrajectoryId}' does not resolve.`);
    else {
      if (preferred.goalId !== goal.id) issue(`${goal.id}: preferred trajectory belongs to '${preferred.goalId}'.`);
      if (!isRetiredGoal(goal) && goal.decisionState === "approved" && preferred.decisionState !== "approved") {
        issue(`${goal.id}: approved goal requires an approved preferred trajectory.`);
      }
      if (!isRetiredGoal(goal) && isRetiredTrajectory(preferred)) issue(`${goal.id}: preferred trajectory is retired or invalidated.`);
      const invalidatedGaps = (preferred.gapIds ?? []).filter((id) => model.gap.get(id)?.state === "invalidated");
      if (!isRetiredGoal(goal) && invalidatedGaps.length > 0) issue(`${goal.id}: preferred trajectory has invalidated gaps [${invalidatedGaps.join(", ")}].`);
      const goalMin = goal.horizon?.minHops;
      const goalMax = goal.horizon?.maxHops;
      const trajectoryMin = preferred.hopEstimate?.min;
      const trajectoryMax = preferred.hopEstimate?.max;
      if (!isRetiredGoal(goal) && Number.isInteger(goalMin) && Number.isInteger(trajectoryMin)
          && (trajectoryMin < goalMin
            || (Number.isInteger(goalMax) && (!Number.isInteger(trajectoryMax) || trajectoryMax > goalMax)))) {
        issue(`${goal.id}: preferred trajectory hopEstimate ${trajectoryMin}-${trajectoryMax ?? "unknown"} must fit horizon ${goalMin}-${goalMax ?? "unknown"}.`);
      }
      if (goal.attainmentState === "attained") {
        if (goal.decisionState !== "approved") issue(`${goal.id}: attained goals must be approved.`);
        if (preferred.materializationState !== "realized") issue(`${goal.id}: attained goal requires its preferred trajectory to be realized.`);
      }
    }
    const fingerprints = new Map();
    for (const trajectory of isRetiredGoal(goal) ? [] : live) {
      const fingerprint = [...(trajectory.unlockIds ?? [])].sort().join("\0");
      if (fingerprints.has(fingerprint)) issue(`${goal.id}: live trajectories '${fingerprints.get(fingerprint)}' and '${trajectory.id}' have duplicate edge sets.`);
      else fingerprints.set(fingerprint, trajectory.id);
    }
  }

  const index = deriveRoadmapIndex(parsed);
  for (const goal of model.goal.values()) {
    if (isRetiredGoal(goal)) continue;
    const preferred = index.trajectories[goal.preferredTrajectoryId];
    if (preferred && (preferred.shortestPathHops === null || preferred.shortestPathHops < 2)) {
      issue(`${goal.preferredTrajectoryId}: primary trajectory must have a reachable route of at least 2 hops.`);
    }
  }

  if (!skipCheckedViews) validateCheckedInViews(parsed, model, issue);

  if (issues.length > 0) throw new RoadmapValidationError(issues);
  return index;
}

function summary(parsed) {
  return Object.entries(parsed.byKind)
    .map(([kind, records]) => {
      const plural = kind === "trajectory" ? "trajectories" : `${kind}s`;
      return `${records.length} ${records.length === 1 ? kind : plural}`;
    })
    .join(", ");
}

async function main() {
  const [command, requestedPath, ...rest] = process.argv.slice(2);
  if (!["--check", "--print-index", "--print-views", "--refresh-sources", "--append-inventory", "--refresh-views"].includes(command) || rest.length > 0) {
    throw new Error("Usage: node scripts/roadmap.mjs --check|--print-index|--print-views|--refresh-sources|--append-inventory|--refresh-views [ROADMAP.md]");
  }
  const canonicalRoot = await realpath(PLUGIN_ROOT);
  const canonicalRoadmapPath = await realpath(join(canonicalRoot, "ROADMAP.md"));
  const requestedRoadmapPath = resolve(process.cwd(), requestedPath ?? canonicalRoadmapPath);
  let roadmapPath;
  try {
    roadmapPath = await realpath(requestedRoadmapPath);
  } catch {
    throw new Error(`Roadmap path '${requestedRoadmapPath}' does not resolve to the plugin ROADMAP.md.`);
  }
  // Compare the path as given as well as its realpath. Resolving alone would accept a symlink that
  // points at the canonical file, which is a different path naming the same bytes — the guard exists
  // to pin the address, not just the contents.
  if (roadmapPath !== canonicalRoadmapPath || requestedRoadmapPath !== canonicalRoadmapPath) {
    throw new Error(`Roadmap path must be canonical plugin file '${canonicalRoadmapPath}'.`);
  }
  const source = await readFile(roadmapPath, "utf8");
  const parsed = parseRoadmap(source);
  const mutating = ["--refresh-sources", "--append-inventory", "--refresh-views"].includes(command);
  if (mutating && !existsSync(join(canonicalRoot, "src"))) {
    throw new Error("Mutating roadmap maintenance commands require the canonical source checkout; installed caches are read-only.");
  }
  const atomicWrite = async (targetPath, contents) => {
    const temporaryPath = join(canonicalRoot, `.${basename(targetPath)}.${process.pid}.tmp`);
    try {
      await writeFile(temporaryPath, contents, { mode: 0o644 });
      await rename(temporaryPath, targetPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  };
  if (command === "--refresh-sources") {
    const manifest = generateSourceManifest(parsed, { rootDir: canonicalRoot });
    const manifestPath = join(canonicalRoot, "ROADMAP-SOURCES.json");
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Refreshed ${manifestPath} from ${Object.keys(manifest.files).length} referenced source files.\n`);
    return;
  }
  if (command === "--append-inventory") {
    const inventoryPath = join(canonicalRoot, "ROADMAP-INVENTORY.json");
    if (!existsSync(inventoryPath)) throw new Error("ROADMAP-INVENTORY.json must exist before append-only updates.");
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    const updated = appendRoadmapInventory(parsed, inventory, { rootDir: canonicalRoot });
    await atomicWrite(inventoryPath, `${JSON.stringify(updated, null, 2)}\n`);
    process.stdout.write(`Appended current IDs to ${inventoryPath}; inventory remains append-only.\n`);
    return;
  }
  if (command === "--refresh-views") {
    // View refresh intentionally precedes the conditional checked source-manifest
    // refresh. Validate against current source integrity in memory so source drift
    // cannot deadlock the documented sequence or weaken semantic validation.
    const prospectiveSourceManifest = generateSourceManifest(parsed, { rootDir: canonicalRoot });
    validateRoadmap(parsed, {
      rootDir: canonicalRoot,
      sourceManifest: prospectiveSourceManifest,
      skipCheckedViews: true,
    });
    const proposed = refreshGeneratedViewsSource(source);
    validateRoadmap(proposed, { rootDir: canonicalRoot, sourceManifest: prospectiveSourceManifest });
    await atomicWrite(roadmapPath, proposed);
    process.stdout.write(`Refreshed canonical roadmap views in ${roadmapPath}.\n`);
    return;
  }
  const index = validateRoadmap(parsed, { rootDir: canonicalRoot, skipCheckedViews: command === "--print-views" });
  if (command === "--print-index") {
    process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
  } else if (command === "--print-views") {
    process.stdout.write(`${renderAllGeneratedViews(parsed).printable}\n`);
  } else {
    process.stdout.write(`ROADMAP OK: ${summary(parsed)}.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof RoadmapValidationError) {
      process.stderr.write(`ROADMAP INVALID (${error.issues.length} errors):\n${error.issues.map((entry) => `- ${entry}`).join("\n")}\n`);
    } else if (error instanceof RoadmapSourceManifestError) {
      process.stderr.write(`ROADMAP SOURCE REFRESH FAILED (${error.issues.length} errors):\n${error.issues.map((entry) => `- ${entry}`).join("\n")}\n`);
    } else if (error instanceof RoadmapInventoryError) {
      process.stderr.write(`ROADMAP INVENTORY UPDATE FAILED (${error.issues.length} errors):\n${error.issues.map((entry) => `- ${entry}`).join("\n")}\n`);
    } else {
      process.stderr.write(`ROADMAP CHECK FAILED: ${error.message}\n`);
    }
    process.exitCode = 1;
  });
}
