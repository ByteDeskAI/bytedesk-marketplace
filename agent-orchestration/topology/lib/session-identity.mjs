// TM-353 (EP-028). Every session gets an AO identity.
//
// A launcher-started agent carries AO_AGENT_ID + AO_CONSUMER. Every other session (a human's Claude
// pane, an ad-hoc Codex shell) had nothing, so `mailbox send` held its mail as
// source_identity_required unless it borrowed a lead's id with --from. SessionStart now mints one.
//
// The minted id rides in its OWN variables, never in AO_AGENT_ID. AO_AGENT_ID is the launcher's
// claim and several verbs read its absence as "name me from my census binding" (TM-243) — an
// assigned lead is exactly such a session, and stamping AO_AGENT_ID into it would rename the lead.
//
// callerIdentity() is the one answer to "who is sending". The mailbox send path and TM-356's
// sender derivation both call it; nothing else should re-read these variables.
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalRepoId, stateRoot } from "./repoid.mjs";
import { nowIso, readJson, writeJson } from "./util.mjs";

export const SESSION_AGENT_VAR = "AO_SESSION_AGENT_ID";
export const SESSION_CONSUMER_VAR = "AO_SESSION_CONSUMER";
const ID = /^[a-f][0-9a-f]{7}$/;

export function sessionIdentitiesDir(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), "sessions");
}

/** Same shape as identity.mjs mintId (8 chars, leading a-f), but derived from the session id so a
 * resumed or compacted session keeps its address without a lookup table. */
export function sessionAgentId(sessionId) {
  const hex = createHash("sha256").update(String(sessionId)).digest("hex");
  return `${"abcdef"[parseInt(hex[0], 16) % 6]}${hex.slice(1, 8)}`;
}

/** Who is calling: the launcher identity first, then this session's minted identity, else null. */
export function callerIdentity(env = process.env) {
  if (env.AO_AGENT_ID) return { agentId: env.AO_AGENT_ID, consumer: env.AO_CONSUMER || env[SESSION_CONSUMER_VAR] || null, source: "launcher" };
  if (env[SESSION_AGENT_VAR]) return { agentId: env[SESSION_AGENT_VAR], consumer: env[SESSION_CONSUMER_VAR] || null, source: "session" };
  return null;
}

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

/**
 * SessionStart: mint (or re-read) this session's identity, record it, and export it through
 * CLAUDE_ENV_FILE so every later Bash command in the session carries it. A launcher session already
 * has an identity and is left alone.
 */
export async function mintSessionIdentity({ sessionId, cwd, env = process.env, home = homedir(), envFile = env.CLAUDE_ENV_FILE } = {}) {
  if (env.AO_AGENT_ID) return { minted: false, reason: "launcher identity present", agentId: env.AO_AGENT_ID };
  if (!sessionId || !cwd) return { minted: false, reason: "no session id or cwd" };
  const agentId = sessionAgentId(sessionId);
  const consumer = resolve(cwd);
  const path = join(sessionIdentitiesDir(env, home), `${agentId}.json`);
  const prior = await readJson(path).catch(() => null);
  const repo = await canonicalRepoId(consumer);
  const record = { version: 1, agent_id: agentId, session_id: String(sessionId), consumer, repo_id: repo.id,
    pane: env.TMUX_PANE || null, server: String(env.TMUX || "").split(",")[0] || null,
    created_at: prior?.created_at ?? nowIso(), updated_at: nowIso() };
  await writeJson(path, record);
  if (envFile) await appendFile(envFile, `export ${SESSION_AGENT_VAR}=${shellQuote(agentId)}\nexport ${SESSION_CONSUMER_VAR}=${shellQuote(consumer)}\n`);
  return { minted: !prior, agentId, consumer, exported: Boolean(envFile), record: path };
}

/**
 * TM-353: an address that is not in the agent library but is a real, present session in this
 * repository. Checked only after the library and routing found nothing, so it can never shadow a
 * library agent. Returns { agentId, source } or null.
 */
export async function resolvePresentRecipient({ consumer, to, env = process.env, home = homedir(), presence = null }) {
  if (!to || typeof to !== "string") return null;
  const repo = await canonicalRepoId(consumer);
  if (ID.test(to)) {
    const record = await readJson(join(sessionIdentitiesDir(env, home), `${to}.json`)).catch(() => null);
    if (record?.agent_id === to && record.repo_id === repo.id) return { agentId: to, source: "session-identity" };
  }
  let agents = [];
  try {
    agents = presence ? await presence({ consumer, env, home })
      : await (await import("./presence.mjs")).collectPresenceAgents({ consumer, identity: repo, env, home });
  } catch { return null; }
  const hit = agents.find((agent) => agent.agentId === to || agent.session?.sessionName === to);
  return hit ? { agentId: hit.agentId, source: "presence" } : null;
}
