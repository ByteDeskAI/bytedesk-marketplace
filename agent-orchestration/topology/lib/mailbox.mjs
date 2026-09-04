// File-first messaging. A message is a Markdown file in the recipient's inbox; the reply is a file in
// the recipient's outbox with the same sequence number. tmux only ever delivers a one-line pointer.
// Every send and reply is appended to run_dir/journal.jsonl.
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, invariant, nowIso, readJson, sleep, writeJson, writeText } from "./util.mjs";

export const RUN_FILE = "run.json";
export const JOURNAL_FILE = "journal.jsonl";

export function agentDir(runDir, agentId) {
  return join(runDir, "agents", agentId);
}

export async function loadRun(runDir) {
  const path = join(runDir, RUN_FILE);
  invariant(await exists(path), "TOPOLOGY_RUN_NOT_FOUND", `No ${RUN_FILE} in ${runDir}. Pass --run <run_dir> from \`ao-topology launch\` output.`);
  return readJson(path);
}

export async function saveRun(runDir, run) {
  run.updated = nowIso();
  await writeJson(join(runDir, RUN_FILE), run);
}

export async function appendJournal(runDir, event) {
  const record = { ts: nowIso(), ...event };
  await appendFile(join(runDir, JOURNAL_FILE), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readJournal(runDir, limit = 50) {
  const path = join(runDir, JOURNAL_FILE);
  if (!(await exists(path))) return [];
  const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, type: "unparseable", raw: line };
    }
  });
}

async function nextSequence(runDir) {
  const run = await loadRun(runDir);
  run.sequence = (run.sequence ?? 0) + 1;
  await saveRun(runDir, run);
  return { seq: String(run.sequence).padStart(3, "0"), run };
}

export function messageFileName(seq, stage) {
  return `${seq}-${stage}.md`;
}

export function replyFileName(seq, stage) {
  return `${seq}-${stage}.reply.md`;
}

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Write one message into each recipient's inbox. Returns the message id and the list of
 * { agent, inbox, outbox } paths so the caller can deliver a pointer through tmux.
 */
export async function sendMessage({ runDir, from, to, stage, body, contract, round, subject }) {
  invariant(Array.isArray(to) && to.length > 0, "TOPOLOGY_RECIPIENT_REQUIRED", "A message needs at least one recipient (--to <agent-id>).");
  invariant(typeof body === "string" && body.trim(), "TOPOLOGY_BODY_REQUIRED", "A message needs a body (--file <path> or --body <text>).");
  const { seq, run } = await nextSequence(runDir);
  const known = new Set(run.agents.map((agent) => agent.id));
  for (const recipient of to) {
    invariant(known.has(recipient), "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${recipient}". Agents in this run: ${[...known].join(", ")}.`);
  }
  const id = `${seq}-${stage}`;
  const deliveries = [];
  for (const recipient of to) {
    const inbox = join(agentDir(runDir, recipient), "inbox", messageFileName(seq, stage));
    const outbox = join(agentDir(runDir, recipient), "outbox", replyFileName(seq, stage));
    const header = frontmatter({ id, from, to: recipient, stage, round, contract, subject, created: nowIso(), reply_to: outbox });
    const instructions = `\n\n<!-- Write your complete reply to: ${outbox} -->\n`;
    await writeText(inbox, `${header}\n${body.trim()}\n${instructions}`);
    deliveries.push({ agent: recipient, inbox, outbox });
  }
  await appendJournal(runDir, { type: "message.sent", id, from, to, stage, round, contract, subject });
  return { id, seq, deliveries };
}

/** Inbox messages that do not yet have a reply file, optionally filtered by agent ids. */
export async function pendingReplies(runDir, agentIds) {
  const run = await loadRun(runDir);
  const ids = agentIds && agentIds.length > 0 ? agentIds : run.agents.map((agent) => agent.id);
  const pending = [];
  for (const agentId of ids) {
    const inboxDir = join(agentDir(runDir, agentId), "inbox");
    const outboxDir = join(agentDir(runDir, agentId), "outbox");
    const inbox = await readdir(inboxDir).catch(() => []);
    for (const file of inbox.filter((name) => name.endsWith(".md")).sort()) {
      const reply = file.replace(/\.md$/, ".reply.md");
      if (!(await exists(join(outboxDir, reply)))) {
        pending.push({ agent: agentId, id: file.replace(/\.md$/, ""), inbox: join(inboxDir, file), outbox: join(outboxDir, reply) });
      }
    }
  }
  return pending;
}

/** Wait until every named agent has replied to the message id (or to all pending messages). */
export async function waitForReplies({ runDir, agentIds, messageId, timeoutMs, pollMs = 3000, onTick }) {
  const started = Date.now();
  const run = await loadRun(runDir);
  const targets = agentIds && agentIds.length > 0 ? agentIds : run.agents.filter((agent) => agent.role !== "orchestrator").map((agent) => agent.id);
  for (;;) {
    const pending = (await pendingReplies(runDir, targets)).filter((item) => !messageId || item.id === messageId);
    if (pending.length === 0) {
      const replies = [];
      for (const agentId of targets) {
        const outboxDir = join(agentDir(runDir, agentId), "outbox");
        const files = (await readdir(outboxDir).catch(() => [])).filter((name) => name.endsWith(".reply.md") && (!messageId || name.startsWith(messageId)));
        for (const file of files.sort()) {
          const path = join(outboxDir, file);
          replies.push({ agent: agentId, id: file.replace(/\.reply\.md$/, ""), path, body: await readFile(path, "utf8") });
        }
      }
      await appendJournal(runDir, { type: "wait.satisfied", agents: targets, message: messageId ?? null, elapsed_ms: Date.now() - started });
      return { ok: true, replies, elapsed_ms: Date.now() - started };
    }
    if (Date.now() - started > timeoutMs) {
      await appendJournal(runDir, { type: "wait.timeout", agents: targets, message: messageId ?? null, pending: pending.map((item) => `${item.agent}:${item.id}`) });
      return { ok: false, pending, elapsed_ms: Date.now() - started };
    }
    if (onTick) await onTick(pending, Date.now() - started);
    await sleep(pollMs);
  }
}

/** Record a reply written by an agent (agents call this through `ao-topology reply`). */
export async function recordReply({ runDir, agentId, messageId, body }) {
  const [seq, ...stageParts] = messageId.split("-");
  const stage = stageParts.join("-");
  invariant(seq && stage, "TOPOLOGY_MESSAGE_ID_INVALID", `Message id must look like 003-brief (got "${messageId}").`);
  const outbox = join(agentDir(runDir, agentId), "outbox", replyFileName(seq, stage));
  await writeText(outbox, body.endsWith("\n") ? body : `${body}\n`);
  await appendJournal(runDir, { type: "message.replied", id: messageId, from: agentId, bytes: Buffer.byteLength(body) });
  return outbox;
}
