import { watch } from "node:fs";
import { serializeError } from "../errors.mjs";

export const HEARTBEAT_MS = 15_000;
export const POLL_MS = 250;

function writeSse(res, chunk) {
  if (res.writableEnded) return;
  res.write(chunk);
}

function sendEvent(res, event) {
  writeSse(res, `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function attachRunEventStream({ store, runId, after, req, res }) {
  let lastSeq = after;
  let closed = false;
  let initial;
  try {
    initial = await store.events(runId, after);
  } catch (error) {
    if (error?.code === "AO_EVENT_LOG_CORRUPT") {
      res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(serializeError(error)));
      return;
    }
    throw error;
  }

  req.socket?.setNoDelay?.(true);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();
  writeSse(res, ": connected\n\n");

  for (const event of initial) {
    sendEvent(res, event);
    lastSeq = event.seq;
  }

  async function flush() {
    if (closed) return;
    try {
      const events = await store.events(runId, lastSeq);
      for (const event of events) {
        sendEvent(res, event);
        lastSeq = event.seq;
      }
    } catch (error) {
      if (error?.code === "AO_EVENT_LOG_CORRUPT") {
        writeSse(res, `event: error\ndata: ${JSON.stringify(serializeError(error))}\n\n`);
        close();
        return;
      }
      close();
    }
  }

  const heartbeat = setInterval(() => writeSse(res, ": heartbeat\n\n"), HEARTBEAT_MS);
  heartbeat.unref?.();
  const poll = setInterval(() => { flush().catch(() => {}); }, POLL_MS);

  let watcher = null;
  if (process.platform !== "win32") {
    try {
      watcher = watch(store.runDir(runId), { persistent: false }, () => { flush().catch(() => {}); });
    } catch {
      watcher = null;
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    watcher?.close?.();
    if (!res.writableEnded) res.end();
    req.socket?.destroy?.();
  }

  req.on("close", close);
  res.on("close", close);
}
