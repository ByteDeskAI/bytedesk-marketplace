#!/usr/bin/env node
/**
 * A deterministic ACP agent, for testing the bridge without a model.
 *
 * It speaks enough of the protocol to exercise every path the bridge has: initialize, session/new,
 * a prompt that streams updates, a permission request back at the client, and a clean stop. What it
 * does NOT do is think — the sequence is fixed, so a test asserts on translation rather than on a
 * model's mood.
 *
 * `--mode` picks the shape: `plan` streams a normal run, `permission` asks for one, `unknown` sends
 * an update variant this bridge has never seen, and `crash` exits during the prompt.
 */
import { createInterface } from "node:readline";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "plan";
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const update = (sessionId, u) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sessionId = null;
let nextId = 1000;
const pending = new Map();

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // A response to a request WE made (the permission answer).
  if (msg.id != null && ("result" in msg || "error" in msg) && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }

  if (msg.method === "initialize") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: false } } } });
  }
  if (msg.method === "session/new") {
    sessionId = "acp-session-1";
    return send({ jsonrpc: "2.0", id: msg.id, result: { sessionId } });
  }
  if (msg.method === "session/cancel") {
    return process.exit(0);
  }
  if (msg.method !== "session/prompt") return;

  // Never resolves the prompt. For asserting behaviour while a run is genuinely in flight, which
  // is otherwise a race against how fast this fixture finishes.
  if (mode === "hang") {
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: [{ type: "text", text: "working" }] });
    return;
  }

  if (mode === "crash") {
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: [{ type: "text", text: "starting" }] });
    await sleep(30);
    return process.exit(3);
  }

  update(sessionId, { sessionUpdate: "user_message_chunk", content: [{ type: "text", text: "echo of the goal" }] });
  update(sessionId, { sessionUpdate: "agent_thought_chunk", content: [{ type: "text", text: "SECRET REASONING THAT MUST NOT LEAVE" }] });
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: [{ type: "text", text: "Which epic should this land under?" }] });
  update(sessionId, { sessionUpdate: "plan", entries: [{ id: "s1", content: "Read the dispatcher", status: "in_progress" }] });
  update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "read", rawInput: { path: "lib/dispatch/index.mjs" } });
  update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "text", text: "claims live in state.json" }] });

  if (mode === "unknown") {
    update(sessionId, { sessionUpdate: "something_invented_in_a_later_version", payload: { anything: true } });
  }

  if (mode === "permission") {
    const id = ++nextId;
    const answered = new Promise((r) => pending.set(id, r));
    send({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "t2", title: "tm_epic_create" },
        options: [
          { optionId: "opt-allow-once", kind: "allow_once", name: "Allow once" },
          { optionId: "opt-allow-always", kind: "allow_always", name: "Always allow" },
          { optionId: "opt-reject", kind: "reject_once", name: "Reject" },
        ],
      },
    });
    const reply = await answered;
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: [{ type: "text", text: `permission answered: ${JSON.stringify(reply.result ?? reply.error)}` }],
    });
  }

  await sleep(20);
  send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
});
