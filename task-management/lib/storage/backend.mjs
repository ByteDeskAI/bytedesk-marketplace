/**
 * The storage interface (CONTRACT §2). All methods are async. A backend that cannot do something
 * throws UnsupportedError — it never silently no-ops.
 */
export class ConflictError extends Error {
  constructor(message, currentRev) {
    super(`${message} (current rev: ${currentRev})`);
    this.name = "ConflictError";
    this.code = "CONFLICT";
    this.currentRev = currentRev;
  }
}
export class UnsupportedError extends Error {
  constructor(backend, op) {
    super(`${backend} backend does not support ${op}`);
    this.name = "UnsupportedError";
    this.code = "UNSUPPORTED";
  }
}
export class OfflineError extends Error {
  constructor(message = "offline: read-only, writes queued") {
    super(message);
    this.name = "OfflineError";
    this.code = "OFFLINE";
  }
}

export class Backend {
  get kind() {
    return "abstract";
  }
  #no(op) {
    return Promise.reject(new UnsupportedError(this.kind, op));
  }
  get(type, id) { return this.#no("get"); }                       // -> {envelope, rev}|null
  put(type, id, envelope, opts) { return this.#no("put"); }       // opts {ifRev, reason}; ConflictError
  create(type, id, envelope) { return this.#no("create"); }       // ConflictError if it exists
  delete(type, id, opts) { return this.#no("delete"); }
  list(type, opts) { return this.#no("list"); }                   // opts {prefix} -> [{envelope, rev}]
  history(type, id, opts) { return this.#no("history"); }
  watch(type, opts) { return this.#no("watch"); }                 // async iterator
  blobPut(input) { return this.#no("blobPut"); }                  // Buffer|string|AsyncIterable -> digest
  blobGet(digest) { return this.#no("blobGet"); }
  blobList() { return this.#no("blobList"); }
  appendEvent(event) { return this.#no("appendEvent"); }
  events(opts) { return this.#no("events"); }
  // Shared mutable state with CAS (claims, sessions, the write lease). TM_STATE in NATS.
  stateGet(key) { return this.#no("stateGet"); }                  // -> {value, rev}|null
  statePut(key, value, opts) { return this.#no("statePut"); }     // opts {ifRev}
  stateCreate(key, value) { return this.#no("stateCreate"); }
  stateDelete(key, opts) { return this.#no("stateDelete"); }
  stateList(prefix) { return this.#no("stateList"); }
  info() { return Promise.resolve({ kind: this.kind, server: null, offline: false }); }
  close() { return Promise.resolve(); }
}
