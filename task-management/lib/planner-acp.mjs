/**
 * The ACP side of the bridge: the trusted-agent registry, and a JSON-RPC client over stdio.
 *
 * **task-management depends on no agent SDK.** An agent is a COMMAND the operator configured, and
 * this module spawns it and speaks the protocol. A Claude installation is one option here exactly
 * like Codex or Kimi is — reached through its own ACP adapter, with nothing about it linked into
 * this plugin. That is the whole reason the registry is configuration rather than code.
 *
 * The browser never appears in this file, and that is the boundary: it holds no credential, spawns
 * nothing, and speaks no ACP. It gets AG-UI events, which is all it needs to render.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { config } from "./store.mjs";
import { paths } from "./paths.mjs";

const err = (message, status) => Object.assign(new Error(message), { status });

/**
 * The agents this board may drive, from `config.json`:
 *
 *   tm config planner '{"agents":[{"id":"codex","label":"Codex","command":"codex-acp"}]}'
 *
 * Empty by default, deliberately. An agent registry that ships with entries is a list of processes
 * this board will spawn that nobody chose, and "which binaries may run here" is an operator
 * decision rather than a default.
 */
export function plannerAgents(p = paths()) {
  const declared = config(p)?.planner?.agents;
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((a) => a && typeof a.command === "string" && a.command.trim())
    .map((a, i) => ({
      id: String(a.id || `agent-${i + 1}`),
      label: String(a.label || a.id || a.command),
      command: String(a.command).trim(),
      args: Array.isArray(a.args) ? a.args.map(String) : [],
      // Never surfaced to the browser. `agentHealth` strips it; it is here so a spawn can find it.
      cwd: typeof a.cwd === "string" ? a.cwd : p.root,
    }));
}

/**
 * What the dashboard may know about an agent.
 *
 * Command path and arguments are deliberately absent: a page that can read the command line can
 * read whatever secret an operator put in it, and the page has no use for it. Health is what the
 * UI needs, and health is a verdict rather than a configuration dump.
 */
export function agentHealth(agent, { connected = false, session = null, capabilities = null } = {}) {
  return {
    id: agent.id,
    label: agent.label,
    connected,
    session,
    // "confirm each set" is not negotiable and is not read from the agent: board writes are
    // approval-gated by this product regardless of what an agent says it may do.
    boardWrites: "confirm each set",
    capabilities: capabilities ? { promptText: Boolean(capabilities.promptCapabilities?.image) || true, elicitation: Boolean(capabilities.promptCapabilities?.elicitation) } : null,
  };
}

/**
 * One ACP session over stdio.
 *
 * Line-delimited JSON-RPC. Requests FROM the agent — permission, elicitation — are handed to the
 * caller's responder rather than answered here, because answering them is a product decision and
 * this class is transport.
 */
export class AcpSession {
  constructor(agent, { onUpdate = () => {}, onRequest = async () => ({ error: { code: -32601, message: "unsupported" } }), onExit = () => {} } = {}) {
    this.agent = agent;
    this.onUpdate = onUpdate;
    this.onRequest = onRequest;
    this.onExit = onExit;
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.sessionId = null;
    this.closed = false;
  }

  /** Spawn and initialize. Resolves with the agent's declared capabilities. */
  async start({ timeoutMs = 30_000 } = {}) {
    this.child = spawn(this.agent.command, this.agent.args, {
      cwd: this.agent.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // A planning agent inherits the board's environment minus anything that looks like a
      // credential this product owns. It is not a sandbox — the operator chose to trust this
      // command — but a planner has no use for the board's own notification token.
      env: { ...process.env, TM_NTFY_TOKEN: "", NTFY_TOKEN: "" },
    });
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      // Reject, never settle. `pending` holds response handlers, and handing one an Error made it
      // fall through to `resolve(msg?.result)` — so an agent that died mid-prompt resolved the
      // caller with `undefined` and read as a successful run that simply produced nothing. A
      // crashed planner must fail loudly; a quiet empty success is the worst available answer.
      for (const [, entry] of this.pending) {
        entry.fail(err(`the planning agent exited (${signal || `code ${code}`})`, 502));
      }
      this.pending.clear();
      this.onExit({ code, signal });
    });
    this.child.on("error", (e) => {
      this.closed = true;
      for (const [, entry] of this.pending) entry.fail(err(`the planning agent could not run: ${e.message}`, 502));
      this.pending.clear();
      this.onExit({ code: null, signal: null, error: e.message });
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.#line(line));
    // stderr is the agent's own diagnostics. Never forwarded to the browser: it is the most likely
    // place for a credential or a path to appear.
    this.child.stderr.on("data", () => {});

    const init = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    }, { timeoutMs });
    this.capabilities = init;
    return init;
  }

  /** Open a session. `cwd` is the repository the planner may reason about. */
  async newSession(cwd, { timeoutMs = 30_000 } = {}) {
    const res = await this.request("session/new", { cwd, mcpServers: [] }, { timeoutMs });
    this.sessionId = res?.sessionId ?? null;
    if (!this.sessionId) throw err("the planning agent opened no session", 502);
    return this.sessionId;
  }

  /** Send the bounded goal. Resolves when the agent stops. */
  async prompt(text, { timeoutMs = 600_000 } = {}) {
    return this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: String(text) }],
    }, { timeoutMs });
  }

  async cancel() {
    if (this.closed || !this.sessionId) return;
    try {
      await this.notify("session/cancel", { sessionId: this.sessionId });
    } catch { /* the agent may already be gone */ }
  }

  request(method, params, { timeoutMs = 60_000 } = {}) {
    if (this.closed) return Promise.reject(err("the planning agent is not running", 502));
    const id = ++this.seq;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(err(`the planning agent did not answer ${method} within ${timeoutMs}ms`, 504));
      }, timeoutMs);
      // A prompt waits up to ten minutes, and a pending timer keeps Node's event loop alive. A
      // library has no business holding its host process open: without this, a run that is still
      // waiting stops the CLI, a test runner, or the dashboard from ever exiting.
      timer.unref?.();
      this.pending.set(id, {
        settle: (msg) => {
          clearTimeout(timer);
          if (msg?.error) reject(err(msg.error.message || `${method} failed`, 502));
          else resolve(msg?.result);
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  notify(method, params) {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close() {
    this.closed = true;
    try {
      this.child?.stdin?.end();
      this.child?.kill();
    } catch { /* already gone */ }
  }

  #line(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // A partial or non-JSON line is the agent's problem, not a reason to tear down a run.
      return;
    }
    // A response to something we asked.
    if (msg.id != null && (("result" in msg) || ("error" in msg)) && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      entry.settle(msg);
      return;
    }
    // A notification from the agent.
    if (msg.method === "session/update") {
      this.onUpdate(msg.params?.update ?? msg.params ?? {});
      return;
    }
    // A REQUEST from the agent — permission, elicitation. The caller decides; we only carry it.
    if (msg.method && msg.id != null) {
      Promise.resolve(this.onRequest(msg.method, msg.params))
        .then((result) => this.#answer(msg.id, result))
        .catch((e) => this.#answer(msg.id, { error: { code: -32603, message: String(e?.message ?? e) } }));
    }
  }

  #answer(id, result) {
    if (this.closed) return;
    const body = result && result.error ? { jsonrpc: "2.0", id, error: result.error } : { jsonrpc: "2.0", id, result };
    this.child.stdin.write(`${JSON.stringify(body)}\n`);
  }
}

/**
 * Is this agent actually startable? Spawns it, initializes, and shuts it down.
 *
 * A health check that only looks at configuration reports healthy for a command that is not
 * installed, which is the one answer nobody wants from a preflight.
 */
export async function probeAgent(agent, { timeoutMs = 15_000 } = {}) {
  const session = new AcpSession(agent);
  try {
    const caps = await session.start({ timeoutMs });
    return agentHealth(agent, { connected: true, capabilities: caps });
  } catch (e) {
    return { ...agentHealth(agent, { connected: false }), error: e.message };
  } finally {
    session.close();
  }
}
