// TM-280 / ADR-0030 part 4: re-spawning a library agent that already holds a live session.
//
// An agent holds one live session. A second spawn or open of it used to be refused outright
// (TOPOLOGY_AGENT_ALREADY_LIVE, TM-274). It now replaces the session instead, in this order:
//
//   1. wait, bounded, for the live session's current turn to end — never interrupt mid-turn;
//   2. ask the agent to write a handoff (goal, state, open questions, files) to a known path;
//   3. if it does not, build a fallback from the tail of its transcript, labelled as such;
//   4. end the old session exactly once (the provider's own exit first, then kill that one session);
//   5. the caller starts the fresh session under the same name, recording the predecessor's ULID;
//   6. the handoff goes back to the CALLER. It reaches the new session only when the caller passes it
//      (`--pass-handoff`, or `session handoff <agent> --file <path>` later).
//
// The per-agent lock is held from the liveness check until the caller has created the new session, so
// two simultaneous re-spawns cannot both replace the agent: the loser waits, then joins the winner's
// result (TOPOLOGY_RESPAWN_JOINED, with that result in the error details) instead of replacing it again.
import { mkdir, open, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { busyEvidence } from "./census.mjs";
import { composerEmptyOnScreen } from "./delivery.mjs";
import { sanitizeCwd } from "./providers.mjs";
import { stateRoot } from "./repoid.mjs";
import { IDENTITY_FORMAT, SESSION_OPTIONS, parseIdentityFields, sessionIdentity } from "./session-names.mjs";
import { withLock } from "./lockfile.mjs";
import * as tmux from "./tmux.mjs";
import { fail, invariant, nowIso, readJson, sleep, writeJson, writeText } from "./util.mjs";

const envMs = (name, fallback, env = process.env) => (Number(env[name]) > 0 ? Number(env[name]) : fallback);

/** Bounds, each overridable per call or by environment. */
export function respawnBounds(env = process.env, overrides = {}) {
  return {
    turnTimeoutMs: overrides.turnTimeoutMs ?? envMs("AO_RESPAWN_TURN_TIMEOUT_MS", 600_000, env),
    handoffTimeoutMs: overrides.handoffTimeoutMs ?? envMs("AO_RESPAWN_HANDOFF_TIMEOUT_MS", 300_000, env),
    exitTimeoutMs: overrides.exitTimeoutMs ?? envMs("AO_RESPAWN_EXIT_TIMEOUT_MS", 15_000, env),
    pollMs: overrides.pollMs ?? envMs("AO_RESPAWN_POLL_MS", 2_000, env),
    // Two idle looks in a row, like the census edge: one quiet frame between spinner redraws is not
    // the end of a turn.
    idleLooks: overrides.idleLooks ?? 2,
  };
}

export function respawnDir({ env = process.env, home = homedir() } = {}) {
  return join(stateRoot(env, home), "respawn");
}

/** Where the agent is asked to write its handoff. Outside every repo, so nothing lands in a diff. */
export function handoffPath(agentId, predecessorId, { env = process.env, home = homedir() } = {}) {
  return join(stateRoot(env, home), "handoffs", String(agentId), `${predecessorId || Date.now()}.md`);
}

/** One line: `send-keys -l` types it, and a newline inside would submit half of it. */
export function handoffRequest(path) {
  return `[ao] Handoff requested: this session is about to be replaced by a fresh one of you. Start no new work. ` +
    `Write a Markdown handoff with exactly these sections — ## Goal, ## State, ## Open questions, ## Files (paths that matter) — ` +
    `to ${path}.tmp, then rename it to ${path}. Reply DONE when it is written.`;
}

/** The panes of one session with the identity each carries (a pane option wins over the session's). */
export async function sessionPanes(session) {
  // The title last: it is the one field a program can fill with anything, a tab included.
  const format = ["#{pane_id}", "#{pane_dead}", "#{pane_current_command}", "#{pane_current_path}", IDENTITY_FORMAT, "#{pane_title}"].join("\t");
  const width = Object.keys(SESSION_OPTIONS).length;
  const result = await tmux.tmux(["list-panes", "-s", "-t", `=${session}`, "-F", format], { allowFailure: true });
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter((line) => line.trim()).map((line) => {
    const [paneId, dead, command, cwd, ...rest] = line.split("\t");
    const meta = parseIdentityFields(rest.slice(0, width));
    const title = rest.slice(width).join("\t");
    return { paneId, dead: dead === "1", title, command, cwd, meta, identity: sessionIdentity({ name: session, meta }) };
  });
}

/**
 * Wait until the pane's turn has ended: no busy evidence (census.mjs's measured spinner markers) on
 * the title or the tail for `idleLooks` looks in a row, or the pane is dead. A capture that failed is
 * not an idle look. TM-297: nor is a composer holding typed text, when the adapter declares how an
 * empty one looks — that is someone's unsent input. Returns { ended, waited_ms, reason }. Never sends
 * anything to the pane.
 */
export async function waitForTurnEnd({ session, pane, adapter = null, timeoutMs, pollMs = 2_000, idleLooks = 2, onLook = () => {} }) {
  const started = Date.now();
  let idle = 0;
  for (;;) {
    const current = (await sessionPanes(session)).find((entry) => entry.paneId === pane);
    if (!current || current.dead) return { ended: true, waited_ms: Date.now() - started, reason: current ? "pane exited" : "pane gone" };
    const tail = await tmux.tmux(["capture-pane", "-p", "-t", pane, "-S", "-20"], { allowFailure: true });
    const busy = tail.code !== 0 ? "capture failed"
      : busyEvidence(`${current.title}\n${tail.stdout}`) || (composerEmptyOnScreen(adapter, tail.stdout) === false ? "composer not empty" : null);
    idle = busy ? 0 : idle + 1;
    onLook({ busy, idle });
    if (idle >= idleLooks) return { ended: true, waited_ms: Date.now() - started, reason: "no busy evidence" };
    if (Date.now() - started >= timeoutMs) return { ended: false, waited_ms: Date.now() - started, reason: `still busy (${busy}) after ${timeoutMs}ms` };
    await sleep(pollMs);
  }
}

/** Wait for the handoff file: present, non-empty, and the same size on two looks. */
export async function waitForFile(path, { timeoutMs, pollMs = 1_000 }) {
  const started = Date.now();
  let last = -1;
  for (;;) {
    const size = (await stat(path).catch(() => null))?.size ?? -1;
    if (size > 0 && size === last) return true;
    last = size;
    if (Date.now() - started >= timeoutMs) return false;
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - started))));
  }
}

/**
 * Claude Code keeps a transcript per cwd: `~/.claude/projects/<cwd with / and . as ->/<uuid>.jsonl`
 * (.claude/rules/parsing-claude-jsonl.md); the newest file is the live conversation.
 * ponytail: claude only. Other providers report no transcript and fall back to the pane capture.
 */
export async function findTranscript({ adapterId, cwd, home = homedir() }) {
  if (adapterId !== "claude" || !cwd) return null;
  const dir = join(home, ".claude", "projects", sanitizeCwd(cwd));
  const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let newest = null;
  for (const entry of files.filter((file) => file.isFile() && file.name.endsWith(".jsonl"))) {
    const path = join(dir, entry.name);
    const mtime = (await stat(path).catch(() => null))?.mtimeMs ?? 0;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  return newest?.path ?? null;
}

/** The last `maxBytes` of a file as complete lines. Never reads the whole file (it can be 30+ MB). */
export async function readTail(path, maxBytes = 256 * 1024) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // the first line is cut mid-way
    return lines.filter((line) => line.trim());
  } finally { await handle.close(); }
}

const clip = (text, max = 600) => { const value = String(text).replace(/\s+/g, " ").trim(); return value.length > max ? `${value.slice(0, max)}…` : value; };

/**
 * The readable turns in a transcript tail: user and assistant text, tool calls by name. Thinking and
 * image blocks are dropped, unknown types and unparseable lines skipped (the rule file's contract).
 */
export function transcriptTurns(lines, keep = 30) {
  const turns = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "user" && entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    const parts = typeof content === "string" ? [content] : (Array.isArray(content) ? content : []).flatMap((block) => {
      if (block?.type === "text") return [block.text];
      if (block?.type === "tool_use") return [`(tool: ${block.name})`];
      return []; // thinking, image, tool_result
    });
    const text = clip(parts.join(" "));
    if (text) turns.push({ role: entry.type, text });
  }
  return turns.slice(-keep);
}

/** The fallback handoff, labelled so nobody mistakes it for the agent's own account. */
export function fallbackHandoff({ agentId, waitedMs, transcript = null, turns = [], paneTail = null }) {
  const source = transcript ? `the tail of its transcript ${transcript}` : "the last lines of its pane (no transcript was found)";
  return [
    `# Handoff — ${transcript ? "TRANSCRIPT-DERIVED" : "PANE-CAPTURE"} FALLBACK`,
    "",
    `> Agent \`${agentId}\` did not write a handoff within ${Math.round(waitedMs / 1000)}s. This is NOT its own account:`,
    `> it is ${source}, extracted mechanically. Goal, state and open questions must be inferred by the reader.`,
    "",
    "## Goal", "", "_Not stated — the agent did not answer._", "",
    "## State", "",
    ...(transcript ? turns.map((turn) => `- **${turn.role}:** ${turn.text}`) : ["```", String(paneTail ?? "").trimEnd(), "```"]),
    "", "## Open questions", "", "_Unknown._", "", "## Files", "", "_Unknown._", "",
  ].join("\n");
}

/** Hold `withLock` open until the returned release() is called. */
async function holdLock(path, options) {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  let done;
  await new Promise((entered, refused) => {
    done = withLock(path, async () => { entered(); await released; }, options);
    done.catch(refused);
  });
  return async () => { release(); await done; };
}

/**
 * Claim an agent for a new session. With no live session: hold the lock and return { respawn: null }.
 * With one: run the handoff flow, end the old session, and return { respawn: record }. Either way the
 * caller creates its session and then calls `release()`.
 *
 * Refusals: TOPOLOGY_AGENT_ALREADY_LIVE (`respawn: false`, for scripts that detect busy agents),
 * TOPOLOGY_AGENT_BUSY (the turn did not end in time; the old session is untouched),
 * TOPOLOGY_RESPAWN_SHARED_SESSION (the agent is one pane of a team session; replacing it would end the
 * others), TOPOLOGY_RESPAWN_JOINED (a concurrent re-spawn already replaced it; details carry its result).
 */
export async function claimAgent({ agentId, agentsDir = null, except = null, adapter = null, respawn = true, requestedBy = null, mode = "handoff",
  env = process.env, home = homedir(), bounds: overrides = {}, deps = {} }) {
  const bounds = respawnBounds(env, overrides);
  const kill = deps.killSession ?? tmux.killSession;
  const liveSessionOf = deps.liveSessionOf ?? (await import("./launch.mjs")).liveSessionOf;
  const dir = respawnDir({ env, home });
  const startedAt = Date.now();
  const release = await holdLock(join(dir, `${agentId}.lock`), {
    timeoutMs: bounds.turnTimeoutMs + bounds.handoffTimeoutMs + bounds.exitTimeoutMs + 120_000, timeoutCode: "TOPOLOGY_RESPAWN_LOCK_TIMEOUT" });
  try {
    const holder = await liveSessionOf(agentId, { agentsDir, except });
    if (!holder) return { release, respawn: null };
    invariant(respawn, "TOPOLOGY_AGENT_ALREADY_LIVE", `Agent ${agentId} already has a live session, "${holder}". One agent holds one session: use that one, stop it first, re-spawn it without --no-respawn, or give the parallel work to a different agent.`, { agent_id: agentId, session: holder });

    const lastPath = join(dir, `${agentId}.last.json`);
    const last = await readJson(lastPath).catch(() => null);
    if (last && Date.parse(last.at) >= startedAt) {
      fail("TOPOLOGY_RESPAWN_JOINED", `Agent ${agentId} was re-spawned by a concurrent request while this one waited; that replacement stands. Its handoff is ${last.handoff?.path}.`, { agent_id: agentId, session: holder, joined: last });
    }

    const panes = await sessionPanes(holder);
    const own = panes.filter((entry) => entry.identity?.agentId === agentId);
    const others = panes.filter((entry) => entry.identity?.agentId && entry.identity.agentId !== agentId);
    invariant(others.length === 0, "TOPOLOGY_RESPAWN_SHARED_SESSION", `Agent ${agentId} is one pane of the team session "${holder}"; replacing it would end ${others.length} other agent(s). Stop that run first.`, { agent_id: agentId, session: holder });
    // A legacy session carries no pane identity: then its one pane is the agent's.
    const pane = (own[0] ?? panes[0])?.paneId;
    const holderIdentity = own[0]?.identity ?? sessionIdentity({ name: holder, meta: panes[0]?.meta ?? {} });
    const predecessor = { session: holder, id: holderIdentity?.sessionId ?? null, kind: holderIdentity?.kind ?? null };
    const events = [];
    const note = (step, extra = {}) => events.push({ step, at: nowIso(), ...extra });

    // 1. Never mid-turn.
    note("turn-wait");
    const turn = pane ? await waitForTurnEnd({ session: holder, pane, adapter, timeoutMs: bounds.turnTimeoutMs, pollMs: bounds.pollMs, idleLooks: bounds.idleLooks })
      : { ended: true, waited_ms: 0, reason: "no pane" };
    invariant(turn.ended, "TOPOLOGY_AGENT_BUSY", `Agent ${agentId} is mid-turn in "${holder}" and did not finish within ${bounds.turnTimeoutMs}ms; it was not interrupted and its session is untouched. Retry later, or raise --turn-timeout.`, { agent_id: agentId, session: holder, reason: turn.reason });
    note("turn-ended", { waited_ms: turn.waited_ms, reason: turn.reason });

    // TM-297 resume: no handoff — the successor resumes this provider conversation, so it keeps its own
    // context. Only where that is provably possible; otherwise say why and take the handoff path.
    const resume = mode === "resume" ? await resumableSession({ adapter, agentId, agentsDir, cwd: (panes.find((entry) => entry.paneId === pane) ?? {}).cwd, home }) : null;
    if (resume) note("resume", resume);
    const path = handoffPath(agentId, predecessor.id, { env, home });
    let handoff = null;
    // 2. Ask for the handoff, 3. or fall back.
    if (!resume?.provider_session_id) {
      await mkdir(dirname(path), { recursive: true });
      const paneAlive = (await sessionPanes(holder)).some((entry) => entry.paneId === pane && !entry.dead);
      if (paneAlive) {
        note("handoff-requested", { path });
        await tmux.sendText(pane, handoffRequest(path), adapter?.submit_keys);
      }
      const answered = paneAlive && await waitForFile(path, { timeoutMs: bounds.handoffTimeoutMs, pollMs: Math.min(bounds.pollMs, 1_000) });
      if (answered) {
        handoff = { path, source: "agent" };
      } else {
        const cwd = (panes.find((entry) => entry.paneId === pane) ?? {}).cwd;
        const transcript = await findTranscript({ adapterId: adapter?.id, cwd, home });
        const turns = transcript ? transcriptTurns(await readTail(transcript)) : [];
        const paneTail = transcript ? null : (await tmux.tmux(["capture-pane", "-p", "-t", pane ?? holder, "-S", "-80"], { allowFailure: true })).stdout;
        // Rename over whatever partial file the agent may have left, so the fallback is the one answer.
        await writeText(`${path}.fallback`, fallbackHandoff({ agentId, waitedMs: bounds.handoffTimeoutMs, transcript, turns, paneTail }));
        await rename(`${path}.fallback`, path);
        handoff = { path, source: transcript ? "transcript-fallback" : "pane-capture-fallback", transcript };
      }
      note("handoff-ready", { source: handoff.source });
    }

    // 4. End it exactly once: the provider's own exit if it declares one, then kill that session.
    if (pane && adapter?.exit_command && (await sessionPanes(holder)).some((entry) => entry.paneId === pane && !entry.dead)) {
      await tmux.sendText(pane, adapter.exit_command, adapter.submit_keys);
      const deadline = Date.now() + bounds.exitTimeoutMs;
      while (Date.now() < deadline && (await sessionPanes(holder)).some((entry) => entry.paneId === pane && !entry.dead)) await sleep(250);
    }
    await kill(holder);
    invariant(!(await tmux.hasSession(holder)), "TOPOLOGY_RESPAWN_END_FAILED", `Session "${holder}" is still live after kill-session.`, { agent_id: agentId, session: holder });
    note("session-ended");

    const record = { agent: agentId, at: nowIso(), requested_by: requestedBy, predecessor, handoff, ...(resume ? { resume } : {}), turn: { waited_ms: turn.waited_ms, reason: turn.reason }, events };
    await writeJson(lastPath, record);
    return { release, respawn: record };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * TM-297: can the successor resume this provider conversation? Needs an adapter that declares
 * `resume_args`, a live session running in the agent's own directory (a provider files its sessions
 * by cwd, and the successor runs there), and that session's id. Returns { provider_session_id } or
 * { provider_session_id: null, reason }.
 */
export async function resumableSession({ adapter, agentId, agentsDir, cwd, home = homedir() }) {
  const no = (reason) => ({ provider_session_id: null, reason });
  if (!(adapter?.resume_args ?? []).length) return no(`provider ${adapter?.id ?? "unknown"} declares no resume_args`);
  const own = agentsDir ? join(agentsDir, String(agentId)) : null;
  if (!own || cwd !== own) return no(`the live session runs in ${cwd ?? "an unknown directory"}, not the agent's own directory ${own ?? "(unknown)"}`);
  const transcript = await findTranscript({ adapterId: adapter.id, cwd, home });
  if (!transcript) return no(`no ${adapter.id} session transcript was found for ${cwd}`);
  return { provider_session_id: basename(transcript, ".jsonl"), transcript };
}

/** Read the handoff text for a caller's output. */
export async function readHandoff(record) {
  if (!record?.handoff?.path) return null;
  const { readFile } = await import("node:fs/promises");
  return readFile(record.handoff.path, "utf8").catch(() => null);
}

/** The explicit way a lead gives a new session its predecessor's handoff: a verified pointer to the file. */
export function handoffPointer(path) {
  return `[ao] Your previous session left a handoff: read ${path} before continuing.`;
}

export async function passHandoff({ pane, adapter = null, path }) {
  const { deliverPointer } = await import("./launch.mjs");
  return deliverPointer(pane, adapter ?? { submit_keys: ["Enter"] }, handoffPointer(path));
}
