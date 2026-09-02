/**
 * A fake agent-orchestration MCP server for dispatch-backends.test.mjs.
 *
 * Speaks line-delimited JSON-RPC on stdio exactly as the real server does
 * (orchestration invariant 5: stdout is frames only, stderr is free text), but
 * answers from a can instead of starting runs. Behaviour is steered by env:
 *
 *   FAKE_CAPTURE   path to write the tools/call params to, as JSON
 *   FAKE_PID_FILE  path to write this process's pid to (kill assertions)
 *   FAKE_RUN_ID    the run id the success envelope carries (default run-fake-1)
 *   FAKE_PAD       pad the tools/call response to at least N bytes (buffer test)
 *   FAKE_MODE      ok | tool-error | rpc-error | hang | junk-stderr | bad-stdout
 *
 * Modes: tool-error answers with an isError envelope ({code,message} in `data`);
 * rpc-error answers with a JSON-RPC error object; hang never answers tools/call
 * (timeout/kill test); junk-stderr sprays diagnostics on stderr and still
 * answers; bad-stdout emits one non-JSON line on stdout before answering
 * (protocol-violation test).
 *
 * Beyond orchestration_spawn it also serves the collector's tools:
 *   orchestration_status   a run whose state is FAKE_STATE (default succeeded),
 *                          carrying FAKE_OUTPUT as its one output's text
 *   orchestration_events   FAKE_EVENTS parsed as JSON, default []
 */
import { writeFileSync } from "node:fs";

const MODE = process.env.FAKE_MODE || "ok";
const RUN_ID = process.env.FAKE_RUN_ID || "run-fake-1";
const PAD = Number(process.env.FAKE_PAD || 0);

if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
if (MODE === "junk-stderr") {
  process.stderr.write("[fake] noisy diagnostic line\n[fake] another one: {}\n");
}

function send(msg) {
  let line = `${JSON.stringify(msg)}\n`;
  if (PAD && line.length < PAD) {
    // Grow the frame past the client's buffer cap without changing its shape.
    msg.result._pad = "x".repeat(PAD - line.length);
    line = `${JSON.stringify(msg)}\n`;
  }
  process.stdout.write(line);
}

function toolResult(msg) {
  if (process.env.FAKE_CAPTURE) writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify(msg.params, null, 2));
  if (MODE === "hang") return; // the correct answer to a hang is no answer
  if (MODE === "bad-stdout") process.stdout.write("this is not json-rpc\n");
  if (MODE === "rpc-error") {
    return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "invalid params" } });
  }
  if (MODE === "tool-error") {
    const data = { code: "E_NO_PROVIDER", message: "no provider endpoint is ready" };
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ schemaVersion: 1, data }) }],
        structuredContent: { schemaVersion: 1, data },
        isError: true,
      },
    });
  }

  // The collector's tools, answered from env rather than a run store.
  if (msg.params?.name === "orchestration_status") {
    const data = {
      run: {
        schemaVersion: 1,
        runId: RUN_ID,
        revision: 3,
        state: process.env.FAKE_STATE || "succeeded",
        input: { intent: "implementation", task: "x", permissionProfile: "write" },
        consumer: { requestedCwd: "/repo", checkoutRoot: "/repo", repositoryKey: "k" },
        plan: {},
        sessions: [],
        outputs: process.env.FAKE_OUTPUT ? [{ stageId: "main", provider: "fake", model: null, effort: null, text: process.env.FAKE_OUTPUT, status: "completed" }] : [],
      },
    };
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ schemaVersion: 1, data }) }],
        structuredContent: { schemaVersion: 1, data },
      },
    });
  }
  if (msg.params?.name === "orchestration_events") {
    let data = [];
    try {
      data = JSON.parse(process.env.FAKE_EVENTS || "[]");
    } catch {
      data = [];
    }
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ schemaVersion: 1, data }) }],
        structuredContent: { schemaVersion: 1, data },
      },
    });
  }

  const data = {
    run: { schemaVersion: 1, runId: RUN_ID, revision: 0, state: "running", input: { intent: "implementation", task: "x", permissionProfile: "write" } },
    explanation: { kind: "execution_plan_explanation", schemaVersion: 1, planId: "p-1", protocolId: "single.v1", status: "ok", stages: [] },
  };
  send({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      content: [{ type: "text", text: JSON.stringify({ schemaVersion: 1, data }) }],
      structuredContent: { schemaVersion: 1, data },
    },
  });
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake-orchestration", version: "0" } },
      });
    } else if (msg.method === "tools/call") {
      toolResult(msg);
    }
    // notifications/initialized and anything else: no reply, like the real one.
  }
});
