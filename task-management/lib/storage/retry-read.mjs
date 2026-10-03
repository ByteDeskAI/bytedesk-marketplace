// A read the server's death interrupts (TIMEOUT / CONNECTION_CLOSED while the socket is closing) is
// not an answer: once the connection is seen closed, ask again so the backend takes its offline path
// (cache / OFFLINE) instead of surfacing a transport error. Reads only; a repeated write could apply twice.
export const READS = new Set(["get", "list", "history", "blobGet", "blobList", "eventsPage", "events", "eventCount", "stateGet", "stateList", "info"]);

export async function runWithReadRetry(method, fn, args, isClosed) {
  try {
    return await fn(...args);
  } catch (e) {
    if (!READS.has(method) || !isClosed()) throw e;
    return await fn(...args);
  }
}
