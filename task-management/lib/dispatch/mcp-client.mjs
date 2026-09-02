/**
 * A minimal line-delimited JSON-RPC stdio MCP client: initialize, a sequence of
 * tools/call, then out.
 *
 * Extracted from the orchestration dispatch backend so collection (collect.mjs)
 * and dispatch (orchestration.mjs) share exactly one implementation of the
 * channel rules, which both must never break:
 *
 *   1. argv-only, `shell: false`. Everything the server needs to hear travels as
 *      a JSON string on stdin — never as an argv element, never as shell source.
 *   2. Bounded, always: stdout is capped, the whole session is timed, the child
 *      is killed on timeout/error, stdin is never written after it closes, and
 *      stderr is tolerated as free text — orchestration's invariant 5 reserves
 *      stdout for JSON-RPC only, so a non-JSON stdout line is a protocol
 *      violation, while stderr noise is not.
 *   3. Settles exactly once, and every settle ends stdin and kills the child:
 *      the server is per-session, the run is not — closing the channel is how
 *      the server learns its job here is done.
 *
 * The result is `{ ok: true, results }` — one raw JSON-RPC response per call, in
 * order — or `{ ok: false, reason, detail? }`. Mapping a response's envelope to
 * a domain answer is the caller's job; this module owns the wire, not the tools.
 */
import { spawn as nodeSpawn } from "node:child_process";

/** stdout is JSON-RPC frames; 4 MiB of unanswered output means a broken server. */
export const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
/** stderr is diagnostics; only a tail is kept, for failure reasons. */
const STDERR_TAIL = 2000;
/** What we claim to speak. The server accepts the 2024-11-05 generation. */
const PROTOCOL_VERSION = "2024-11-05";

/**
 * One MCP session: initialize → tools/call for each of `calls` ({name, arguments}),
 * in order, waiting for each answer before sending the next.
 *
 *   label     names the server in failure reasons ("orchestration MCP")
 *   timeoutMs bounds the WHOLE session, never the server-side work it started
 *
 * Injectables (spawnImpl/maxBuffer/env) exist for tests; production takes the
 * real child_process.spawn.
 */
export function rpcSession({ bin, argv, env, timeoutMs, maxBuffer = MAX_BUFFER_BYTES, spawnImpl = nodeSpawn, label = "MCP server", timeoutNote = "", calls = [] }) {
  const child = spawnImpl(bin, argv, { shell: false, stdio: ["pipe", "pipe", "pipe"], env });
  return new Promise((resolve) => {
    let buf = "";
    let stderrTail = "";
    let settled = false;
    let stdinOpen = true;
    // The id of the tools/call currently awaiting a response; null while we are
    // still in the initialize handshake.
    let pending = null;
    let nextId = 2;
    const results = [];

    const write = (msg) => {
      // After EOF (or a dead pipe) writing would throw EPIPE — a late response
      // racing a timeout must not crash the settling path.
      if (!stdinOpen || !child.stdin || child.stdin.destroyed || child.stdin.writable === false) return;
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      } catch {
        stdinOpen = false;
      }
    };

    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdinOpen = false;
      try {
        child.stdin?.end?.();
      } catch {
        /* already gone */
      }
      try {
        child.kill?.("SIGTERM");
      } catch {
        /* already gone */
      }
      resolve(res);
    };
    const fail = (reason) => finish({ ok: false, reason, ...(stderrTail.trim() ? { detail: { stderr: stderrTail.trim() } } : {}) });

    const timer = setTimeout(() => fail(`${label} did not answer within ${timeoutMs}ms — the server was killed${timeoutNote ? `; ${timeoutNote}` : ""}`), timeoutMs);

    const sendNextCall = () => {
      const call = calls[results.length];
      if (!call) return finish({ ok: true, results });
      pending = nextId;
      nextId += 1;
      write({ jsonrpc: "2.0", id: pending, method: "tools/call", params: { name: call.name, arguments: call.arguments ?? {} } });
    };

    const handle = (msg) => {
      if (msg.id === undefined || msg.id === null) return; // server notifications: not for us
      if (pending === null) {
        // The initialize response.
        if (msg.error) return fail(`${label} initialize failed: ${msg.error.message ?? msg.error.code}`);
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        sendNextCall();
        return;
      }
      results.push(msg);
      pending = null;
      sendNextCall();
    };

    child.stdin?.on?.("error", () => {
      stdinOpen = false;
    });
    child.on?.("error", (err) => fail(`failed to start ${label}: ${err.message}`));
    child.on?.("exit", (code) => {
      if (!settled) fail(`${label} exited (${code ?? "signal"}) before answering`);
    });
    // Diagnostics, tolerated wholesale; only a tail survives, for failure reasons.
    child.stderr?.on?.("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
    });
    child.stdout?.on?.("data", (chunk) => {
      if (settled) return;
      buf += chunk;
      if (buf.length > maxBuffer) return fail(`${label} stdout exceeded ${maxBuffer} bytes before answering — killed`);
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          // stdout is JSON-RPC by contract; anything else means we are not
          // talking to the server we think we are.
          return fail(`${label} wrote a non-JSON line on stdout: ${line.slice(0, 120)}`);
        }
        if (settled) return;
        handle(msg);
      }
    });

    write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "task-management-dispatch", version: "1" } },
    });
  });
}
