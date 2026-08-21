#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import readline from "node:readline";

if (process.argv[2] === "models" || process.argv[2] === "--version") {
  process.stdout.write("fake-grok\n");
  process.exit(0);
}

const sessions = new Map();
const pendingClientRequests = new Map();
let clientRequestSequence = 0;
const writeMessage = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const respond = (id, result) => writeMessage({ jsonrpc: "2.0", id, result });
const reject = (id, code, message) => writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
const requestClient = (method, params) => new Promise((resolveRequest, rejectRequest) => {
  const id = `fake-client-${clientRequestSequence += 1}`;
  const timeout = setTimeout(() => {
    pendingClientRequests.delete(id);
    rejectRequest(new Error(`Timed out waiting for ${method}`));
  }, 5_000);
  timeout.unref();
  pendingClientRequests.set(id, (message) => {
    clearTimeout(timeout);
    resolveRequest(message);
  });
  writeMessage({ jsonrpc: "2.0", id, method, params });
});

async function handle(message) {
  const { id, method, params = {} } = message;
  if (id !== undefined && method === undefined && pendingClientRequests.has(String(id))) {
    const resolveRequest = pendingClientRequests.get(String(id));
    pendingClientRequests.delete(String(id));
    resolveRequest(message);
    return;
  }
  if (method === "initialize") {
    respond(id, { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] });
    return;
  }
  if (method === "authenticate") {
    respond(id, {});
    return;
  }
  if (method === "session/new") {
    const sessionId = randomUUID();
    sessions.set(sessionId, { controller: null });
    respond(id, { sessionId });
    return;
  }
  if (method === "session/cancel") {
    sessions.get(params.sessionId)?.controller?.abort();
    return;
  }
  if (method !== "session/prompt") {
    if (id !== undefined) reject(id, -32601, `Method not found: ${method}`);
    return;
  }

  const session = sessions.get(params.sessionId);
  if (!session) {
    reject(id, -32000, "Unknown session");
    return;
  }
  const controller = new AbortController();
  session.controller = controller;
  const text = params.prompt?.map?.((part) => part.text ?? "").join("\n") ?? "";
  try {
    if (text.includes("WRITE_FIXTURE")) {
      await writeFile(join(process.cwd(), "fake-agent-change.txt"), "sandbox write succeeded\n");
      let outsideWrite = "sandbox_only";
      let bootstrapCredentials = "missing";
      let bootstrapHome = "writable";
      let bootstrapAncestors = "renamable";
      let runtimeRoot = "renamable";
      const forbiddenPath = text.match(/FORBIDDEN_PATH=([^\s]+)/)?.[1];
      try { await writeFile(forbiddenPath, "forbidden\n"); } catch { outsideWrite = "blocked"; }
      try { await writeFile(join(process.env.GROK_HOME, "auth.json"), "regenerated\n"); } catch { bootstrapHome = "read_only"; }
      try {
        await rename(process.env.GROK_HOME, `${process.env.GROK_HOME}-moved`);
        await mkdir(process.env.GROK_HOME);
      } catch { bootstrapAncestors = "protected"; }
      try { await rename(process.env.TMPDIR, `${process.env.TMPDIR}-moved`); } catch { runtimeRoot = "protected"; }
      try {
        const stagedCredential = await readFile(join(process.env.GROK_HOME, "auth.json"), "utf8");
        bootstrapCredentials = stagedCredential.length === 0 ? "cleared" : "exposed";
      } catch {}
      const terminalResponse = await requestClient("terminal/create", {
        sessionId: params.sessionId,
        command: "/usr/bin/touch",
        args: [forbiddenPath],
      });
      const callbackWriteResponse = await requestClient("fs/write_text_file", {
        sessionId: params.sessionId,
        path: join(process.cwd(), "client-callback-write.txt"),
        content: "client callback escaped the sandbox\n",
      });
      const clientCallbacks = terminalResponse.error && callbackWriteResponse.error ? "blocked" : "allowed";
      await writeFile(join(process.cwd(), "sandbox-result.txt"), `${outsideWrite}\nclient_callbacks_${clientCallbacks}\nbootstrap_home_${bootstrapHome}\nbootstrap_ancestors_${bootstrapAncestors}\nruntime_root_${runtimeRoot}\nbootstrap_credentials_${bootstrapCredentials}\n`);
    }
    if (text.includes("BLOCK_UNTIL_CANCEL")) {
      await new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
      respond(id, { stopReason: "cancelled" });
      return;
    }
    writeMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fake provider completed" } },
      },
    });
    respond(id, { stopReason: "end_turn" });
  } finally {
    session.controller = null;
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  handle(message).catch((error) => {
    if (message.id !== undefined) reject(message.id, -32603, error.message);
  });
});
