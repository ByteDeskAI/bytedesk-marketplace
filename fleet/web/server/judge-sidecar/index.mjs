#!/usr/bin/env node
// fleet-judge-sidecar — newline-delimited-JSON bridge between the Go fleet
// web server and Claude Haiku via @anthropic-ai/claude-agent-sdk.
//
// Wire shape (one JSON object per line):
//
//   stdin:  {"id":"<uuid>","op":"judge_state|drift|estimate_cost","payload":{...}}
//   stdout: {"id":"<uuid>","ok":true,"result":{...}}
//        |  {"id":"<uuid>","ok":false,"error":"..."}
//
// One request → one response. Requests are processed sequentially; the Go
// side is expected to issue concurrent calls only after caching.
//
// Health-check: the Go side sends `{"op":"ping"}` on startup and expects
// `{"ok":true,"result":{"pong":true,"model":"..."}}` within 5s.
//
// Errors never crash the loop — they're written back as `ok:false` and the
// next request is read.

import { createInterface } from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const HARD_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 4500);

const STATE_VOCAB = [
  "starting",
  "working",
  "needs-input",
  "blocked",
  "error",
  "reviewing",
  "done",
  "idle",
  "completed",
];

// ---------------------------------------------------------------------------
// JSON-schema definitions for outputFormat (the SDK forwards these to Claude
// and enforces them on the way back).

const judgeStateSchema = {
  type: "object",
  required: ["state", "confidence", "objective"],
  additionalProperties: false,
  properties: {
    state: { type: "string", enum: STATE_VOCAB },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    objective: { type: "string", maxLength: 200 },
  },
};

const driftSchema = {
  type: "object",
  required: ["drift"],
  additionalProperties: false,
  properties: {
    drift: { type: "number", minimum: 0, maximum: 1 },
  },
};

const estimateCostSchema = {
  type: "object",
  required: ["low", "high"],
  additionalProperties: false,
  properties: {
    low: { type: "number", minimum: 0 },
    high: { type: "number", minimum: 0 },
  },
};

// ---------------------------------------------------------------------------
// Prompt builders.

function judgeStatePrompt(payload) {
  const { prompt = "", logTail = "" } = payload || {};
  const tail = String(logTail).slice(-6000);
  const original = String(prompt).slice(-2000);
  return [
    "You are a session-state judge for a Claude Code agent fleet.",
    "Given the original task prompt and the last lines of the agent's log,",
    `classify the agent's current state. Allowed values: ${STATE_VOCAB.join(", ")}.`,
    "Also report a confidence 0..1 and a one-line objective describing the",
    "agent's current goal.",
    "",
    "ORIGINAL PROMPT:",
    original || "(none)",
    "",
    "LOG TAIL:",
    tail || "(empty)",
    "",
    "Respond with JSON matching the required schema.",
  ].join("\n");
}

function driftPrompt(payload) {
  const { prompt = "", logTail = "" } = payload || {};
  const tail = String(logTail).slice(-6000);
  const original = String(prompt).slice(-2000);
  return [
    "You are a drift detector for a Claude Code agent fleet.",
    "Given the original task prompt and the last lines of the agent's log,",
    "score 0..1 how off-track the agent currently appears (0 = on task,",
    "1 = clearly lost or stuck).",
    "",
    "ORIGINAL PROMPT:",
    original || "(none)",
    "",
    "LOG TAIL:",
    tail || "(empty)",
    "",
    "Respond with JSON matching the required schema.",
  ].join("\n");
}

function estimateCostPrompt(payload) {
  const { prompt = "", fullAuto = false } = payload || {};
  const trimmed = String(prompt).slice(-4000);
  return [
    "You are a cost estimator for Claude Code agent runs.",
    "Given the user's prompt and a full-auto flag, estimate the USD cost",
    "range to complete the task end-to-end (low and high, both >= 0).",
    "Assume Haiku/Sonnet-class blended pricing around $5 per 1M tokens.",
    `fullAuto = ${fullAuto ? "true" : "false"}`,
    "",
    "PROMPT:",
    trimmed || "(empty)",
    "",
    "Respond with JSON matching the required schema.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// SDK invocation. The query() iterator yields a stream of SDKMessage objects;
// the final `result` message carries the structured assistant text.

async function runQuery(prompt, schema) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HARD_TIMEOUT_MS);
  try {
    const it = query({
      prompt,
      options: {
        model: MODEL,
        maxTurns: 1,
        permissionMode: "dontAsk",
        allowedTools: [],
        outputFormat: { type: "json_schema", schema },
        abortController: ac,
      },
    });
    let resultText = "";
    for await (const msg of it) {
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          resultText = msg.result || "";
        } else {
          throw new Error(`sdk result error: ${msg.subtype || "unknown"}`);
        }
      }
    }
    if (!resultText) {
      throw new Error("no result message from sdk");
    }
    return JSON.parse(resultText);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Op dispatch.

async function handle(op, payload) {
  switch (op) {
    case "ping":
      return { pong: true, model: MODEL };
    case "judge_state":
      return await runQuery(judgeStatePrompt(payload), judgeStateSchema);
    case "drift":
      return await runQuery(driftPrompt(payload), driftSchema);
    case "estimate_cost":
      return await runQuery(estimateCostPrompt(payload), estimateCostSchema);
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

function writeLine(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {
    // stdout closed — nothing we can do.
  }
}

// ---------------------------------------------------------------------------
// Main loop. readline gives us one request per line; we await each handler
// in sequence so the Go side can rely on FIFO ordering.

const rl = createInterface({ input: process.stdin });

(async () => {
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch (e) {
      writeLine({ id: null, ok: false, error: `bad json: ${e.message}` });
      continue;
    }
    const id = typeof req.id === "string" ? req.id : null;
    try {
      const result = await handle(req.op, req.payload);
      writeLine({ id, ok: true, result });
    } catch (e) {
      writeLine({ id, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
})().catch((e) => {
  // Unexpected loop death — surface, then exit non-zero so the Go side notices.
  try {
    process.stderr.write(`judge-sidecar fatal: ${e && e.stack ? e.stack : e}\n`);
  } catch {}
  process.exit(1);
});
