// Worker thread owning the NATS connection. The main thread's store code is synchronous (30+ call
// sites, hooks that must not become async), so it posts a request and blocks on Atomics.wait; this
// thread answers on a MessagePort and wakes it. See syncbridge.mjs.
import { parentPort, workerData } from "node:worker_threads";
import "./types.mjs";
import { NatsBackend } from "./nats-backend.mjs";

const { sab, port, opts } = workerData;
const sig = new Int32Array(sab);
const notices = [];
const backend = new NatsBackend({ ...opts, onOffline: (m, why) => notices.push({ m, why }) });
const releases = new Map();
let n = 0;

const methods = {
  async acquireLease(owner, o) {
    const release = await backend.acquireLease(owner, o);
    releases.set(++n, release);
    return n;
  },
  async releaseLease(id) {
    await releases.get(id)?.();
    releases.delete(id);
  },
  queue: async () => backend.queue(),
};

parentPort.on("message", async ({ method, args }) => {
  let reply;
  try {
    const fn = methods[method] ?? backend[method]?.bind(backend);
    if (!fn) throw new Error(`no such storage method: ${method}`);
    reply = { ok: true, value: await fn(...args) };
  } catch (e) {
    reply = { ok: false, error: { name: e.name, code: e.code, message: e.message, currentRev: e.currentRev } };
  }
  reply.notices = notices.splice(0);
  port.postMessage(reply);
  Atomics.store(sig, 0, 1);
  Atomics.notify(sig, 0);
});
