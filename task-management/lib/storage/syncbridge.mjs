/**
 * Call an async Backend from synchronous code. One worker thread holds the NATS connection; the
 * caller blocks on a shared-memory flag (the same Atomics.wait primitive store.mjs already uses
 * for its lock sleep) and reads the reply with receiveMessageOnPort. One request in flight at a
 * time — the caller is single-threaded and blocked, so there is nothing to interleave.
 *
 * ponytail: no async iterators (watch/events streams) cross this bridge; use the async backend.
 */
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { ConflictError, OfflineError } from "./backend.mjs";
import { ReadOnlySchemaError } from "./registry.mjs";

const ERRORS = { ConflictError, OfflineError };

export class SyncBridge {
  constructor(opts, { timeoutMs = 30_000, onNotice = () => {} } = {}) {
    this.sig = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.timeoutMs = timeoutMs;
    this.onNotice = onNotice;
    this.worker = new Worker(new URL("./bridge-worker.mjs", import.meta.url), {
      workerData: { sab: this.sig.buffer, port: port2, opts },
      transferList: [port2],
    });
    this.worker.unref();
    port1.unref();
  }
  call(method, ...args) {
    Atomics.store(this.sig, 0, 0);
    this.worker.postMessage({ method, args });
    if (Atomics.wait(this.sig, 0, 0, this.timeoutMs) === "timed-out") throw new Error(`storage ${method} timed out after ${this.timeoutMs / 1000}s`);
    const { message } = receiveMessageOnPort(this.port);
    for (const n of message.notices ?? []) this.onNotice(n.m, n.why);
    if (message.ok) return message.value;
    const { name, code, message: text, currentRev } = message.error;
    if (name === "ConflictError") throw Object.assign(new ConflictError("", currentRev), { message: text });
    if (name === "ReadOnlySchemaError") throw Object.assign(new ReadOnlySchemaError("?", "?"), { message: text });
    if (name === "OfflineError") throw new OfflineError(text);
    throw Object.assign(new Error(text), { name, code });
  }
  close() {
    try { this.call("close"); } catch { /* going away */ }
    this.worker.terminate();
  }
}
