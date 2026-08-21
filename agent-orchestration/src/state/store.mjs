import { appendFile, lstat, mkdir, open, readFile, truncate, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson, ensurePrivateDir, newId, processStartIdentity, readJson, sha256 } from "../util.mjs";
import { invariant } from "../errors.mjs";

export const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"]);
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPDATE_FIELDS = new Set([
  "workspace", "sessions", "outputs", "decision", "worker", "lastProviderEvent",
  "lastRouteFallback", "changedPaths", "cancellation",
]);

function assertRunId(runId) {
  invariant(typeof runId === "string" && RUN_ID.test(runId), "AO_INVALID_RUN_ID", "runId is not a broker-issued orchestration ID.");
}

function completeLockRecord(record) {
  return Boolean(record?.nonce && Number.isInteger(record?.pid) && record.pid > 0 && record?.startIdentity && record?.at);
}

function sameFileIdentity(left, right) {
  return Boolean(left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs);
}

function ageFromRecordOrFile(record, info) {
  const recordedAt = record?.at ? Date.parse(record.at) : Number.NaN;
  return Date.now() - (Number.isFinite(recordedAt) ? recordedAt : info.mtimeMs);
}

export class RunStore {
  constructor(root) {
    this.root = root;
  }

  async initialize() {
    await ensurePrivateDir(join(this.root, "runs"));
    await ensurePrivateDir(join(this.root, "locks"));
    await ensurePrivateDir(join(this.root, "sessions"));
    return this;
  }

  runDir(runId) { assertRunId(runId); return join(this.root, "runs", runId); }
  snapshotPath(runId) { return join(this.runDir(runId), "snapshot.json"); }
  eventsPath(runId) { return join(this.runDir(runId), "events.ndjson"); }
  lockPath(lockKey) { return join(this.root, "locks", `${sha256(lockKey)}.lock`); }

  async tryBreakStaleLock(path) {
    const observedInfo = await lstat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!observedInfo) return false;
    const observedRecord = await readJson(path).catch(() => null);
    if (ageFromRecordOrFile(observedRecord, observedInfo) < 1_000) return false;
    if (completeLockRecord(observedRecord) && await processStartIdentity(observedRecord.pid) === observedRecord.startIdentity) return false;

    const breakerPath = `${path}.breaker`;
    let breaker;
    try {
      breaker = await open(breakerPath, "wx", 0o600);
      await breaker.writeFile(JSON.stringify({ pid: process.pid, startIdentity: await processStartIdentity(process.pid), at: new Date().toISOString() }));
      await breaker.sync();
    } catch (error) {
      if (breaker) {
        await breaker.close().catch(() => {});
        await unlink(breakerPath).catch(() => {});
        breaker = null;
      }
      if (error?.code !== "EEXIST") throw error;
      const [breakerRecord, breakerInfo] = await Promise.all([
        readJson(breakerPath).catch(() => null),
        lstat(breakerPath).catch(() => null),
      ]);
      const breakerAge = breakerInfo ? ageFromRecordOrFile(breakerRecord, breakerInfo) : 0;
      const ownerAlive = breakerRecord?.pid && breakerRecord?.startIdentity
        ? await processStartIdentity(breakerRecord.pid) === breakerRecord.startIdentity
        : false;
      if (breakerAge >= 1_000 && !ownerAlive) await unlink(breakerPath).catch(() => {});
      return false;
    }
    try {
      const currentInfo = await lstat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (!sameFileIdentity(observedInfo, currentInfo)) return false;
      const current = await readJson(path).catch(() => null);
      if (completeLockRecord(observedRecord)) {
        if (current?.nonce !== observedRecord.nonce) return false;
      } else if (completeLockRecord(current)) {
        return false;
      }
      if (completeLockRecord(current) && await processStartIdentity(current.pid) === current.startIdentity) return false;
      await unlink(path).catch((error) => { if (error?.code !== "ENOENT") throw error; });
      return true;
    } finally {
      await breaker.close();
      await unlink(breakerPath).catch(() => {});
    }
  }

  async withLock(runId, operation) {
    const path = this.lockPath(runId);
    let handle;
    let nonce;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        handle = await open(path, "wx", 0o600);
        nonce = newId("lock");
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, startIdentity: await processStartIdentity(process.pid), at: new Date().toISOString() }));
        await handle.sync();
        break;
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = undefined;
          await unlink(path).catch(() => {});
        }
        if (error?.code !== "EEXIST") throw error;
        await this.tryBreakStaleLock(path);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    invariant(handle, "AO_LOCK_TIMEOUT", `Timed out acquiring run lock for ${runId}.`);
    try {
      return await operation();
    } finally {
      await handle.close();
      const current = await readJson(path).catch(() => null);
      if (current?.nonce === nonce) await unlink(path).catch(() => {});
    }
  }

  async create(params) {
    await this.initialize();
    if (!params.idempotencyKey) return this.createUnlocked(params);
    const scope = `${params.consumer.repositoryKey}:${params.idempotencyKey}`;
    return this.withLock(`idempotency:${sha256(scope)}`, async () => {
      const existing = await this.findByIdempotencyKey(params.idempotencyKey, params.consumer.repositoryKey);
      return existing ?? this.createUnlocked(params);
    });
  }

  async createUnlocked({ input, consumer, plan, idempotencyKey = null, parentRunId = null }) {
    const runId = newId("run");
    await mkdir(this.runDir(runId), { recursive: false, mode: 0o700 });
    const now = new Date().toISOString();
    const snapshot = {
      schemaVersion: 1,
      runId,
      revision: 0,
      state: "queued",
      createdAt: now,
      updatedAt: now,
      cancelRequestedAt: null,
      idempotencyKey,
      parentRunId,
      input,
      consumer,
      plan,
      workspace: null,
      sessions: [],
      outputs: [],
      error: null,
    };
    await this.appendEventUnlocked(snapshot, "run_created", { state: "queued" });
    await atomicWriteJson(this.snapshotPath(runId), snapshot);
    return snapshot;
  }

  async get(runId) {
    assertRunId(runId);
    // Writers fsync the journal before replacing the snapshot. Reading the
    // snapshot first prevents a concurrent reader from observing a newer
    // snapshot paired with an older journal prefix.
    const snapshot = await readJson(this.snapshotPath(runId)).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    const events = await this.events(runId, 0);
    let journalSnapshot = events[0]?.payload?.snapshot ?? null;
    if (journalSnapshot) {
      for (const event of events.slice(1)) {
        if (event.payload?.snapshot) {
          journalSnapshot = event.payload.snapshot;
          continue;
        }
        journalSnapshot = {
          ...journalSnapshot,
          ...(event.payload?.patch ?? {}),
          ...(event.payload?.to ? { state: event.payload.to } : {}),
          ...(event.type === "cancel_requested" ? { cancelRequestedAt: event.payload.at } : {}),
          revision: event.revision,
          updatedAt: event.payload?.updatedAt ?? event.at,
        };
      }
    }
    invariant(snapshot || journalSnapshot, "AO_RUN_NOT_FOUND", `Run ${runId} does not exist.`);
    if (journalSnapshot && (!snapshot || journalSnapshot.revision > snapshot.revision)) {
      await atomicWriteJson(this.snapshotPath(runId), journalSnapshot);
      return journalSnapshot;
    }
    if (journalSnapshot) {
      invariant(snapshot.revision === journalSnapshot.revision, "AO_STATE_DIVERGENCE", `Run ${runId} snapshot is ahead of its durable journal.`);
    }
    return snapshot;
  }

  async list() {
    const { readdir } = await import("node:fs/promises");
    await this.initialize();
    const ids = (await readdir(join(this.root, "runs"))).filter((id) => RUN_ID.test(id));
    const snapshots = await Promise.all(ids.map((id) => this.get(id)));
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByIdempotencyKey(key, repositoryKey = undefined) {
    return (await this.list()).find((run) => run.idempotencyKey === key && (!repositoryKey || run.consumer.repositoryKey === repositoryKey)) ?? null;
  }

  async transition(runId, expectedStates, nextState, patch = {}, eventType = "state_changed") {
    return this.withLock(runId, async () => {
      const current = await this.get(runId);
      invariant(!TERMINAL_STATES.has(current.state), "AO_TERMINAL_RUN", `Run ${runId} is already terminal.`);
      invariant(expectedStates.includes(current.state), "AO_INVALID_STATE_TRANSITION", `Cannot transition ${runId} from ${current.state} to ${nextState}.`, { expectedStates });
      const next = { ...current, ...patch, state: nextState, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      await this.appendEventUnlocked(next, eventType, { from: current.state, to: nextState, patch });
      await atomicWriteJson(this.snapshotPath(runId), next);
      return next;
    });
  }

  async update(runId, patch, eventType = "run_updated") {
    return this.withLock(runId, async () => {
      const current = await this.get(runId);
      invariant(!TERMINAL_STATES.has(current.state), "AO_TERMINAL_RUN", `Run ${runId} is already terminal.`);
      const fields = Object.keys(patch);
      invariant(fields.every((field) => UPDATE_FIELDS.has(field)), "AO_IMMUTABLE_RUN_FIELD", "Run updates may only change whitelisted mutable fields.", { fields });
      const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      await this.appendEventUnlocked(next, eventType, { patch });
      await atomicWriteJson(this.snapshotPath(runId), next);
      return next;
    });
  }

  async clearWorkspace(runId) {
    return this.withLock(runId, async () => {
      const current = await this.get(runId);
      invariant(TERMINAL_STATES.has(current.state), "AO_RUN_NOT_TERMINAL", `Run ${runId} must be terminal before clearing its workspace.`);
      if (!current.workspace) return current;
      const now = new Date().toISOString();
      const patch = {
        workspace: null,
        cleanup: { workspaceRemovedAt: now },
      };
      const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: now };
      await this.appendEventUnlocked(next, "workspace_removed", { patch });
      await atomicWriteJson(this.snapshotPath(runId), next);
      return next;
    });
  }

  async requestCancel(runId) {
    return this.withLock(runId, async () => {
      const current = await this.get(runId);
      if (TERMINAL_STATES.has(current.state) || current.cancelRequestedAt) return current;
      const now = new Date().toISOString();
      const next = { ...current, cancelRequestedAt: now, revision: current.revision + 1, updatedAt: now };
      await this.appendEventUnlocked(next, "cancel_requested", { at: now });
      await atomicWriteJson(this.snapshotPath(runId), next);
      return next;
    });
  }

  async events(runId, after = 0) {
    assertRunId(runId);
    const text = await readFile(this.eventsPath(runId), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const lines = text.split("\n");
    const events = [];
    let previous = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch {
        const isTornFinalLine = index === lines.length - 1 && !text.endsWith("\n");
        invariant(isTornFinalLine, "AO_EVENT_LOG_CORRUPT", `Run ${runId} has a corrupt event log.`);
        break;
      }
      const { hash, ...base } = event;
      invariant(hash === sha256(JSON.stringify(base)) && event.previousHash === (previous?.hash ?? null) && event.seq === (previous?.seq ?? 0) + 1, "AO_EVENT_LOG_CORRUPT", `Run ${runId} has an invalid event hash chain.`);
      events.push(event);
      previous = event;
    }
    return events.filter((event) => event.seq > after);
  }

  async appendEventUnlocked(snapshot, type, payload) {
    const eventPath = this.eventsPath(snapshot.runId);
    const currentText = await readFile(eventPath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
    if (currentText && !currentText.endsWith("\n")) {
      const lastNewline = currentText.lastIndexOf("\n");
      await truncate(eventPath, lastNewline + 1);
    }
    const existing = await this.events(snapshot.runId, 0);
    const previous = existing.at(-1) ?? null;
    const base = {
      schemaVersion: 1,
      runId: snapshot.runId,
      seq: previous ? previous.seq + 1 : 1,
      at: new Date().toISOString(),
      type,
      revision: snapshot.revision,
      previousHash: previous?.hash ?? null,
      payload: type === "run_created"
        ? { ...payload, snapshot }
        : { ...payload, updatedAt: snapshot.updatedAt },
    };
    const event = { ...base, hash: sha256(JSON.stringify(base)) };
    await appendFile(eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    const handle = await open(eventPath, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    return event;
  }
}
