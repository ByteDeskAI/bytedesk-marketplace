// TM-222 (EP-021). Host-side liveness for a lead that is mid-turn.
//
// The nonce probe needs the MODEL to read a line and run a command, so a lead deep in a long turn
// missed the 30s window and read as unresponsive while it was working. Claude Code fires hooks
// (UserPromptSubmit, PostToolUse, Stop) from the harness itself, between and inside turns, with no
// model involvement. The plugin hook writes one small file per pane on each of them; lead.mjs
// accepts a fresh one as proof that a live agent harness is running in the lead's exact pane.
//
// What binds a heartbeat to an incarnation: the tmux socket and server pid from $TMUX, the pane id
// from $TMUX_PANE, and the hook's ancestor pids, which must contain the binding's pane pid. A
// respawned pane keeps its id but not its pid, so an old heartbeat cannot vouch for a new process.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { stateRoot } from "./repoid.mjs";
import { readJson, writeJson } from "./util.mjs";

// A long single tool call (a test run) fires no hook, so the window has to outlast one.
export const HEARTBEAT_TTL_MS = Number(process.env.AO_LEAD_HEARTBEAT_TTL_MS ?? 300_000);

export function heartbeatDir(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), "heartbeats");
}

export function heartbeatPath(dir, serverKey, paneId) {
  return join(dir, `${createHash("sha256").update(`${serverKey}\0${paneId}`).digest("hex")}.json`);
}

// ponytail: /proc only. Elsewhere the chain is just our parent, so a pane whose pid is further up
// (a shell running claude) gets no heartbeat proof and falls back to the nonce probe.
export async function ancestorPids(pid = process.pid) {
  const pids = [];
  for (let i = 0; i < 32 && pid > 1; i += 1) {
    pids.push(pid);
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    if (!stat) { if (i === 0) pids.push(process.ppid); break; }
    pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  }
  return pids;
}

/** Hook side: record that the harness in this pane just ran an event. No tmux pane, nothing written. */
export async function recordHeartbeat({ event, env = process.env, home = homedir(), pids = null, now = Date.now } = {}) {
  const [serverKey, serverPid] = String(env.TMUX || "").split(",");
  if (!serverKey || !env.TMUX_PANE) return null;
  const path = heartbeatPath(heartbeatDir(env, home), serverKey, env.TMUX_PANE);
  await writeJson(path, { serverKey, serverPid: Number(serverPid), paneId: env.TMUX_PANE, pids: pids ?? await ancestorPids(),
    event: event ?? null, at: now(), agent_id: env.AO_AGENT_ID || env.AO_SESSION_AGENT_ID || null });
  return path;
}

/** Lead side: a fresh heartbeat from inside this exact binding, or null. */
export async function recentHeartbeat(dir, binding, { now = Date.now, ttlMs = HEARTBEAT_TTL_MS } = {}) {
  if (!binding?.serverKey || !binding.paneId) return null;
  const beat = await readJson(heartbeatPath(dir, binding.serverKey, binding.paneId)).catch(() => null);
  if (!beat || beat.serverKey !== binding.serverKey || beat.paneId !== binding.paneId || beat.serverPid !== binding.serverPid) return null;
  if (!Array.isArray(beat.pids) || !beat.pids.includes(binding.panePid)) return null;
  const age = now() - Number(beat.at);
  if (!(age >= 0 && age < ttlMs)) return null;
  return { age_ms: age, event: beat.event, busy: beat.event !== "Stop" };
}
