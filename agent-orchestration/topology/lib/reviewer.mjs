// The persistent code reviewer. One dedicated reviewer session per REPOSITORY — shared across
// every linked worktree, because canonicalRepoId() says a worktree and its main checkout are one
// repository, and a reviewer per checkout would be a reviewer per race condition.
//
// Why a registry at all: the reviewer's tmux session is the live state, but a session name alone
// cannot answer "who reviews this repo, on which provider, and is that still running?" from a
// process that did not create it. So the session is mirrored into a host-local record under
// stateRoot()/reviewers/<repoKey>.json — exactly like the lead's — and every ensure path goes
// through withLock, because two conductors starting up at once must converge on ONE reviewer, not
// mint one each and halve the meaning of "independent review".
//
// Independence is a mechanical property, not a prompt instruction. The reviewer is never the repo
// lead and never the author of the change under review (notAgentIds). A record that names one of
// those is refused with TOPOLOGY_REVIEWER_CONFLICT rather than "fixed", because silently swapping
// identities is how a review ends up approving its own author.
//
// The provider comes from configuration and ONLY from configuration: config.reviewer.provider,
// then the reviewer template's cli, and the result must sit in
// config.management.reviewer_providers (default ["claude","codex"]). Anything else is
// TOPOLOGY_REVIEWER_PROVIDER. A reviewer on an unapproved provider is not a reviewer the operator
// agreed to trust, and hardcoding a provider here would be a policy decision hiding in a library.
//
// Availability fails closed and is REPORTED, never pretended: reviewerAvailability() says exactly
// what is wrong, and reviewEligibility() will not call a task merge-ready while the reviewer is
// missing or dead. A review record is bound to an EXACT revision — an approval of a superseded
// revision is "stale", because any edit after the review invalidates it.
//
// One thing this module deliberately does NOT confer: merge authority. The reviewer reviews; the
// merge gate in manage.mjs decides. An approving review is evidence, not a permission, and nothing
// here merges, pushes, or deletes anything.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDirs, createAgent, findLead, listAgents, requireAgent, resolveAgentRef } from "./agents.mjs";
import { readLeadRegistration } from "./lead.mjs";
import { sendStandingMessage } from "./standing-mailbox.mjs";
import { SUPERVISOR_SENDER } from "./nats-outage.mjs";
import { findTemplate, loadConfig } from "./config.mjs";
import { displayName } from "./identity.mjs";
import { composerFormat, LATE_ACK_GRACE_MS, wakeForProbe } from "./delivery.mjs";
import { openRoleSession, recordedRoleSession, roleSessionFor, tmuxFailureTrigger } from "./launch.mjs";
import { withLock } from "./lockfile.mjs";
import { composePrompt, promptErrorDetail } from "./prompts.mjs";
import { refreshPrompt } from "./prompt-lifecycle.mjs";
import { incarnationOf, sameIncarnation } from "./incarnation.mjs";
import { adapterFor, buildArgv, loadAdapters, providerDirs } from "./providers.mjs";
import { canonicalRepoId, pinnedGithubRepo, repoKey, stateRoot } from "./repoid.mjs";
import * as tmux from "./tmux.mjs";
import { AO_HOME, exists, fail, invariant, TopologyError, nowIso, readJson, run, sleep, writeJson, writeText } from "./util.mjs";

const REGISTRY_KIND = "reviewers";
const DEFAULT_REVIEWER_PROVIDERS = ["claude", "codex"];
const DEFAULT_TEMPLATE = "reviewer-default";
const VERDICTS = new Set(["approve", "changes_requested", "blocked"]);
// TM-215: findings are structured. Only blocker and major findings stop an approval; minor, nit and
// note findings ride along with it. A note is informational and needs no action, so it may omit
// evidence and fix; it still names a file and line in the diff.
const SEVERITIES = ["blocker", "major", "minor", "nit", "note"];
const BLOCKING_SEVERITIES = new Set(["blocker", "major"]);
// The reviewed range omits binary bytes (no --binary): git renders each binary change as a one-line
// "Binary files ... differ" marker, so screenshot-heavy ranges never inflate the buffered diff.
// This cap is a documented ceiling for the remaining text diff, well above the 8 MiB run() default.
const REVIEW_PATCH_MAX_BYTES = 64 * 1024 * 1024;
const FINDING_TEXT_FIELDS = ["claim", "evidence", "fix"];
/** Wake attempts after publication before an undeliverable request is marked failed (TM-215 f). */
const MAX_REVIEW_WAKES = 5;
/** TM-302: how long a reviewer record's `restarting` mark holds requests off before it is presumed crashed. */
const RESTART_MARK_STALE_MS = 15 * 60_000;
// ponytail: the mark covers only kill + relaunch; one older than the bound is a crashed restart, not a live one.
const restartMarked = record => Boolean(record?.restarting) && Date.now() - Date.parse(record.restarting.at) <= RESTART_MARK_STALE_MS;
/** Scrollback captured when looking for the readiness answer on the pane. */
const REVIEW_CAPTURE_LINES = 5000;

/** Host-local reviewer registry, one record per canonical repository. */
export function reviewersRoot(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), REGISTRY_KIND);
}

/** Only this repository's pollable input is granted to its restricted reviewer. */
export async function reviewerInboxRoot(consumer, env = process.env, home = homedir()) {
  return join(reviewersRoot(env, home), 'inboxes', repoKey((await canonicalRepoId(consumer)).id));
}

export function reviewerProtocolPrompt(agent, consumer, inboxRoot) {
  return `You are ${displayName(agent)} (id "${agent.id}", role: reviewer), the standing code reviewer for ${consumer}. Read ${join(agent._dir, 'prompt.md')} and follow it. At safe boundaries read unexpired probes in ${join(inboxRoot, 'probes')} for your agent id and emit exactly AO_REVIEWER_READY followed by a space and the nonce on its own line; the host records the response. Read requests under ${join(inboxRoot, 'requests')}; read the files under review in the request's worktree path, never the main checkout, which may have another branch checked out; review the complete base_revision..revision patch, never only the final commit (base_revision is the effective base: when the task branch merged the default branch it is that merge-base, so the range excludes code already on the default branch there; admitted_base is the original admission commit), then submit your verdict by calling the ${REVIEW_SUBMIT_TOOL} tool with {"request":"<the request nonce>","verdict":"approve|changes_requested|blocked","findings":[{"severity":"blocker|major|minor|nit|note","file":"<path changed in the patch, or a CHANGELOG.md>","line":<positive integer>,"claim":"...","evidence":"...","fix":"..."}]}; a note may omit evidence and fix. Never print the verdict as your answer instead: the host does not read your pane for verdicts. If the tool refuses, fix what it names and call it again. Approve only when every finding is minor, nit or note; changes_requested needs at least one blocker or major finding. Each request also names a packet_path directory (files.txt, files/, task.md, checks.json, checklist.md): follow its checklist.md, and when checks.json lists unsatisfied required checks you cannot approve; submit blocked and name the missing evidence. Never execute code or change files.`;
}

/**
 * The registry slot for the repository containing `consumer`: canonical identity, its
 * filename-safe key, the record path, and the lock that serializes every mutation of that record.
 */
export async function reviewerPaths(consumer, env = process.env, home = homedir()) {
  const identity = await canonicalRepoId(consumer);
  const key = repoKey(identity.id);
  const root = reviewersRoot(env, home);
  return { identity, key, recordPath: join(root, `${key}.json`), lockPath: join(root, `${key}.lock`) };
}

/** The stored reviewer record for a repository, or null when none was ever ensured. */
export async function readReviewerRecord(consumer, env = process.env, home = homedir()) {
  const { recordPath } = await reviewerPaths(consumer, env, home);
  return (await exists(recordPath)) ? readJson(recordPath) : null;
}

/**
 * The reviewer is never the lead and never the author. Checked on EVERY path — reconnect and
 * restart included — because a library can change under a stored record: an agent promoted to
 * lead since the record was written must not keep reviewing.
 */
function assertIndependent(agentId, { lead, notAgentIds }) {
  if (lead && agentId === lead.id) {
    fail(
      "TOPOLOGY_REVIEWER_CONFLICT",
      `Reviewer ${agentId} is the repo lead (${displayName(lead)}). The lead cannot review its own delegation — demote one identity or ensure a fresh reviewer.`,
      { agent_id: agentId, lead: lead.id },
    );
  }
  if (notAgentIds.includes(agentId)) {
    fail(
      "TOPOLOGY_REVIEWER_CONFLICT",
      `Reviewer ${agentId} is an author of the change under review. An author cannot review their own work — ensure a reviewer that is not one of: ${notAgentIds.join(", ")}.`,
      { agent_id: agentId, authors: notAgentIds },
    );
  }
}

/**
 * The real session opener, used when no probes are injected. Mirrors the CLI's `session open`:
 * the session's cwd is the agent's own directory (that is what gives it memory of its own), the
 * repo is granted explicitly, and the reviewer's coordinates_only flag keeps the grant read-only
 * on CLIs that can express it. Review verdicts go back to the author; the reviewer never writes
 * the project.
 */
async function defaultOpen({ agent, consumer, home, pluginRoot, provider, model, log, env = process.env }) {
  const adapters = await loadAdapters(providerDirs({ pluginRoot, consumer, home }));
  const adapter = adapterFor({ ...agent, cli: provider, model }, adapters);
  const session = await roleSessionFor({ agentsDir: dirname(agent._dir), agentId: agent.id, consumer, role: agent.role, env, home });
  const inboxRoot = await reviewerInboxRoot(consumer, env, home);
  await mkdir(join(inboxRoot, 'probes'), { recursive: true });
  await mkdir(join(inboxRoot, 'requests'), { recursive: true });
  const vars = {
    session,
    agent_id: agent.id,
    agent_role: agent.role,
    bootstrap_file: join(agent._dir, "prompt.md"),
    system_prompt: reviewerProtocolPrompt(agent, consumer, inboxRoot),
  };
  const argv = buildReviewerArgv(adapter, agent, vars, { consumer, model, inboxRoot });
  return openRoleSession({
    agentsDir: dirname(agent._dir),
    agentId: agent.id,
    adapter,
    argv,
    env: { AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: session, AO_CONSUMER: consumer },
    session,
    role: "reviewer",
    log,
  });
}

/**
 * TM-365: the reviewer's one write channel. A stdio MCP server with exactly one tool, review_submit,
 * which writes the verdict record through submitReviewVerdict. It is the only MCP server the
 * reviewer gets (--strict-mcp-config), and the identity it runs under is fixed here by the host.
 */
export const REVIEW_SUBMIT_SERVER = "ao-review";
export const REVIEW_SUBMIT_TOOL = `mcp__${REVIEW_SUBMIT_SERVER}__review_submit`;
// Source runs from topology/lib/; the bundle runs from dist/, a sibling of topology/.
const HERE = dirname(fileURLToPath(import.meta.url));
export const REVIEW_MCP_SCRIPT = basename(HERE) === "lib" ? join(dirname(HERE), "review-mcp.mjs") : join(dirname(HERE), "topology", "review-mcp.mjs");

// The state-root and transport-mode keys only: the server must find the same host state as the
// host, and an MCP server need not inherit its parent's environment. No NATS URL or credentials:
// this config lands in the launcher script, and the mirror falls back to the local server.
const REVIEW_MCP_ENV_KEYS = ["AGENT_ORCHESTRATION_STATE_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "AO_TRANSPORT"];

export function reviewSubmitMcpConfig({ agentId = null, consumer = null, env: hostEnv = process.env } = {}) {
  const env = Object.fromEntries(REVIEW_MCP_ENV_KEYS.filter(key => hostEnv[key]).map(key => [key, hostEnv[key]]));
  if (agentId) env.AO_AGENT_ID = agentId;
  if (consumer) env.AO_CONSUMER = consumer;
  return JSON.stringify({ mcpServers: { [REVIEW_SUBMIT_SERVER]: { type: "stdio", command: process.execPath, args: [REVIEW_MCP_SCRIPT], env } } });
}

/** Restricted Claude explicitly removes code execution and ambient MCP/configs. Custom
 * agent args, environment and MCP would undo that trust boundary and are refused.
 * Other providers need an independently verified equivalent, never a silent downgrade.
 */
export function buildReviewerArgv(adapter, agent, vars, { consumer, model = null, inboxRoot = null }) {
  invariant(!(agent.args?.length) && !(agent.mcp?.length) && !Object.keys(agent.env || {}).length && !agent.command, "TOPOLOGY_REVIEWER_READ_ONLY", "Reviewer custom args, environment, command and MCP are not allowed to override the read-only policy.");
  invariant(adapter.id === "claude", "TOPOLOGY_REVIEWER_READ_ONLY", "This adapter has no verified reviewer isolation covering ambient MCP. Configure a supported restricted reviewer; no provider substitution was made.");
  /**
   * TM-150. WHAT ENFORCES READ-ONLY HERE IS `--restricted`, NOT THIS LIST.
   *
   * Measured, because the list looks like the enforcement and is not: an agent given
   * `--disallowed-tools Write,Edit` refused to Write and then CREATED THE FILE WITH BASH. The deny
   * list removes named tools; it does not remove the shell. `--restricted` removes
   * Bash entirely, and that is why a reviewer under this argv answers "no file-writing tool is
   * available to me (no Write/Edit/Bash…)".
   *
   * So do not "simplify" this by dropping that flag and trusting the deny list plus
   * TOPOLOGY_REVIEWER_READ_ONLY. Isolation would fail SILENTLY — every test still green, the
   * invariant still passing — which is precisely what the "never a silent downgrade" note above
   * fears, arriving through the door that note is not watching.
   *
   * `MultiEdit` was removed from the list: the CLI reports "Permission deny rule 'MultiEdit'
   * matches no known tool", and a rule that matches nothing is noise in the one place a reader
   * most needs to trust what they see.
   *
   * TM-365 replaced `--safe-mode` with `--setting-sources ''`, because safe mode also turns off
   * every MCP server, including one passed with --mcp-config, and the review_submit tool is the
   * reviewer's only verdict channel. Measured 2026-10-05 against claude 2.1.289 with `claude -p
   * ... "list every tool"`: `--restricted --safe-mode` and `--restricted --setting-sources ''`
   * give the SAME tool list (Read, Glob, Grep and other non-writing tools; no Bash, Write or Edit),
   * except that the second one adds mcp__ao-review__review_submit. With no setting sources, no user,
   * project or local settings load, so no plugins, plugin skills or hooks run; only the built-in
   * skills remain. `--restricted` is what removes Bash, so it stays.
   */
  // --mcp-config adds the review_submit server and nothing else (--strict-mcp-config), and the allow
  // rule lets that one tool run without a permission prompt nobody would answer.
  const restricted = { ...adapter, args: ["--restricted", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", reviewSubmitMcpConfig({ agentId: agent.id ?? null, consumer }), "--allowed-tools", REVIEW_SUBMIT_TOOL, "--disallowed-tools", "Write,Edit,NotebookEdit,Agent,Task", "--permission-prompts", "none"], coordinator_args: [], auto_approve_args: [] };
  return buildArgv(restricted, { ...agent, args: [], auto_approve: false, coordinates_only: false, model, add_dirs: [consumer, inboxRoot].filter(Boolean) }, vars);
}

async function bindingAlive(record) {
  if (!record?.binding) return false;
  const panes = await tmux.listServerPanes({ tmuxServer: record.binding.serverKey });
  return panes.some(p => p.alive && ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"].every(key => p[key] === record.binding[key]));
}
async function reviewerOutput(record) {
  if (!await bindingAlive(record)) return "";
  const result = await run("tmux", ["-S", record.binding.serverKey, "capture-pane", "-p", "-J", "-t", record.binding.paneId, "-S", `-${REVIEW_CAPTURE_LINES}`], { allowFailure: true });
  return result.code === 0 && await bindingAlive(record) ? result.stdout : "";
}

const defaultProbes = () => ({ alive: (_session, record) => bindingAlive(record), open: defaultOpen });

/**
 * The readiness challenge: a nonce file the reviewer answers with `AO_REVIEWER_READY <nonce>` on
 * its own pane, which is why this needs no shell and works under `--restricted`.
 *
 * TM-157. It used to be file-ONLY, with a one-second window, and the comment here said "agents poll
 * at safe boundaries; no typing into active composers". The instinct is right and is kept — but an
 * IDLE agent has no next boundary. It sits at an empty composer with nothing to do, never polls,
 * never sees a probe that lives for a second, and reads `unresponsive` forever; the governed launch
 * gate then refuses on a reviewer that is perfectly healthy. That is what stopped every demo run.
 *
 * So the probe now WAKES the pane, under the bell's own rules — composer empty, binding unchanged,
 * no attention or failure screen — and falls back to file-only for a pane that is busy, which is
 * exactly the case the original comment was protecting. `AO_PROBE_TIMEOUT_MS` is the window; one
 * second was not answerable by an agent that is awake, never mind one that has to notice first.
 */
export const PROBE_TIMEOUT_MS = Number(process.env.AO_PROBE_TIMEOUT_MS ?? 20_000);
export const PROBE_POLL_MS = Number(process.env.AO_PROBE_POLL_MS ?? 500);

const reviewerListeners = new Set();

/** The reviewer process answers probe requests on its orch subject. */
export async function listenForReviewer({ consumer, record, env = process.env, transport = null }) {
  if (!record?.agent_id) return { listening: false };
  const { resolveTransport, orchName } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const active = transport ?? await resolveTransport({ env });
  if (active.kind !== 'nats') return { listening: false, transport: active.kind };
  const repo = repoKey(record.repo_id || (await canonicalRepoId(consumer)).id);
  const agent = orchName(record.agent_id);
  const key = `${repo}:${agent}`;
  if (reviewerListeners.has(key)) return { listening: true, already: true, transport: 'nats' };
  await active.serveProbe({
    repo,
    agent,
    handler: async (body) => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { parsed = { nonce: String(body) }; }
      if (parsed.agent_id && parsed.agent_id !== record.agent_id) return '';
      return `AO_REVIEWER_READY ${parsed.nonce}`;
    },
  });
  reviewerListeners.add(key);
  return { listening: true, transport: 'nats', subject: `orch.${repo}.probe.${agent}` };
}

/**
 * Publish one complete reviewer response on its orch subject. TM-195: it used to publish
 * `{verdict, findings: []}` with approve as the default, so the subject could carry a verdict but
 * never a finding. Now the response is the same text the pane carries (`b64:<base64>` or JSON),
 * decoded and checked by the same decoder, and published whole; a malformed one is refused here.
 */
export async function publishReviewerVerdict({ consumer, repo, nonce, response, env = process.env, transport = null }) {
  const verdict = decodeReviewPayload(typeof response === 'string' ? response : JSON.stringify(response));
  const { resolveTransport, publishReviewVerdict } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const active = transport ?? await resolveTransport({ env });
  const name = repo || repoKey((await canonicalRepoId(consumer)).id);
  return publishReviewVerdict({ repo: name, nonce, verdict, transport: active, env });
}

/** Wait for a verdict published on the verdict subject (`review await`). Collection does not wait:
 * it reads the durable record submitReviewVerdict wrote (TM-365). */
export async function awaitReviewerVerdict({ consumer, repo, nonce, timeoutMs = 2000, env = process.env, transport = null }) {
  const { resolveTransport } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const active = transport ?? await resolveTransport({ env });
  const name = repo || repoKey((await canonicalRepoId(consumer)).id);
  return active.beginVerdictWait({ repo: name, nonce, timeoutMs });
}

export async function reviewerProbeReady({ consumer, record, env = process.env, home = homedir(), timeoutMs = PROBE_TIMEOUT_MS, onProbe = null, output = reviewerOutput, wake = defaultWake, adapters = null, alive = bindingAlive, readOnly = false, transport = null }) {
  if (!record?.agent_id || !incarnationOf(record.binding) || !await alive(record)) return false;
  const dir = join(await reviewerInboxRoot(consumer, env, home), "probes");
  // TM-157: an ack that cost a model turn is kept. See the same block in lead.mjs for why — a
  // governed launch needs BOTH roles responsive in one call, and two independent model turns do not
  // land inside one window. Bound to the six-tuple, so a respawn proves nothing; `alive` is still
  // asked every time.
  const cached = await recentReviewerAck(dir, record);
  if (cached) return true;
  // TM-161: an ack left against a still-unexpired probe by a reviewer that answered after the last
  // wait returned. The same rule as the lead's, and the same line — expires_at.
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".ack.json")) continue;
    const stale = name.slice(0, -".ack.json".length);
    const pending = await readJson(join(dir, `${stale}.json`)).catch(() => null);
    const ack = await readJson(join(dir, name)).catch(() => null);
    const mine = ack?.nonce === stale && pending?.nonce === stale && ack.agent_id === record.agent_id && ack.repo_id === record.repo_id && ack.session === record.session && sameIncarnation(ack.binding, record.binding) && sameIncarnation(pending.binding, record.binding);
    if (!readOnly) await Promise.all([rm(join(dir, `${stale}.json`), { force: true }), rm(join(dir, name), { force: true })]);
    if (mine && Number(pending.expires_at) >= Date.now() && await alive(record)) { if (!readOnly) await rememberReviewerAck(dir, record); return true; }
  }
  if (readOnly) return false;
  const nonce = randomUUID();
  const path = join(dir, `${nonce}.json`), ackPath = join(dir, `${nonce}.ack.json`);
  // TM-187: the probe outlives the wait by LATE_ACK_GRACE_MS. These were one number, which is what
  // made the `finally` below delete every timed-out probe while claiming to keep the answerable ones.
  const probe = { nonce, repo_id: record.repo_id, agent_id: record.agent_id, session: record.session, binding: incarnationOf(record.binding), expires_at: Date.now() + timeoutMs + LATE_ACK_GRACE_MS };
  let waitUntil = Date.now() + timeoutMs;
  const { resolveTransport, orchName } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const activeTransport = transport ?? await resolveTransport({ env });
  if (activeTransport.kind === 'nats') {
    const reply = await activeTransport.requestProbe({
      repo: repoKey(record.repo_id),
      agent: orchName(record.agent_id),
      body: JSON.stringify(probe),
      timeoutMs,
    }).catch(() => null);
    return Boolean(reply && String(reply.body).includes(nonce));
  }
  await activeTransport.saveProbe({ filePath: path, body: probe });
  try {
    await onProbe?.(probe);
    // Best effort by contract: a pane that cannot be woken is not a pane that failed. The file is
    // already written, so a refusal here degrades to exactly the old behaviour rather than to an
    // error — and a busy agent answers at its next boundary the way it always did.
    // The wake costs real time — a tmux look, maybe a styled capture, a keystroke — and that time
    // must not be taken out of the agent's window. So the probe's expiry moves by exactly what the
    // wake spent, and the file is rewritten to match, because `reviewerNonceAck` validates an ack
    // against `expires_at` and a window the host waits on but the ack refuses is worse than either.
    const wokeAt = Date.now();
    try { await wake?.({ consumer, record, nonce, env, home, adapters }); } catch { /* best effort */ }
    const wakeCost = Date.now() - wokeAt;
    if (wakeCost > 0) {
      probe.expires_at += wakeCost;
      waitUntil += wakeCost;
      await activeTransport.saveProbe({ filePath: path, body: probe }).catch(() => {});
    }
    while (Date.now() <= waitUntil) {
      const screen = await output(record);
      if (readySignalOnScreen(screen, nonce) && await alive(record)) { await rememberReviewerAck(dir, record); return true; }
      const ack = await readJson(ackPath).catch(() => null);
      if (ack?.nonce === nonce && ack.agent_id === record.agent_id && ack.repo_id === record.repo_id && ack.session === record.session && sameIncarnation(ack.binding, record.binding) && await alive(record)) { await rememberReviewerAck(dir, record); return true; }
      // TM-157: the window is now seconds rather than one second, so the poll has to be a poll and
      // not a spin — at 25ms this would take ~800 captures of the same pane to answer one probe.
      await sleep(Math.min(PROBE_POLL_MS, Math.max(1, waitUntil - Date.now())));
    }
    return false;
  } finally {
    // TM-161, the reviewer's half. The probe OUTLIVES this wait, up to its own expires_at: a
    // reviewer that was mid-review when the ring landed answers at its next boundary, and that
    // answer used to arrive to a deleted file. Only a probe that was ANSWERED, or one nobody can
    // answer any more, is removed here.
    const answered = await exists(ackPath);
    const expired = Date.now() > probe.expires_at;
    if (answered || expired) await Promise.all([rm(path, { force: true }), rm(ackPath, { force: true })]);
  }
}

/**
 * Did the reviewer answer THIS nonce on its own pane?
 *
 * TM-157. This was `line.trim() === "AO_REVIEWER_READY <nonce>"`, and a correct answer could never
 * satisfy it: Claude renders every line of its own output with a leading bullet, so the pane shows
 *
 *     ● AO_REVIEWER_READY af9cb619-cc66-4cfd-aceb-9d84fb942a60
 *
 * and exact equality failed on the bullet. Measured on a live pane — the reviewer obeyed the
 * protocol perfectly and was still reported unresponsive.
 *
 * The decoration is stripped rather than the match loosened, and a line carrying AO_PROBE is
 * excluded outright: the ring itself ends with the same nonce ("Reply with exactly: …"), so a
 * looser match would let the QUESTION count as its own ANSWER.
 */
export function readySignalOnScreen(screen, nonce) {
  return String(screen ?? "").split(/\r?\n/).some((line) => {
    if (line.includes("AO_PROBE")) return false;
    return line.trim().replace(/^[\s\u25cf\u2022*>\u276f-]+/, "") === `AO_REVIEWER_READY ${nonce}`;
  });
}

/** How long a reviewer's acknowledgement stands as proof that this incarnation answers. */
const RESPONSIVE_TTL_MS = Number(process.env.AO_RESPONSIVE_TTL_MS ?? 600_000);

const reviewerAckMemo = (dir, record) => join(dir, `${record.agent_id}.answered.json`);

async function recentReviewerAck(dir, record) {
  const memo = await readJson(reviewerAckMemo(dir, record)).catch(() => null);
  if (!memo?.at) return null;
  const age = Date.now() - Number(memo.at);
  if (!(age >= 0 && age < RESPONSIVE_TTL_MS)) return null;
  return memo.agent_id === record.agent_id && sameIncarnation(memo.binding, record.binding) ? { age_ms: age } : null;
}

async function rememberReviewerAck(dir, record) {
  await writeJson(reviewerAckMemo(dir, record), { at: Date.now(), agent_id: record.agent_id, binding: record.binding ?? null }).catch(() => {});
}

/**
 * Ring the reviewer's pane with the one line it needs to answer. The adapter comes from the
 * record's own provider — the reviewer is launched restricted, but its READY signal is a printed
 * line, so nothing here needs it to have a shell.
 */
async function defaultWake({ consumer, record, nonce, env, home, adapters = null }) {
  if (!record?.pane) return { rang: false, reason: "the record names no pane" };
  const loaded = adapters ?? await loadAdapters(providerDirs({ consumer, home, env })).catch(() => null);
  const adapter = loaded ? adapterFor({ cli: record.provider, model: null, args: [], skills: [] }, loaded) : null;
  if (!adapter) return { rang: false, reason: `no adapter for provider ${record.provider}` };
  return wakeForProbe({
    pane: record.pane,
    adapter,
    format: composerFormat(adapter, tmuxFailureTrigger(adapter)),
    binding: record.binding,
    text: `AO_PROBE ${nonce} — you are being asked to prove you are listening. Reply with exactly: AO_REVIEWER_READY ${nonce}`,
  });
}

export async function reviewerNonceAck({ consumer, nonce, env = process.env, home = homedir(), alive = bindingAlive }) {
  invariant(/^[a-f0-9-]{36}$/.test(String(nonce)), "TOPOLOGY_REVIEWER_NONCE", "Invalid reviewer nonce.");
  const dir = join(await reviewerInboxRoot(consumer, env, home), "probes");
  const probe = await readJson(join(dir, `${nonce}.json`));
  const record = await readReviewerRecord(consumer, env, home);
  const identity = await canonicalRepoId(consumer);
  invariant(record && probe.repo_id === identity.id && probe.agent_id === record.agent_id && env.AO_AGENT_ID === record.agent_id && probe.nonce === nonce && probe.session === record.session && sameIncarnation(probe.binding, record.binding) && probe.expires_at >= Date.now() && await alive(record), "TOPOLOGY_REVIEWER_ACK_OWNER", "Only the designated reviewer can acknowledge its current unexpired challenge.");
  await writeJson(join(dir, `${nonce}.ack.json`), { ...probe, acknowledged_at: nowIso() });
  return { ok: true, nonce };
}

/**
 * A reviewer only runs on a provider the operator approved for review. Shared by every path that
 * installs one — minting from config and enrolling a running session alike — because an enrolment
 * that skipped it would be a hole in exactly the guarantee the check exists for.
 */
function assertApprovedProvider(provider, loaded) {
  const allowed = loaded.config.management?.reviewer_providers ?? DEFAULT_REVIEWER_PROVIDERS;
  invariant(
    Array.isArray(allowed) && DEFAULT_REVIEWER_PROVIDERS.includes(provider) && allowed.includes(provider),
    "TOPOLOGY_REVIEWER_PROVIDER",
    `Reviewer provider "${provider ?? "none"}" is not in management.reviewer_providers (${Array.isArray(allowed) ? allowed.join(", ") : "invalid config"}). The reviewer only runs on a provider the operator approved for review — change the config, not this check.`,
    { provider, allowed },
  );
}

/**
 * Resolve the reviewer provider from configuration — and refuse anything the operator did not
 * approve. The chain is config.reviewer.provider, then the template's cli; the result must be in
 * management.reviewer_providers. Returns { provider, model, templateName, template, loaded }.
 */
async function resolveReviewerConfig({ consumer, home, pluginRoot, env, requested = null }) {
  const loaded = await loadConfig({ consumer, home, pluginRoot, env });
  invariant(loaded.errors.length === 0, "TOPOLOGY_REVIEWER_CONFIG", "Reviewer config is invalid.", { errors: loaded.errors });
  const templateName = loaded.config.reviewer?.template ?? DEFAULT_TEMPLATE;
  const found = findTemplate(loaded.layers, templateName);
  invariant(
    found,
    "TOPOLOGY_REVIEWER_TEMPLATE",
    `No reviewer template named "${templateName}" in any config layer. Declare one (the plugin defaults ship "reviewer-default") or set reviewer.template to a template that exists.`,
  );
  // TM-364: a provider the caller names wins over configuration, and is held to the same allowlist.
  const configured = loaded.config.reviewer?.provider ?? found.template.cli ?? null;
  const provider = requested ?? configured;
  const model = provider === configured ? loaded.config.reviewer?.model ?? found.template.model ?? null : null;
  assertApprovedProvider(provider, loaded);
  return { provider, model, templateName, template: found.template, loaded };
}

/**
 * Ensure this repository has its one persistent reviewer, creating it on first use.
 * Returns { record, agent, created, reattached, restarted }.
 *
 * Serialized by withLock on the repo's registry slot, and the record is re-read INSIDE the lock:
 * six concurrent ensures produce one agent, one session, one record — the five losers find the
 * winner's live session and return the SAME identity.
 *
 * `notAgentIds` names the authors of the work under review; the reviewer may not be one of them.
 * `probes` ({ alive, open }) injects session liveness and creation so tests run without tmux.
 */
export async function ensureReviewer({ consumer, home = homedir(), pluginRoot = null, env = process.env, log = () => {}, notAgentIds = [], probes = null, provider: requested = null }) {
  invariant(consumer, "TOPOLOGY_REVIEWER_CONSUMER", "ensureReviewer needs a consumer path to identify the repository.");
  const session = { ...defaultProbes(), ...probes };
  const { identity, recordPath, lockPath } = await reviewerPaths(consumer, env, home);
  const dirs = agentDirs({ pluginRoot, consumer, home });

  return withLock(lockPath, async () => {
    const lead = await findLead(dirs);

    // Reconnect beats create. A live session IS the reviewer; a second one would split the
    // identity the registry exists to keep singular.
    if (await exists(recordPath)) {
      const record = await readJson(recordPath);
      assertIndependent(record.agent_id, { lead, notAgentIds });
      // TM-364: the registered reviewer is reused, never replaced. A request for another provider
      // is refused rather than answered with a second reviewer.
      const current = await resolveReviewerConfig({ consumer, home, pluginRoot, env, requested });
      invariant(current.provider === record.provider, "TOPOLOGY_REVIEWER_PROVIDER", requested
        ? `The registered reviewer ${record.agent_id} runs on ${record.provider}, not ${requested}. Ensure never creates a second reviewer: detach this one first (ao-topology role detach reviewer) to change provider.`
        : `The registered reviewer ${record.agent_id} runs on ${record.provider}, but the configured reviewer provider is ${current.provider}. Keep it with --provider ${record.provider}, or detach it first (ao-topology role detach reviewer) to change provider.`,
        { registered: record.provider, requested: current.provider });
      const agent = await resolveAgentRef(record.agent_id, agentDirs({ pluginRoot, consumer: record.consumer || consumer, home }));
      invariant(agent?.role === "reviewer", "TOPOLOGY_REVIEWER_AGENT_GONE", "Registered reviewer identity is missing or no longer a reviewer.");
      if (await session.alive(record.session, record)) {
        log(`reviewer ${record.agent_id} is live in ${record.session}`);
        return { record, agent, created: false, reattached: true, restarted: false };
      }
      if (record.managed === false || record.externally_owned === true) {
        return { record, agent, created: false, reattached: false, restarted: false, status: "dead-external" };
      }
      // Dead managed reviewer: restart the SAME identity. A fresh agent would lose the review
      // history that makes this reviewer "the" reviewer rather than "a" reviewer.
      invariant(
        agent,
        "TOPOLOGY_REVIEWER_AGENT_GONE",
        `Reviewer record names agent ${record.agent_id}, but the library no longer has that agent. Restore the agent or remove ${recordPath} and ensure again.`,
      );
      const prompt = await refreshPrompt({ agent, consumer, home, pluginRoot, env, live: false });
      invariant(prompt.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", `Reviewer prompt config is invalid.${promptErrorDetail(prompt.errors)}`, { errors: prompt.errors ?? [] });
      const opened = await session.open({ agent, consumer, home, pluginRoot, env, provider: record.provider, model: agent.model ?? null, log, existing: record });
      const { restarting: _restarting, ...unmarked } = record;
      const updated = { ...unmarked, session: opened.session ?? record.session, pane: opened.pane ?? record.pane ?? null, binding: opened.binding ?? null, updated_at: nowIso() };
      await writeJson(recordPath, updated);
      log(`restarted reviewer ${record.agent_id} in ${updated.session}`);
      return { record: updated, agent, created: false, reattached: false, restarted: true };
    }

    // No record. TM-364: before minting, look at the reviewers this repository already has. A live
    // one on another provider is refused (never two live reviewers); a live one on this provider is
    // reattached; a stopped one on this provider is relaunched as the SAME identity. Only when none
    // exists is a new reviewer minted, on the requested (or configured) and approved provider.
    const { provider, model, templateName, template, loaded } = await resolveReviewerConfig({ consumer, home, pluginRoot, env, requested });
    const library = (await listAgents(dirs)).filter(a => a.role === "reviewer" && a.id !== lead?.id && !notAgentIds.includes(a.id));
    const live = [];
    for (const candidate of library) {
      const recorded = await readJson(join(candidate._dir, "session.json")).catch(() => null);
      const seen = recorded?.agent_id === candidate.id && incarnationOf(recorded.binding) ? { session: recorded.session, pane: recorded.binding.paneId, binding: incarnationOf(recorded.binding), agent_id: candidate.id } : null;
      if (seen && await session.alive(seen.session, seen)) live.push({ agent: candidate, seen });
    }
    const other = live.find(item => item.agent.cli !== provider);
    invariant(!other, "TOPOLOGY_REVIEWER_LIVE",
      other && `Reviewer ${displayName(other.agent)} (${other.agent.id}) is live on ${other.agent.cli} in ${other.seen.session}; ensure never starts a second reviewer. Reattach it with --provider ${other.agent.cli}, or stop it first.`,
      other && { agent_id: other.agent.id, provider: other.agent.cli, requested: provider });
    const reattach = live.find(item => item.agent.cli === provider) ?? null;
    let agent = reattach?.agent ?? library.find(a => a.cli === provider) ?? null;
    const created = !agent;
    if (created) {
      agent = await createAgent(consumer, {
        role: "reviewer",
        template: templateName,
        full_name: template.name,
        cli: provider,
        model,
        // The reviewer reads the project and writes verdicts — it never implements. On CLIs with a
        // read-only mode this is what turns it on; the repo grant below stays explicit either way.
        coordinates_only: true,
        candidates: template.candidates,
        skills: template.skills,
        mcp: template.mcp,
        args: template.args,
        env: template.env,
        auto_approve: template.auto_approve,
        instructions: typeof template.instructions === "string" ? template.instructions : "",
      }, null, { pluginRoot, home, env });
      assertIndependent(agent.id, { lead, notAgentIds });

      // The composed prompt — generated identity + template + config layers — replaces the default
      // prompt.md createAgent wrote, exactly the way the lead gets its prompt.
      const composed = await composePrompt({ agent, consumer, dir: agent._dir, loaded, templateName });
      invariant(composed.ok, "TOPOLOGY_PROMPT_INVALID", "Reviewer prompt is invalid.", { errors: composed.errors });
      await writeText(join(agent._dir, "prompt.md"), composed.text);
    }

    let opened = reattach?.seen ?? null;
    if (!opened) {
      const prompt = await refreshPrompt({ agent, consumer, home, pluginRoot, env, live: false });
      invariant(prompt.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", `Reviewer prompt config is invalid.${promptErrorDetail(prompt.errors)}`, { errors: prompt.errors ?? [] });
      opened = await session.open({ agent, consumer, home, pluginRoot, env, provider, model: agent.model ?? model, log });
    }
    const record = {
      version: 1,
      repo_id: identity.id,
      consumer,
      agent_id: agent.id,
      session: opened.session,
      pane: opened.pane ?? null,
      binding: opened.binding ?? null,
      provider,
      managed: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await writeJson(recordPath, record);
    log(`${created ? "ensured" : reattach ? "reattached" : "relaunched"} reviewer ${agent.id} on ${provider} in ${record.session}`);
    return { record, agent, created, reattached: Boolean(reattach), restarted: !created && !reattach };
  });
}

/**
 * The reviewer's standing, kept as THREE separate facts: { registered, alive, responsive, record,
 * reason }. A record naming a holder, a pane incarnation running, and a nonce acknowledged are
 * different questions — a session parked on a login screen is alive and useless, and a reviewer
 * deep in a diff is alive, unacknowledged, and perfectly healthy. Callers that need one boolean
 * derive it (see reviewerAvailability); callers reporting to a human must not.
 */
export async function reviewerStanding({ consumer, env = process.env, home = homedir(), probes = null, readOnly = false }) {
  const session = { ...defaultProbes(), ...probes };
  const record = await readReviewerRecord(consumer, env, home);
  if (!record) {
    return { registered: false, alive: false, responsive: false, record: null, reason: "no reviewer is registered for this repository — run ensureReviewer first" };
  }
  if (!(await session.alive(record.session, record))) {
    return { registered: true, alive: false, responsive: false, record, reason: `reviewer session ${record.session} is not running — restart it before requesting a review` };
  }
  await listenForReviewer({ consumer, record, env });
  const responsive = probes?.responsive
    ? await probes.responsive(record)
    : await reviewerProbeReady({ consumer, record, env, home, readOnly });
  return { registered: true, alive: true, responsive, record, reason: responsive ? null : "reviewer is alive but has not acknowledged a readiness nonce" };
}

/**
 * Can this repository's reviewer actually review right now? { available, record, reason }.
 * Fail closed and say why: an unavailable reviewer is REPORTED, so the merge gate blocks on facts
 * instead of pretending a review can happen. The three facts behind the one boolean are in
 * reviewerStanding; this is the merge gate's view, where only "yes or no, and why not" matters.
 */
export async function reviewerAvailability({ consumer, env = process.env, home = homedir(), probes = null, readOnly = false }) {
  const standing = await reviewerStanding({ consumer, env, home, probes, readOnly });
  return { available: standing.registered && standing.alive && standing.responsive, record: standing.record, reason: standing.reason };
}

/**
 * Enroll an EXISTING live session as this repository's reviewer — the mirror of assignLead, which
 * reviewer.mjs has never had. It is a handshake, not a launch: the session must already be running
 * and enrollment changes nothing about it, so the record says privileges: "unchanged".
 *
 * Independence is checked here exactly as it is on every other path — assertIndependent, the same
 * function, on the same lead-and-authors inputs — because a second way in that skipped it would be
 * a second way to end up with a reviewer reviewing its own work. The provider allowlist is applied
 * for the same reason.
 */
export async function assignReviewer({ consumer, agentRef, session: existingSession = null, home = homedir(), pluginRoot = null, env = process.env, log = () => {}, notAgentIds = [], probes = null }) {
  invariant(agentRef, "TOPOLOGY_REVIEWER_AGENT_REQUIRED", "Name the agent whose live session becomes the reviewer: assignReviewer needs an agent reference.");
  const session = { ...defaultProbes(), ...probes };
  const { identity, recordPath, lockPath } = await reviewerPaths(consumer, env, home);
  const dirs = agentDirs({ pluginRoot, consumer, home });
  await mkdir(dirname(recordPath), { recursive: true });

  return withLock(lockPath, async () => {
    const agent = await requireAgent(agentRef, dirs);
    const lead = await findLead(dirs);
    assertIndependent(agent.id, { lead, notAgentIds });
    const previous = (await exists(recordPath)) ? await readJson(recordPath) : null;
    invariant(!previous || previous.agent_id === agent.id, "TOPOLOGY_REVIEWER_ALREADY_ASSIGNED", "Detach the existing reviewer before assigning a different identity.");
    const provider = agent.cli ?? null;
    assertApprovedProvider(provider, await loadConfig({ consumer, home, pluginRoot, env }));
    const name = existingSession || await recordedRoleSession({ agentsDir: dirname(agent._dir), agentId: agent.id });
    const candidate = { session: name, pane: null, agent_id: agent.id, repo_id: identity.id, consumer, provider };
    // TM-167: the named session, not the whole implicit server — and, because a session is not a server,
    // the server this agent's own session record names when the record is for this session. Without one
    // the server is implicit ($TMUX or the default socket); the readiness handshake below still gates it.
    const recorded = await readJson(join(agent._dir, "session.json")).catch(() => null);
    const recordedServer = recorded?.session === name ? recorded.binding?.serverKey : undefined;
    let binding;
    if (probes?.binding) binding = incarnationOf(await probes.binding(candidate));
    else {
      const panes = (await tmux.listServerPanes({ session: name, env, ...(recordedServer ? { tmuxServer: recordedServer } : {}) })).filter(pane => pane.sessionName === name && pane.alive !== false);
      invariant(panes.length <= 1, "TOPOLOGY_REVIEWER_PANE_AMBIGUOUS", "Session has multiple live panes; assignment needs an unambiguous agent session.");
      binding = incarnationOf(panes[0]);
    }
    invariant(binding, "TOPOLOGY_REVIEWER_BINDING_REQUIRED", "Assignment needs exact observed session binding.");
    candidate.binding = { ...binding };
    candidate.pane = binding.paneId;
    invariant(await session.alive(name, candidate), "TOPOLOGY_REVIEWER_NOT_ALIVE", "Assignment requires a live session at the exact observed incarnation; no session was changed.");
    const responsive = probes?.responsive
      ? await probes.responsive(candidate)
      : await reviewerProbeReady({ consumer, record: candidate, env, home });
    invariant(responsive && sameIncarnation(candidate.binding, binding) && await session.alive(name, candidate) && sameIncarnation(candidate.binding, binding), "TOPOLOGY_REVIEWER_HANDSHAKE_REQUIRED", "Assignment requires an acknowledged readiness nonce; the existing session was preserved.");
    await writeJson(agent._file, { ...Object.fromEntries(Object.entries(agent).filter(([key]) => !key.startsWith("_"))), role: "reviewer", auto_approve: false }); // TM-214: a reviewer is never auto-approved
    const now = nowIso();
    const record = {
      version: 1,
      repo_id: identity.id,
      consumer,
      agent_id: agent.id,
      session: name,
      pane: candidate.pane,
      binding,
      provider,
      mode: "assigned",
      managed: false,
      externally_owned: true,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };
    await writeJson(recordPath, record);
    log(`assigned reviewer ${agent.id} in ${name}`);
    return { action: "assigned", record, agent, privileges: "unchanged", preserved: { conversation: true, task: "kept", cwd: "kept" } };
  });
}

/**
 * Remove the reviewer registration. The mirror of detachLead, and the same rule: detaching is about
 * the RECORD, not the session. An externally owned pane is never killed, and a managed one only on
 * an explicit { kill: true } against an incarnation still observably ours.
 */
export async function detachReviewer({ consumer, env = process.env, home = homedir(), kill = false, probes = null, log = () => {} }) {
  const { recordPath, lockPath } = await reviewerPaths(consumer, env, home);
  if (!(await exists(recordPath))) return { action: "absent", detached: false };
  return withLock(lockPath, async () => {
    if (!(await exists(recordPath))) return { action: "absent", detached: false };
    const record = await readJson(recordPath);
    let killed = false;
    if (record.managed && !record.externally_owned && kill === true) {
      const terminate = probes?.kill ?? (async (r) => {
        invariant(r.binding && await bindingAlive(r), "TOPOLOGY_REVIEWER_OWNERSHIP_UNKNOWN", "Exact managed pane incarnation is absent or changed; refusing termination.");
        await tmux.tmux(["kill-pane", "-t", r.binding.paneId], { tmuxServer: r.binding.serverKey });
      });
      await terminate(record);
      killed = true;
    }
    await rm(recordPath, { force: true });
    log(`detached reviewer ${record.agent_id}${killed ? " and killed its managed session" : ""}`);
    return { action: "detached", detached: true, record, killed };
  });
}

/**
 * Review requests to THIS reviewer incarnation that are still in flight: no collected verdict, not
 * failed, and no terminal collection outcome. A recorded collection code is an outcome — the
 * request was withdrawn (TOPOLOGY_REVIEWER_RANGE: the range moved), or its reviewer changed — except
 * TOPOLOGY_REVIEWER_NO_VERDICT ("no verdict submitted yet"), which is still pending.
 * A request bound to an earlier incarnation can never be collected (collectReview refuses it), so it
 * cannot be orphaned by a restart either.
 */
const PENDING_COLLECTION_CODES = new Set(['TOPOLOGY_REVIEWER_NO_VERDICT']);

async function uncollectedReviewRequests(consumer, record, env, home) {
  const dir = join(await reviewerInboxRoot(consumer, env, home), 'requests');
  const names = (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'));
  const requests = await Promise.all(names.map(name => readJson(join(dir, name)).catch(() => null)));
  const open = requests.filter(request => request && request.reviewer_id === record.agent_id && !request.collected_at && request.state !== 'failed'
    && (!request.collection?.code || PENDING_COLLECTION_CODES.has(request.collection.code))
    && sameIncarnation(request.binding, record.binding));
  // TM-365: a request whose verdict is already submitted survives a restart (it is on disk, bound to
  // the incarnation it was sent to), so only a request still waiting for its verdict holds one off.
  const waiting = await Promise.all(open.map(async request => !await readSubmittedVerdict(join(dir, `${request.task}-${request.revision}.json`), request)));
  return open.filter((_, i) => waiting[i]);
}

async function assertNoReviewInFlight(consumer, record, env, home) {
  const agentId = record.agent_id;
  const pending = await uncollectedReviewRequests(consumer, record, env, home);
  invariant(!pending.length, 'TOPOLOGY_AGENT_BUSY',
    `Reviewer ${agentId} has ${pending.length} review request(s) published and not yet collected (${pending.map(r => `${r.task} nonce ${r.nonce}`).join(', ')}); restarting would orphan the verdict. Collect it first: ao-topology reviewer collect --task <id> --revision <sha>. If this reviewer can never answer it (no review_submit tool), the lead withdraws it: ao-topology reviewer withdraw --task <id> --revision <sha> --reason <text>, then restarts and requests the review again.`,
    { agent_id: agentId, pending: pending.map(r => ({ task: r.task, revision: r.revision, nonce: r.nonce, state: r.state ?? null })) });
}

/**
 * TM-302: `agent restart` for the reviewer, so a staged prompt can be applied to a live, healthy one.
 * Never mid-review: refused with TOPOLOGY_AGENT_BUSY while any request to this reviewer is uncollected
 * (checked again after the turn wait, because one can publish meanwhile), or while its turn has not
 * ended. Then the exact managed pane incarnation is ended and ensureReviewer's own dead-reviewer path
 * relaunches the SAME identity — read-only argv, freshly composed prompt promoted to the new
 * incarnation. There is no handoff and no resume: a reviewer cannot write a handoff file and keeps no
 * state between reviews, so either requested mode is a fresh read-only launch, and the result says so.
 */
export async function restartReviewer({ consumer, agentId, mode = 'handoff', home = homedir(), pluginRoot = null, env = process.env, log = () => {}, turnTimeoutMs = 600_000, probes = null }) {
  const session = {
    ...defaultProbes(),
    turnEnd: async (record) => {
      const { waitForTurnEnd } = await import('./respawn.mjs');
      const adapter = adapterFor({ cli: record.provider, model: null, args: [], skills: [] }, await loadAdapters(providerDirs({ consumer, home, env })));
      return waitForTurnEnd({ session: record.session, pane: record.binding.paneId, adapter, timeoutMs: turnTimeoutMs });
    },
    kill: async (record) => {
      invariant(await bindingAlive(record), 'TOPOLOGY_REVIEWER_OWNERSHIP_UNKNOWN', 'Exact managed pane incarnation is absent or changed; refusing termination.');
      await tmux.tmux(['kill-pane', '-t', record.binding.paneId], { tmuxServer: record.binding.serverKey });
    },
    ...probes,
  };
  const { lockPath, recordPath } = await reviewerPaths(consumer, env, home);
  const current = async () => {
    const record = await readReviewerRecord(consumer, env, home);
    invariant(record?.agent_id === agentId, 'TOPOLOGY_REVIEWER_NOT_REGISTERED', `${agentId} is not this repository's registered reviewer; nothing was restarted. Use: ao-topology reviewer ensure.`, { agent_id: agentId });
    invariant(record.managed !== false && record.externally_owned !== true, 'TOPOLOGY_REVIEWER_OWNERSHIP_UNKNOWN', `Reviewer ${agentId} runs in a session this host did not launch (assigned); restart it where it is owned.`, { agent_id: agentId });
    invariant(!restartMarked(record), 'TOPOLOGY_AGENT_BUSY', `Reviewer ${agentId} is already being restarted (since ${record.restarting?.at}).`, { agent_id: agentId, restarting: record.restarting });
    return record;
  };
  // The turn wait runs outside the lock (it can take minutes, and requestReview takes this lock).
  const first = await withLock(lockPath, async () => {
    const record = await current();
    await assertNoReviewInFlight(consumer, record, env, home);
    return { record, alive: await session.alive(record.session, record) };
  });
  if (first.alive) {
    const turn = await session.turnEnd(first.record);
    invariant(turn.ended, 'TOPOLOGY_AGENT_BUSY', `Reviewer ${agentId} is mid-turn in "${first.record.session}" and did not finish within ${turnTimeoutMs}ms; it was not interrupted. Retry later, or raise --turn-timeout.`, { agent_id: agentId, session: first.record.session, reason: turn.reason });
  }
  // Mark the record `restarting` BEFORE the last in-flight check, under the lock requestReview writes
  // its request under: a request either landed already (and refuses the restart here) or sees the
  // mark and is refused until ensureReviewer relaunches and clears it. The kill then runs unlocked.
  const before = await withLock(lockPath, async () => {
    const record = await current();
    invariant(sameIncarnation(record.binding, first.record.binding), 'TOPOLOGY_REVIEWER_OWNERSHIP_UNKNOWN', `Reviewer ${agentId} changed incarnation while its turn was waited out; nothing was restarted. Retry.`, { agent_id: agentId });
    await assertNoReviewInFlight(consumer, record, env, home);
    await writeJson(recordPath, { ...record, restarting: { at: nowIso(), pid: process.pid } });
    return { record, ended: first.alive };
  });
  const unmark = () => withLock(lockPath, async () => { const { restarting: _, ...rest } = await readReviewerRecord(consumer, env, home); await writeJson(recordPath, rest); }).catch(() => {});
  if (first.alive) await session.kill(before.record).catch(async error => { await unmark(); throw error; });
  let ensured;
  try {
    ensured = await ensureReviewer({ consumer, home, pluginRoot, env, log, probes: { alive: session.alive, open: session.open } });
  } catch (error) {
    // The old incarnation is gone either way; leave no mark that would hold requests off a dead reviewer.
    await unmark();
    throw error;
  }
  const { readPromptState } = await import('./prompts.mjs');
  log(`restarted reviewer ${agentId} read-only in ${ensured.record.session}`);
  return {
    mode: 'fresh',
    requested_mode: mode,
    fallback: 'fresh',
    fallback_reason: `a reviewer keeps no conversation state and cannot write a handoff, so ${mode} is a fresh read-only launch`,
    read_only: true,
    old_session: { session: before.record.session, incarnation: incarnationOf(before.record.binding), ended: before.ended },
    new_session: { session: ensured.record.session, incarnation: incarnationOf(ensured.record.binding) },
    relaunched: ensured.restarted,
    prompt_revision: (await readPromptState(ensured.agent._dir))?.desired_revision ?? null,
  };
}

// ── Review records ───────────────────────────────────────────────────────────
// A review is evidence about ONE exact revision. It lives in the consumer repo (not the host
// registry) because it is project history: <consumer>/.bytedesk/agent-orchestration/reviews/
// <task>/<revision>.json. A review unbound from a revision is meaningless — the author can edit
// after any sentence of it — so recordReview refuses to write one.

export async function reviewsRoot(consumer, env = process.env, home = homedir()) {
  const identity = await canonicalRepoId(consumer);
  return join(reviewersRoot(env, home), "reviews", repoKey(identity.id));
}

/** Task and revision become path segments; keep them filename-safe and collision-free enough. */
function segment(value, code, label) {
  const text = String(value ?? "").trim();
  invariant(text, code, `A review must name ${label}.`);
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text) && text !== "." && text !== "..", code, `Invalid ${label}.`);
  return text;
}

const COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/**
 * TM-257: the SERVER's view of the default branch, never a local ref (worktrees share refs, so a
 * worker could move one and shrink its own review range). Runs GitHub's compare `from...to`, where
 * null names the default branch, and resolves { status, merge_base }. Throws when gh is missing,
 * unauthenticated or offline, when the commit is not pushed (404), or when the repo is not on GitHub.
 */
export async function githubCompare(repoDir, from, to) {
  const opts = { cwd: repoDir, allowFailure: true, timeoutMs: 10_000 };
  const first = result => (result.stderr || result.stdout || `exit ${result.code}`).trim().split('\n')[0];
  // TM-263: the repository is the pinned one, so a repointed remote or gh default is refused, not followed.
  const { repo, branch } = await pinnedGithubRepo(repoDir, args => run('gh', args, opts));
  const found = await run('gh', ['api', `repos/${repo}/compare/${from ?? branch}...${to ?? branch}`, '--jq', '{status: .status, merge_base: .merge_base_commit.sha}'], opts);
  if (found.code !== 0) throw new Error(`gh compare failed: ${first(found)}`);
  return JSON.parse(found.stdout);
}

/** TM-349: the tip commit of `branch` (null = the default branch) on the pinned repository. Unlike
 * githubCompare it needs nothing of the task on the server, so an unpushed task still anchors. */
export async function githubBranchTip(repoDir, branch) {
  const opts = { cwd: repoDir, allowFailure: true, timeoutMs: 10_000 };
  const { repo, branch: fallback } = await pinnedGithubRepo(repoDir, args => run('gh', args, opts));
  const found = await run('gh', ['api', `repos/${repo}/branches/${encodeURIComponent(branch ?? fallback)}`, '--jq', '.commit.sha'], opts);
  if (found.code !== 0) throw new Error(`gh branch lookup failed: ${(found.stderr || found.stdout || `exit ${found.code}`).trim().split('\n')[0]}`);
  return found.stdout.trim();
}

/** TM-325: the base branch of every PR (any state) whose head is `head`, from the pinned repository. */
export async function githubPullBase(repoDir, head) {
  const opts = { cwd: repoDir, allowFailure: true, timeoutMs: 10_000 };
  const { repo } = await pinnedGithubRepo(repoDir, args => run('gh', args, opts));
  const found = await run('gh', ['pr', 'list', '--repo', repo, '--head', head, '--state', 'all', '--json', 'baseRefName', '--jq', '[.[].baseRefName]'], opts);
  if (found.code !== 0) throw new Error(`gh pr list failed: ${(found.stderr || found.stdout || `exit ${found.code}`).trim().split('\n')[0]}`);
  return JSON.parse(found.stdout);
}

/**
 * TM-257: the base a task's review range and integration scope start from, as { base, note }. It is
 * always DERIVED, never taken from a caller, and anchored on the server's copy of the task's
 * integration branch (TM-325: `branch`, the PR base tm dispatch recorded; null = the default branch,
 * which is also what every "default branch" below means when no integration branch is configured):
 *   - server merge-base(default, revision) is the admitted base or older: the admitted base.
 *   - it lies strictly between the admitted base and the revision (the branch merged the default
 *     branch): that merge-base. Validated locally; anything else is refused.
 *   - it is the revision itself (the task landed): the base recorded on the host-written request
 *     (or, for a pre-TM-257 request, the stored review's base when it reproduces the reviewed patch),
 *     only while it is a strict descendant of the admitted base, an ancestor of the revision, and on
 *     the server's default branch.
 *   - the server cannot answer (no gh, auth, network, unpushed, malformed): the admitted base, with
 *     a note saying why. Failing closed only ever widens the range.
 * Same-uid limit: a process running as this user can still replace gh or the remote config.
 */
export async function effectiveBase(repoDir, admittedBase, revision, { recorded = null, reviewed = null, branch = null, serverCompare = githubCompare, widen = false } = {}) {
  const git = args => run('git', ['-C', repoDir, ...args], { allowFailure: true });
  const ancestor = async (a, b) => (await git(['merge-base', '--is-ancestor', a, b])).code === 0;
  const compare = typeof serverCompare === 'function' ? serverCompare : githubCompare;
  const target = branch ? `integration branch ${branch}` : 'default branch';
  const ask = async (from, to) => {
    if (branch !== null && !INTEGRATION_BRANCH.test(branch)) throw new Error(`the integration branch ${JSON.stringify(branch)} is not a plain branch name`);
    const answer = await compare(repoDir, from, to);
    if (typeof answer?.status !== 'string' || !COMMIT_SHA.test(String(answer.merge_base))) throw new Error('the server compare answer is malformed');
    return answer;
  };
  const admitted = reason => ({ base: admittedBase, note: `The ${target} could not be read from the server (${reason}), so the range ${admittedBase}..revision starts at the task admission commit.` });
  let server;
  try { server = await ask(branch, revision); } catch (error) {
    // TM-325: an integration branch merged and deleted after landing: the base the host recorded on
    // this revision's review request (server-derived at request time), still only between admission and revision.
    if (branch !== null && recorded && recorded !== admittedBase && COMMIT_SHA.test(String(recorded)) && recorded !== revision && await ancestor(admittedBase, recorded) && await ancestor(recorded, revision))
      return { base: recorded, note: `The ${target} could not be read from the server (${error.message}), so the range starts at the effective base recorded on the review request.` };
    return admitted(error.message);
  }
  const mb = server.merge_base;
  if (mb !== revision) {
    if (mb === admittedBase) return { base: admittedBase, note: null };
    invariant((await git(['cat-file', '-e', `${mb}^{commit}`])).code === 0, 'TOPOLOGY_REVIEWER_RANGE', 'The server merge-base is not a commit in this repository.');
    // TM-349: an admission base taken from worker-writable local refs is only a floor the server can
    // lower: when the server merge-base is older, the range widens to it. It never narrows.
    if (await ancestor(mb, admittedBase)) return widen ? { base: mb, note: `The admission base ${admittedBase} came from local refs; the server ${target} merge-base ${mb} is older, so the range starts there.` } : { base: admittedBase, note: null };
    invariant(await ancestor(admittedBase, mb) && await ancestor(mb, revision), 'TOPOLOGY_REVIEWER_RANGE', `The server merge-base is not between the admitted task base and the revision; the review range cannot exclude the ${target}.`);
    return { base: mb, note: null };
  }
  // Landed: the integration (or default) branch now contains the revision, so it no longer shows what the branch merged.
  const candidate = recorded ?? reviewed?.base_revision ?? null;
  if (!candidate || candidate === admittedBase) return { base: admittedBase, note: null };
  const between = COMMIT_SHA.test(String(candidate)) && candidate !== revision && await ancestor(admittedBase, candidate) && await ancestor(candidate, revision);
  if (recorded) invariant(between, 'TOPOLOGY_REVIEWER_RANGE', 'Recorded effective review base is not between the admitted base and the revision.');
  else {
    // TM-260: reproduced with the same builder as the review range, so a binary range's manifest matches;
    // an approval stored in an older format does not reproduce, and asks for a re-review.
    const patch = between ? await reviewPatch(repoDir, candidate, revision).catch(() => null) : null;
    invariant(patch?.patch_sha256 === reviewed.patch_sha256, 'TOPOLOGY_REVIEWER_REREVIEW',
      'The landed task\'s review request predates TM-257 and its reviewed base cannot be verified against the reviewed patch; a re-review is required.');
  }
  let onDefault;
  try { onDefault = await ask(candidate, branch); } catch (error) { return admitted(error.message); }
  invariant(onDefault.status === 'ahead' || onDefault.status === 'identical', 'TOPOLOGY_REVIEWER_RANGE', `The recorded effective review base is not on the server ${target}.`);
  return { base: candidate, note: null };
}

export const INTEGRATION_BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]*(?<![./])$/;

/** Admitted and effective base for a task's range: every range and scope caller goes through here. */
export async function reviewRangeBase({ consumer, task, revision, admittedBase, serverCompare = githubCompare, serverPullBase = githubPullBase, env = process.env, home = homedir() }) {
  const taskKey = segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task'), revisionKey = segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision');
  // TM-325: the integration branch is read from the producer-owned admission record, never the mutable task
  // file; none recorded = the default branch. The task PR's base, when the server can name it, must agree.
  const managementDir = join(stateRoot(env, home), 'management', repoKey((await canonicalRepoId(consumer)).id));
  const management = await readJson(join(managementDir, `${taskKey}.json`)).catch(() => null);
  const branch = typeof management?.integration_branch === 'string' && management.integration_branch ? management.integration_branch : null;
  // TM-259: a base the server verified for this exact (task, revision) is recorded in host state and reused,
  // so supervision and eligibility sweeps make no GitHub call for it, and a rate limit or network blip
  // cannot fall back to the admitted base and flip an approved review to "does not cover the range".
  // Only a server-verified derivation is recorded; a fallback never is, so first derivation still fails closed.
  const basesPath = join(managementDir, `${taskKey}.bases.json`);
  const bases = await readJson(basesPath).catch(() => ({}));
  const hit = bases?.[revisionKey];
  if (hit && hit.admitted_base === admittedBase && hit.branch === branch && COMMIT_SHA.test(String(hit.base))
    && (hit.base === admittedBase || await isAncestor(consumer, admittedBase, hit.base) && await isAncestor(consumer, hit.base, revision)))
    return { admitted_base: admittedBase, effective_base: hit.base, range_note: null };
  if (branch && typeof management.branch === 'string' && management.branch) {
    const bases = await serverPullBase(consumer, management.branch).catch(() => []); // ponytail: unanswerable = unconfirmed, not refused
    const other = Array.isArray(bases) ? bases.find(base => base !== branch) : undefined;
    invariant(other === undefined, 'TOPOLOGY_REVIEWER_RANGE', `The task PR targets ${other}, but the task was admitted against the integration branch ${branch}; refusing the range.`);
  }
  const request = await readJson(join(await reviewerInboxRoot(consumer, env, home), 'requests', `${taskKey}-${revisionKey}.json`)).catch(() => null);
  const reviewed = request?.effective_base ? null : await readJson(join(await reviewsRoot(consumer, env, home), taskKey, `${revisionKey}.json`)).catch(() => null);
  const { base, note } = await effectiveBase(consumer, admittedBase, revision, { recorded: request?.effective_base ?? null, reviewed, branch, serverCompare, widen: management?.base_source === 'local-fallback' });
  // TM-349 x TM-259: a widened local-fallback base carries a note, so it is never pinned and is re-derived.
  // ponytail: unlocked read-modify-write; two writers record the same verified value for a revision.
  if (note === null) await writeJson(basesPath, { ...bases, [revisionKey]: { base, admitted_base: admittedBase, branch, verified_at: nowIso() } });
  return { admitted_base: admittedBase, effective_base: base, range_note: note };
}

const isAncestor = async (dir, a, b) => (await run('git', ['-C', dir, 'merge-base', '--is-ancestor', a, b], { allowFailure: true })).code === 0;

/**
 * TM-366: the tree a review reads, the worker's task worktree from the admission record. The main
 * checkout may have another branch checked out, so a file read there is not the file under review.
 * A worktree that no longer exists (cleaned up after landing) falls back to the consumer, which
 * shares the object store; one from another repository is refused.
 */
async function taskTree(management, identity, consumer) {
  const tree = typeof management?.worktree === 'string' && management.worktree ? management.worktree : null;
  if (!tree || !await exists(tree)) return consumer;
  invariant((await canonicalRepoId(tree)).id === identity.id, 'TOPOLOGY_REVIEWER_RANGE', `The admitted task worktree ${tree} is not a worktree of this repository.`, { worktree: tree });
  return tree;
}

/** Admission owns the base; caller-supplied narrower ranges never establish review scope. */
async function trustedReviewRange({ consumer, task, revision, baseRevision = null, serverCompare = githubCompare, serverPullBase = githubPullBase, env = process.env, home = homedir() }) {
  const identity = await canonicalRepoId(consumer);
  const path = join(stateRoot(env, home), 'management', repoKey(identity.id), `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}.json`);
  const management = await readJson(path).catch(() => null);
  invariant(management?.started && management.repo_id === identity.id && management.task === task && management.finish?.revision === revision, 'TOPOLOGY_REVIEWER_RANGE', 'Review requires the task admission record and its current completed revision.');
  const admitted = management.base_revision;
  invariant(COMMIT_SHA.test(String(admitted)) && (!baseRevision || baseRevision === admitted), 'TOPOLOGY_REVIEWER_RANGE', 'Review base must equal the original task admission commit.');
  const tree = await taskTree(management, identity, consumer);
  for (const [label, rev] of [['admission base', admitted], ['finished revision', revision]]) {
    const found = await run('git', ['-C', tree, 'cat-file', '-e', `${rev}^{commit}`], { allowFailure: true });
    invariant(found.code === 0, 'TOPOLOGY_REVIEWER_RANGE', `The ${label} ${rev} is not a commit in ${tree}; fetch it or re-finish the task.`);
  }
  const ancestor = await run('git', ['-C', tree, 'merge-base', '--is-ancestor', admitted, revision], { allowFailure: true });
  invariant(ancestor.code === 0, 'TOPOLOGY_REVIEWER_RANGE', 'Task admission base must be an ancestor of the finished revision.');
  const { effective_base: base, range_note } = await reviewRangeBase({ consumer, task, revision, admittedBase: admitted, serverCompare, serverPullBase, env, home });
  const { patch, patch_sha256, binaryFiles } = await reviewPatch(tree, base, revision, Number(env.AO_REVIEW_PATCH_MAX_BYTES) || REVIEW_PATCH_MAX_BYTES);
  return { base, admitted_base: admitted, effective_base: base, range_note, patch, patch_sha256, owner: management.owner, binaryFiles, worktree: tree };
}

/**
 * The reviewed patch for base..revision, and its hash: the one builder for a review range and for the
 * TM-257 legacy reproduction, so the two can never disagree about the format.
 * No --binary: a binary file's bytes never enter the buffer. Binary files are classified by CONTENT
 * (TM-260: a NUL in the first 8000 bytes, git's own test), not by the range's .gitattributes, which the
 * author controls; they are left out of the text diff and listed in a manifest of path, old/new blob
 * sha256 and size. Every other file is diffed with --text, so a `-diff` or `binary` attribute cannot turn
 * source into a manifest row. No --full-index: a text-only range hashes exactly as it did before TM-241.
 */
async function reviewPatch(tree, base, revision, maxBytes = REVIEW_PATCH_MAX_BYTES) {
  const binaryFiles = await binaryFileManifest(tree, base, revision);
  // ponytail: one exclude pathspec per binary file on the command line; batch through --pathspec-from-file if a range ever holds thousands.
  const excluded = binaryFiles.map(file => `:(exclude,literal)${file.path}`);
  const diff = await run('git', ['-C', tree, 'diff', '--no-ext-diff', '--no-textconv', '--text', base, revision, '--', ...excluded], { allowFailure: true, maxBuffer: maxBytes });
  // Node names this ERR_CHILD_PROCESS_STDIO_MAXBUFFER; the TM-241 check named a code that never occurs.
  if (/MAXBUFFER$/.test(String(diff.code))) {
    fail('TOPOLOGY_REVIEWER_RANGE', `Task diff exceeds the ${maxBytes} byte cap (at least ${Buffer.byteLength(diff.stdout)} bytes read before the cap stopped it).`);
  }
  invariant(diff.code === 0, 'TOPOLOGY_REVIEWER_RANGE', `Cannot produce the task diff: git diff exited ${diff.code}${diff.stderr?.trim() ? ` — ${diff.stderr.trim()}` : ''}.`);
  const patch = binaryFiles.length ? `${diff.stdout}${renderBinaryManifest(binaryFiles)}` : diff.stdout;
  return { patch, patch_sha256: createHash('sha256').update(patch).digest('hex'), binaryFiles };
}

/** path + old/new blob sha256 + size for every file in the range whose content is binary, in place of its bytes. */
async function binaryFileManifest(tree, base, revision) {
  const raw = await run('git', ['-C', tree, 'diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, revision, '--'], { allowFailure: true });
  invariant(raw.code === 0, 'TOPOLOGY_REVIEWER_RANGE', `Cannot list the files in the task diff: git exited ${raw.code}${raw.stderr?.trim() ? ` — ${raw.stderr.trim()}` : ''}.`);
  const fields = raw.stdout.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [oldMode, newMode, oldSha, newSha] = fields[i].replace(/^:/, '').split(' ');
    const path = fields[i + 1];
    let binary = false;
    for (const [mode, sha] of [[oldMode, oldSha], [newMode, newSha]]) {
      if (!binary && !ZERO_BLOB.test(sha) && mode !== GITLINK_MODE) binary = await readBlob(tree, sha, path, { peek: true });
    }
    if (!binary) continue;
    const old_size = await blobSize(tree, oldSha, path), new_size = await blobSize(tree, newSha, path);
    entries.push({ path, old_sha256: await blobSha256(tree, oldSha, path), new_sha256: await blobSha256(tree, newSha, path), old_size, new_size });
  }
  return entries;
}

const ZERO_BLOB = /^0+$/;
const GITLINK_MODE = '160000'; // a submodule commit, not a blob in this repository
const BINARY_PEEK_BYTES = 8000; // git's own binary heuristic looks this far for a NUL

/** An all-zero blob id means the file is absent on that side; any other unreadable blob refuses the range. */
async function blobSize(tree, sha, path) {
  if (ZERO_BLOB.test(sha)) return 0;
  const result = await run('git', ['-C', tree, 'cat-file', '-s', sha], { allowFailure: true });
  invariant(result.code === 0, 'TOPOLOGY_REVIEWER_RANGE', `Cannot read the size of file ${path} (blob ${sha}): git exited ${result.code}${result.stderr?.trim() ? ` — ${result.stderr.trim()}` : ''}.`);
  return Number(result.stdout.trim());
}

/** git's blob id is not sha256; stream the blob's bytes into the hash so no size cap applies. */
function blobSha256(tree, sha, path) {
  return ZERO_BLOB.test(sha) ? Promise.resolve(null) : readBlob(tree, sha, path);
}

/** Streams a blob: the sha256 of all its bytes, or with `peek`, whether its first 8000 bytes hold a NUL. */
async function readBlob(tree, sha, path, { peek = false } = {}) {
  try {
    return await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      let stderr = '', seen = 0, nul = false, stopped = false;
      const child = spawn('git', ['-C', tree, 'cat-file', 'blob', sha], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => {
        if (stopped) return;
        if (!peek) { hash.update(chunk); return; }
        nul ||= chunk.subarray(0, Math.max(0, BINARY_PEEK_BYTES - seen)).includes(0);
        seen += chunk.length;
        if (nul || seen >= BINARY_PEEK_BYTES) { stopped = true; child.kill(); }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => stopped || code === 0 ? resolve(peek ? nul : hash.digest('hex'))
        : reject(new Error(`git exited ${code}${stderr.trim() ? ` — ${stderr.trim()}` : ''}`)));
    });
  } catch (error) {
    const size = await blobSize(tree, sha, path).catch(() => 'unknown');
    fail('TOPOLOGY_REVIEWER_RANGE', `Cannot read file ${path} (${size} bytes, blob ${sha}): ${error.message}.`);
  }
}

function renderBinaryManifest(binaryFiles) {
  // TM-260: the path is JSON-encoded, so a newline or tab in a filename cannot forge a row.
  const rows = binaryFiles.map(f => `${JSON.stringify(f.path)}\told sha256=${f.old_sha256 ?? '(absent)'} size=${f.old_size}\tnew sha256=${f.new_sha256 ?? '(absent)'} size=${f.new_size}`);
  return `\n--- Binary files (bytes omitted; path, old and new blob sha256 and size) ---\n${rows.join('\n')}\n`;
}

/** Every path the reviewed range touches, both sides of a rename, so a finding can be held to it. */
async function reviewedFiles(consumer, base, revision) {
  const listed = await run("git", ["-C", consumer, "diff", "--name-only", "-z", "--no-renames", base, revision, "--"], { allowFailure: true });
  invariant(listed.code === 0, "TOPOLOGY_REVIEWER_RANGE", "Cannot list the files in the reviewed task diff.");
  return new Set(listed.stdout.split("\0").filter(Boolean));
}

/**
 * TM-215: a finding is {severity, file, line, claim, evidence, fix}. Anything else is refused, and
 * so is a finding about a file the reviewed diff does not touch — the review covers that range
 * and nothing else. Returns the findings reduced to exactly those six fields.
 *
 * TM-367: except a CHANGELOG.md, at any depth. "This change has no changelog entry" is a finding
 * about a file the diff does NOT touch, and refusing it (TM-490) failed the whole review.
 */
export function validateFindings(findings, files) {
  invariant(Array.isArray(findings), "TOPOLOGY_REVIEWER_FINDINGS", "Findings must be an array.");
  return findings.map((finding, index) => {
    const at = `Finding ${index + 1}`;
    invariant(finding && typeof finding === "object" && !Array.isArray(finding), "TOPOLOGY_REVIEWER_FINDINGS", `${at} must be an object with severity, file, line, claim, evidence and fix.`);
    invariant(SEVERITIES.includes(finding.severity), "TOPOLOGY_REVIEWER_FINDINGS", `${at} severity must be one of ${SEVERITIES.join(", ")}.`);
    invariant(typeof finding.file === "string" && finding.file.trim(), "TOPOLOGY_REVIEWER_FINDINGS", `${at} must name the file.`);
    const file = finding.file.trim().replace(/^\.\//, "");
    invariant(files.has(file) || basename(file) === "CHANGELOG.md", "TOPOLOGY_REVIEWER_FINDINGS", `${at} names ${file}, which is not in the reviewed diff (only a CHANGELOG.md may be named without being changed).`, { file });
    invariant(Number.isInteger(finding.line) && finding.line > 0, "TOPOLOGY_REVIEWER_FINDINGS", `${at} line must be a positive integer.`);
    const text = {};
    for (const key of FINDING_TEXT_FIELDS) {
      if (finding.severity === "note" && key !== "claim" && finding[key] === undefined) continue;
      invariant(typeof finding[key] === "string" && finding[key].trim(), "TOPOLOGY_REVIEWER_FINDINGS", `${at} must state its ${key}.`);
      text[key] = finding[key].trim();
    }
    return { severity: finding.severity, file, line: finding.line, ...text };
  });
}

/** Approval stands when no remaining finding is a blocker or major one (minor, nit and note may remain). */
export function approvable(findings) {
  return Array.isArray(findings) && findings.every(finding => finding && !BLOCKING_SEVERITIES.has(finding.severity) && SEVERITIES.includes(finding.severity));
}

/** One schema for a verdict, applied at submit and again at record: structured findings in the diff, and the severity rules. */
function checkVerdict(verdict, findings, files, unsatisfied = []) {
  const structured = validateFindings(findings, files);
  // TM-216: a packet without passing evidence for every required check is reviewed as blocked, never approved.
  invariant(verdict !== "approve" || !unsatisfied.length, "TOPOLOGY_REVIEWER_VERDICT", `The review packet lacks passing evidence for required checks (${unsatisfied.join("; ")}); approval is refused. Submit blocked and name the missing evidence.`);
  invariant(verdict !== "approve" || approvable(structured), "TOPOLOGY_REVIEWER_FINDINGS", "A blocker or major finding blocks approval; approve only with minor, nit or note findings.");
  invariant(verdict !== "changes_requested" || !approvable(structured) && structured.length > 0, "TOPOLOGY_REVIEWER_FINDINGS", "Changes requested needs at least one blocker or major finding; with only minor, nit or note findings, approve.");
  return structured;
}

/**
 * Record a review verdict. `revision` is REQUIRED — the verdict binds to exactly that commit,
 * tree, or diff identifier, and any later edit supersedes it.
 */
export async function recordReview({ consumer, task, revision, verdict, findings = [], reviewerId = null, authorAgentIds = [], env = process.env, home = homedir(), pluginRoot = null, baseRevision = null, patchHash = null, requestNonce = null, expectedBinding = null, submittedBinding = null, uncheckedChecks = [], serverCompare = githubCompare, serverPullBase = githubPullBase }) {
  const registered = await readReviewerRecord(consumer, env, home);
  invariant(registered && registered.agent_id === reviewerId && env.AO_AGENT_ID === reviewerId, "TOPOLOGY_REVIEWER_IDENTITY", "Only the designated reviewer session can record its review.");
  invariant(!expectedBinding || sameIncarnation(expectedBinding,registered.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'Reviewer incarnation changed before recording the verdict.');
  // TM-365: a submitted verdict was proved at submit time to come from this incarnation; it is
  // recorded against that incarnation even when the reviewer has restarted since.
  invariant(!submittedBinding || incarnationOf(submittedBinding), 'TOPOLOGY_REVIEWER_IDENTITY', 'A submitted verdict must name the reviewer incarnation it came from.');
  const lead = await findLead(agentDirs({ consumer: registered.consumer || consumer, home, pluginRoot }));
  assertIndependent(reviewerId, { lead, notAgentIds: authorAgentIds });
  invariant(Array.isArray(authorAgentIds) && authorAgentIds.length > 0, "TOPOLOGY_REVIEWER_AUTHORS", "Name the author identities for independent review.");
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(revision)), "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "Review requires an exact full Git commit ID.");
  const verified = await run("git", ["-C", consumer, "rev-parse", "--verify", `${revision}^{commit}`], { allowFailure: true });
  invariant(verified.code === 0 && verified.stdout.trim() === revision, "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "Review revision must exist as an exact commit in this repository.");
  invariant(Array.isArray(findings), "TOPOLOGY_REVIEWER_FINDINGS", "Findings must be an array.");
  invariant(
    revision !== undefined && revision !== null && String(revision).trim() !== "",
    "TOPOLOGY_REVIEWER_REVISION_REQUIRED",
    "A review must name the exact revision it covers. A review unbound from a revision is meaningless — the author can edit after it.",
  );
  invariant(
    VERDICTS.has(verdict),
    "TOPOLOGY_REVIEWER_VERDICT",
    `Verdict must be one of ${[...VERDICTS].join(", ")}; got ${JSON.stringify(verdict)}. A blocked review is not an approval.`,
  );
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision, serverCompare, serverPullBase, env, home });
  invariant(authorAgentIds.includes(range.owner) && (!patchHash || patchHash === range.patch_sha256), 'TOPOLOGY_REVIEWER_RANGE', 'Review authors and patch must match the admitted task range.');
  const structured = checkVerdict(verdict, findings, await reviewedFiles(range.worktree, range.base, revision), uncheckedChecks);
  const record = {
    base_revision: range.base,
    admitted_base: range.admitted_base,
    effective_base: range.effective_base,
    patch_sha256: range.patch_sha256,
    task: String(task ?? "").trim(),
    revision: String(revision).trim(),
    verdict,
    findings: structured,
    reviewer_id: reviewerId,
    binding: incarnationOf(submittedBinding ?? registered.binding),
    request_nonce: requestNonce,
    author_agent_ids: authorAgentIds,
    repo_id: registered.repo_id,
    verified_commit: revision,
    created_at: nowIso(),
  };
  invariant(record.task, "TOPOLOGY_REVIEWER_TASK", "A review must name the task it covers.");
  const dir = join(await reviewsRoot(consumer, env, home), segment(record.task, "TOPOLOGY_REVIEWER_TASK", "the task"));
  const name = segment(record.revision, "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "the exact revision");
  // TM-215 d: <revision>.json is the CURRENT record and a re-review replaces it, so every record is
  // also kept under history/. latestReview reads only the top level, so history never competes.
  await writeJson(join(dir, "history", `${name}-${Date.now()}-${randomUUID().slice(0, 8)}.json`), record);
  await writeJson(join(dir, `${name}.json`), record);
  return record;
}

/** The newest review recorded for a task, or null. */
export async function latestReview(consumer, task, env = process.env, home = homedir()) {
  const dir = join(await reviewsRoot(consumer, env, home), segment(task, "TOPOLOGY_REVIEWER_TASK", "the task"));
  const entries = await readdir(dir).catch(() => []);
  const records = [];
  for (const name of entries.filter((entry) => entry.endsWith(".json"))) {
    const record = await readFile(join(dir, name), "utf8").then(JSON.parse).catch(() => null);
    if (record) records.push(record);
  }
  if (records.length === 0) return null;
  // Newest verdict wins; a same-millisecond tie breaks on revision so the answer is deterministic.
  records.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.revision).localeCompare(String(b.revision)));
  return records[records.length - 1];
}

/**
 * Does the task's latest review satisfy the gate for `currentRevision`?
 *   satisfied          approved, of THIS exact revision, with only minor, nit or note findings left
 *   changes_requested  the reviewer asked for changes on this revision
 *   blocked            the reviewer could not review this revision (or an approval carries a
 *                      blocker/major finding, which recordReview refuses and only a hand edit makes)
 *   stale              the latest review covers a DIFFERENT revision — any edit since invalidated it
 *   missing            no review exists at all
 */
export async function currentReviewStatus(consumer, task, currentRevision, env = process.env, home = homedir()) {
  const review = await latestReview(consumer, task, env, home);
  if (!review) return { state: "missing", review: null };
  if (String(review.revision) !== String(currentRevision)) return { state: "stale", review };
  if (review.verdict === "changes_requested") return { state: "changes_requested", review };
  return { state: review.verdict === "approve" && approvable(review.findings) && review.verified_commit === currentRevision ? "satisfied" : "blocked", review };
}

/**
 * May this task's exact revision go to the merge gate on review grounds?
 * { eligible, reasons[] } — eligible requires a LIVE reviewer AND a satisfied review of THIS
 * revision. Fails closed: an unavailable reviewer blocks eligibility and the reason says so,
 * because "we think someone reviewed it" is how unreviewed code merges.
 */
export async function reviewEligibility({ consumer, task, revision, env = process.env, home = homedir(), probes = null, authorAgentIds = [], pluginRoot = null, baseRevision = null, serverCompare = githubCompare, serverPullBase = githubPullBase }) {
  const availability = await reviewerAvailability({ consumer, env, home, probes });
  const status = await currentReviewStatus(consumer, task, revision, env, home);
  const reasons = [];
  if (status.review) {
    try {
      const range = await trustedReviewRange({ consumer, task, revision, baseRevision, serverCompare, serverPullBase, env, home });
      if (status.review.base_revision !== range.base || status.review.patch_sha256 !== range.patch_sha256) reasons.push('review does not cover the complete admitted task range');
    } catch (error) { reasons.push(error.message); }
    const lead = await findLead(agentDirs({ consumer: availability.record?.consumer || consumer, home, pluginRoot }));
    if (!availability.record || status.review.reviewer_id !== availability.record.agent_id) reasons.push("review was not recorded by the designated reviewer");
    if (!sameIncarnation(status.review.binding,availability.record?.binding)) reasons.push("reviewer incarnation changed or is not recorded; obtain a new independent review");
    if (lead?.id === status.review.reviewer_id || authorAgentIds.includes(status.review.reviewer_id) || status.review.author_agent_ids?.includes(status.review.reviewer_id)) reasons.push("reviewer is not independent of the lead and authors");
    if (!Array.isArray(status.review.author_agent_ids) || status.review.author_agent_ids.length === 0 || authorAgentIds.some(id => !status.review.author_agent_ids.includes(id))) reasons.push("review does not cover the current author identities");
    if (status.review.repo_id !== availability.record?.repo_id) reasons.push("review repository identity differs");
  }
  if (!availability.available) reasons.push(`reviewer unavailable: ${availability.reason}`);
  if (status.state === "missing") reasons.push(`no review of ${task} exists — a satisfied review of revision ${revision} is required`);
  else if (status.state === "stale") reasons.push(`the latest review covers revision ${status.review.revision}, not the current revision ${revision} — a re-review is required`);
  else if (status.state !== "satisfied") reasons.push(`review of revision ${revision} is "${status.state}", not satisfied`);
  if (status.review) reasons.push(...await checkEvidenceReasons({ consumer, task, revision, env, home, pluginRoot }));
  if (status.state === 'satisfied') {
    const collected = await independentReviewStatus({ consumer, task, env, home, pluginRoot, serverCompare, serverPullBase });
    if (collected.status !== 'approved' || collected.sourceRevision !== revision) reasons.push(`independent review is not collected for this revision: ${collected.reason ?? collected.status}`);
  }
  return { eligible: reasons.length === 0, reasons, availability, status };
}

/**
 * TM-216: every required check needs evidence in this revision's (unchanged) review packet, recorded at
 * this revision with exit 0. Required checks come from the current config, not from the packet.
 */
async function checkEvidenceReasons({ consumer, task, revision, env, home, pluginRoot }) {
  const required = await requiredCheckNames({ consumer, home, pluginRoot, env });
  if (!required.length) return [];
  const request = await readJson(join(await reviewerInboxRoot(consumer, env, home), 'requests', `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision')}.json`)).catch(() => null);
  if (!request?.packet_sha256) return [`no check evidence is recorded for revision ${revision}; request the review with --checks`];
  if (await packetDigest(request.packet_path).catch(() => null) !== request.packet_sha256) return ['the review packet changed after the request'];
  const recorded = await readJson(join(request.packet_path, 'checks.json')).catch(() => null);
  return unsatisfiedChecks(required, recorded?.checks, revision).map(line => `required check ${line}`);
}

/** Historical review projection. It validates evidence without waking or probing a provider. */
export async function independentReviewStatus({ consumer, task, env = process.env, home = homedir(), pluginRoot = null, serverCompare = githubCompare, serverPullBase = githubPullBase }) {
  const result={status:'not-requested',taskId:task??null,sourceRevision:null,reviewerId:null,verdict:null,requestedAt:null,collectedAt:null,reason:null};
  if(!task) return result;
  try {
    const identity=await canonicalRepoId(consumer);
    const admitted=await readJson(join(stateRoot(env,home),'management',repoKey(identity.id),`${segment(task,'TOPOLOGY_REVIEWER_TASK','task')}.json`)).catch(()=>null);
    if(!admitted?.finish?.revision) return {...result,reason:'The task has no submitted source revision.'};
    result.sourceRevision=admitted.finish.revision;
    const key=`${segment(task,'TOPOLOGY_REVIEWER_TASK','task')}-${segment(result.sourceRevision,'TOPOLOGY_REVIEWER_REVISION_REQUIRED','revision')}`;
    const request=await readJson(join(await reviewerInboxRoot(consumer,env,home),'requests',`${key}.json`)).catch(()=>null);
    if(!request) return {...result,status:'awaiting-review',reason:'No independent review request is recorded for this revision.'};
    Object.assign(result,{reviewerId:request.reviewer_id,requestedAt:request.created_at??null,collectedAt:request.collected_at??null});
    if(request.state==='failed') return {...result,status:'failed',reason:request.failure?.reason??'The review request could not be delivered to the reviewer.'};
    if(!request.collected_at) return {...result,status:'awaiting-review',reason:request.collection?.reason??'The reviewer verdict has not been collected.'};
    const reviewer=await readReviewerRecord(consumer,env,home);
    const review=await readJson(join(await reviewsRoot(consumer,env,home),task,`${result.sourceRevision}.json`)).catch(()=>null);
    invariant(review && request.repo_id===identity.id && review.repo_id===identity.id && review.revision===result.sourceRevision && review.verified_commit===result.sourceRevision && typeof request.nonce==='string' && request.nonce.length>0 && review.request_nonce===request.nonce && request.task===task && request.revision===result.sourceRevision,
      'TOPOLOGY_REVIEWER_IDENTITY','Collected review does not match the request, repository and submitted revision.');
    invariant(reviewer?.agent_id===review.reviewer_id && review.reviewer_id===request.reviewer_id && sameIncarnation(review.binding,request.binding) && sameIncarnation(review.binding,reviewer.binding),
      'TOPOLOGY_REVIEWER_IDENTITY','Reviewer identity or incarnation changed; a new independent review is required.');
    const range=await trustedReviewRange({consumer,task,revision:result.sourceRevision,serverCompare,serverPullBase,env,home});
    invariant(review.base_revision===range.base && review.patch_sha256===range.patch_sha256 && request.patch_sha256===range.patch_sha256 && request.base_revision===range.base,
      'TOPOLOGY_REVIEWER_RANGE','The review does not cover the complete admitted source change.');
    const lead=await findLead(agentDirs({consumer:reviewer.consumer||consumer,home,pluginRoot}));
    invariant(Array.isArray(review.author_agent_ids) && review.author_agent_ids.includes(admitted.owner) && JSON.stringify(review.author_agent_ids)===JSON.stringify(request.author_agent_ids) && !review.author_agent_ids.includes(review.reviewer_id) && lead?.id!==review.reviewer_id,
      'TOPOLOGY_REVIEWER_CONFLICT','The reviewer must be independent of every recorded author and the repository lead.');
    result.verdict=review.verdict;
    const approved=review.verdict==='approve' && approvable(review.findings);
    return {...result,status:approved?'approved':review.verdict==='changes_requested'?'changes-requested':'blocked',reason:approved?'Independent review is recorded. Integration requires a separate authorized decision.':'The reviewer has not approved this revision.'};
  } catch(error) { return {...result,status:'invalid',reason:error.message}; }
}

// ── Review packet (TM-216) ───────────────────────────────────────────────────
// Beside the .patch, every request gets a packet directory the reviewer reads with its read-only
// tools: files.txt (name-status and stat), files/<path> (each changed text file at the revision),
// task.md (the task's acceptance criteria and touches), checks.json (the lead's check evidence) and
// checklist.md (required checks plus the repository's own checklist). Its digest is recorded on the
// request and verified at collection, exactly like the patch hash.

/** The repository's own review checklist, read from the consumer checkout (never the author's worktree). */
export const REVIEW_CHECKLIST_PATH = join('.bytedesk', 'agent-orchestration', 'review-checklist.md');
const LOG_TAIL_MAX = 4000;

/** Check evidence as the lead passes it: [{name, command, exit_code, revision, log_tail}]. */
export function normalizeChecks(checks) {
  if (checks == null) return [];
  invariant(Array.isArray(checks), 'TOPOLOGY_REVIEWER_CHECKS', 'Check evidence must be an array of {name, command, exit_code, revision, log_tail}.');
  return checks.map((check, index) => {
    const at = `Check ${index + 1}`;
    invariant(check && typeof check === 'object' && typeof check.name === 'string' && check.name.trim(), 'TOPOLOGY_REVIEWER_CHECKS', `${at} must name the check.`);
    invariant(Number.isInteger(check.exit_code), 'TOPOLOGY_REVIEWER_CHECKS', `${at} (${check.name}) must carry an integer exit_code.`);
    invariant(COMMIT_SHA.test(String(check.revision)), 'TOPOLOGY_REVIEWER_CHECKS', `${at} (${check.name}) must name the full commit it ran at.`);
    const command = Array.isArray(check.command) ? check.command.map(String).join(' ') : String(check.command ?? '');
    return { name: check.name.trim(), command, exit_code: check.exit_code, revision: check.revision, log_tail: String(check.log_tail ?? '').slice(-LOG_TAIL_MAX) };
  });
}

/**
 * TM-418: the check evidence a worker's finish report carries, for every automatic review request
 * (manage report, retry-review, the supervisor review sweep). Only structured runs count:
 * {name, command, exit_code, revision, log_tail}. A prose string such as "npm test passed" is a
 * description, not evidence, and is never turned into a run. unsatisfiedChecks still binds each run
 * to the reviewed revision, so a run recorded at another commit satisfies nothing.
 */
export function finishCheckEvidence(report) {
  return normalizeChecks((Array.isArray(report?.checks) ? report.checks : []).filter(check => check && typeof check === 'object'));
}

/** Names of config.management.required_checks; none configured = nothing is required. */
export async function requiredCheckNames({ consumer, home = homedir(), pluginRoot = null, env = process.env }) {
  const checks = (await loadConfig({ consumer, home, pluginRoot, env })).config.management?.required_checks;
  return Array.isArray(checks) ? checks.map(check => check?.name).filter(name => typeof name === 'string' && name) : [];
}

/**
 * The one predicate for check evidence, used by the packet, by submit/record and by eligibility: every
 * required check needs evidence recorded at exactly `revision`, and every run there exited 0.
 */
export function unsatisfiedChecks(required, checks, revision) {
  return required.flatMap(name => {
    const runs = (Array.isArray(checks) ? checks : []).filter(check => check?.name === name);
    if (!runs.length) return [`${name}: no evidence`];
    const here = runs.filter(check => check.revision === revision);
    if (!here.length) return [`${name}: evidence recorded at ${runs[0].revision}, not ${revision}`];
    const failed = here.find(check => check.exit_code !== 0);
    return failed ? [`${name}: exited ${failed.exit_code} at ${revision}`] : [];
  });
}

/** sha256 over every packet file's relative path and content hash, in sorted order. */
export async function packetDigest(dir) {
  const hash = createHash('sha256');
  const walk = async rel => {
    const entries = (await readdir(join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else hash.update(`${JSON.stringify(path)} ${createHash('sha256').update(await readFile(join(dir, path))).digest('hex')}\n`);
    }
  };
  await walk('');
  return hash.digest('hex');
}

/** The task's criteria and touches, through the repository's tm launcher when it exists (AO never imports tm). */
async function readTaskDoc({ consumer, task, env }) {
  const { taskStore } = await import('./management.mjs');
  return (await taskStore({ consumer, env })).show(task);
}

function renderTaskBrief(task, doc, reason) {
  if (!doc) return `# ${task}\n\nThe task record could not be read (${reason}). Review against the request, patch and checklist.\n`;
  const criteria = (Array.isArray(doc.acceptance) ? doc.acceptance : []).map((ac, i) => `${i + 1}. ${typeof ac === 'string' ? ac : ac?.text ?? ''}`);
  const touches = (Array.isArray(doc.touches) ? doc.touches : []).map(path => `- ${path}`);
  return [`# ${task}: ${doc.title ?? ''}`, '', String(doc.body ?? '').trim(), '', '## Acceptance criteria', ...(criteria.length ? criteria : ['(none recorded)']), '', '## Touches (approved file scope)', ...(touches.length ? touches : ['(none recorded)']), ''].join('\n');
}

async function writeReviewPacket({ dir, consumer, task, revision, range, checks, required, unsatisfied, taskDoc, env }) {
  await rm(dir, { recursive: true, force: true });
  const git = args => run('git', ['-C', range.worktree, ...args], { allowFailure: true, maxBuffer: REVIEW_PATCH_MAX_BYTES });
  const status = await git(['diff', '--name-status', '--no-renames', range.base, revision, '--']);
  const stat = await git(['diff', '--stat', '--no-renames', range.base, revision, '--']);
  invariant(status.code === 0 && stat.code === 0, 'TOPOLOGY_REVIEWER_RANGE', `Cannot list the changed files for the review packet: git exited ${status.code || stat.code}.`);
  await writeText(join(dir, 'files.txt'), `${status.stdout}\n${stat.stdout}`);
  const binary = new Set(range.binaryFiles.map(file => file.path));
  for (const path of await reviewedFiles(range.worktree, range.base, revision)) {
    if (binary.has(path)) continue; // the patch manifest records it
    const shown = await git(['show', `${revision}:${path}`]);
    if (shown.code === 0) await writeText(join(dir, 'files', path), shown.stdout); // deleted or a gitlink: nothing to show
  }
  let doc = null, reason = null;
  try { doc = await taskDoc({ consumer, task, env }); } catch (error) { reason = error.code ?? error.message; }
  await writeText(join(dir, 'task.md'), renderTaskBrief(task, doc, reason));
  await writeJson(join(dir, 'checks.json'), { revision, required, checks, unsatisfied });
  const repoChecklist = await readFile(join(consumer, REVIEW_CHECKLIST_PATH), 'utf8').catch(() => null);
  await writeText(join(dir, 'checklist.md'), [
    `# Review checklist: ${task} at ${revision}`, '',
    '## Required checks (checks.json)',
    ...(required.length ? required.map(name => `- ${name}: ${unsatisfied.find(line => line.startsWith(`${name}:`)) ? `UNSATISFIED (${unsatisfied.find(line => line.startsWith(`${name}:`))})` : 'passed at this revision'}`) : ['- none configured']),
    '', unsatisfied.length ? 'Check evidence is missing or failing, so this revision cannot be approved: submit blocked and name the missing evidence (or changes_requested with blocker/major findings).' : 'Check evidence covers every required check at this revision.',
    '', `## Repository checklist (${REVIEW_CHECKLIST_PATH})`, '',
    repoChecklist?.trim() || 'None configured.', '',
  ].join('\n'));
  return packetDigest(dir);
}

/** Queue an independent exact-revision review without requiring an idle input composer. */
export async function requestReview({ consumer, task, revision, authorAgentIds, baseRevision = null, checkEvidence = null, pluginRoot = null, taskDoc = readTaskDoc, serverCompare = githubCompare, serverPullBase = githubPullBase, env = process.env, home = homedir(), wake = wakeReviewRequest }) {
  const record = await readReviewerRecord(consumer, env, home);
  invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer; preserve the finished task until one is available.');
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(revision)), 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'Review request requires a full commit SHA.');
  invariant(Array.isArray(authorAgentIds) && authorAgentIds.length && !authorAgentIds.includes(record.agent_id), 'TOPOLOGY_REVIEWER_CONFLICT', 'Review request must identify independent authors.');
  const evidence = normalizeChecks(checkEvidence);
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision, serverCompare, serverPullBase, env, home });
  invariant(authorAgentIds.includes(range.owner), 'TOPOLOGY_REVIEWER_AUTHORS', 'Review authors must include the admitted task owner.');
  const required = await requiredCheckNames({ consumer, home, pluginRoot, env });
  const unsatisfied = unsatisfiedChecks(required, evidence, revision);
  const dir = join(await reviewerInboxRoot(consumer, env, home), 'requests');
  const key = `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${revision}`;
  const { lockPath: reviewerLock } = await reviewerPaths(consumer, env, home);
  return withLock(join(dir, `${key}.lock`), async () => {
    const path = join(dir, `${key}.json`);
    const packetPath = join(dir, `${key}.packet`);
    const packetSha = await writeReviewPacket({ dir: packetPath, consumer, task, revision, range, checks: evidence, required, unsatisfied, taskDoc, env });
    // TM-302: the record is re-read and the request written under the reviewer lock, so restartReviewer
    // either sees this request (and refuses) or this request sees its `restarting` mark (and is refused).
    const written = await withLock(reviewerLock, async () => {
    const record = await readReviewerRecord(consumer, env, home);
    invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer; preserve the finished task until one is available.');
    invariant(!restartMarked(record), 'TOPOLOGY_REVIEWER_RESTARTING',
      `Reviewer ${record.agent_id} is being restarted (since ${record.restarting?.at}); the request was not published. Request the review again once it is back: ao-topology reviewer status.`, { agent_id: record.agent_id, restarting: record.restarting ?? null });
    invariant(!authorAgentIds.includes(record.agent_id), 'TOPOLOGY_REVIEWER_CONFLICT', 'Review request must identify independent authors.');
    const prior = await readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    invariant(incarnationOf(record.binding), 'TOPOLOGY_REVIEWER_BINDING_REQUIRED', 'Review requires the exact designated reviewer incarnation.');
    if (prior && prior.state !== 'failed' && sameIncarnation(prior.binding,record.binding) && prior.base_revision === range.base && prior.patch_sha256 === range.patch_sha256 && prior.packet_sha256 === packetSha && prior.reviewer_id === record.agent_id && JSON.stringify(prior.author_agent_ids) === JSON.stringify(authorAgentIds)) return { prior: { ...prior, path } };
    const patchPath = join(dir, `${key}.patch`);
    await writeText(patchPath, range.patch);
    const request = { base_revision: range.base, admitted_base: range.admitted_base, effective_base: range.effective_base, range_note: rangeNote(range), worktree: range.worktree, patch_path: patchPath, patch_sha256: range.patch_sha256, packet_path: packetPath, packet_sha256: packetSha, checks_unsatisfied: unsatisfied, nonce: randomUUID(), task, revision, repo_id: record.repo_id, reviewer_id: record.agent_id, binding:incarnationOf(record.binding), author_agent_ids: authorAgentIds, created_at: nowIso() };
    await writeJson(path, request);
    return { record, request };
    });
    if (written.prior) return written.prior;
    const { request } = written;
    const delivery=await wake({consumer,record:written.record,request,path,env,home}).catch(error=>({rang:false,reason:error.code??error.message}));
    const published={...request,delivery:{...delivery,at:nowIso()},state:'published'};
    await writeJson(path,published);
    return { ...published, path };
  });
}

/** TM-257: tells the reviewer what the range excludes, so landed default-branch code is not judged. */
function rangeNote(range) {
  if (range.range_note) return range.range_note;
  return range.effective_base === range.admitted_base
    ? `The range ${range.admitted_base}..revision starts at the task admission commit.`
    : `The range ${range.effective_base}..revision excludes code already on the default branch at ${range.effective_base}; the task was admitted at ${range.admitted_base} and later merged the default branch. Judge only this task's own changes.`;
}

async function wakeReviewRequest({consumer,record,request,path,env,home}) {
  const loaded=await loadAdapters(providerDirs({consumer,home,env}));
  const adapter=adapterFor({cli:record.provider,model:null,args:[],skills:[]},loaded);
  return wakeForProbe({pane:record.pane??record.binding.paneId,adapter,format:composerFormat(adapter,tmuxFailureTrigger(adapter)),binding:record.binding,
    text:`AO_REVIEW_REQUEST ${request.nonce}: Read ${path} and its complete patch; its range_note says what the range excludes. Read changed files under its worktree (${request.worktree ?? consumer}), not the main checkout. Binary files are listed in a manifest section (path, old and new blob sha256, size) instead of their bytes; treat that manifest as the record of what changed for those files. Read its packet directory (${request.packet_path ?? 'none'}): files.txt, files/, task.md, checks.json and checklist.md; follow checklist.md, and if checks.json lists unsatisfied required checks, do not approve: submit blocked naming the missing evidence. Review the requested revision using read tools only, then submit your verdict with the review_submit tool (request ${request.nonce}).`});
}

const B64_PREFIX = 'b64:';

/**
 * TM-195. The one decoder for a reviewer response, whichever path carried it.
 *
 * `b64:<base64 of the JSON>` is the envelope. Bare JSON on a pane breaks two ways that no rejoin
 * can repair: a quote the reviewer left unescaped is invalid JSON at the source, and a space that
 * fell on the TUI's wrap column is indistinguishable from padding. Base64 has no quote and no
 * space, so the pane cannot corrupt it, and anything that does not decode is refused.
 *
 * Bare JSON is still read, so a reviewer launched under the old instruction keeps working until it
 * is relaunched with the new one. Either way the result must be {verdict, findings: [...]}: a
 * response without a findings array used to record as an approval with no findings.
 */
export function decodeReviewPayload(text) {
  const raw = String(text ?? '').trim();
  let response;
  if (raw.startsWith(B64_PREFIX)) {
    const data = raw.slice(B64_PREFIX.length).replace(/\s+/g, '');
    invariant(/^[A-Za-z0-9+/]+={0,2}$/.test(data), 'TOPOLOGY_REVIEWER_RESPONSE', 'Review response base64 is empty or has characters outside the base64 alphabet.');
    const bytes = Buffer.from(data, 'base64');
    invariant(bytes.toString('base64').replace(/=+$/, '') === data.replace(/=+$/, ''), 'TOPOLOGY_REVIEWER_RESPONSE', 'Review response base64 does not decode cleanly; it was truncated or mistyped.');
    try { response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('TOPOLOGY_REVIEWER_RESPONSE', 'Review response base64 does not decode to UTF-8 JSON.'); }
  } else {
    try { response = JSON.parse(raw); } catch { fail('TOPOLOGY_REVIEWER_RESPONSE', 'Review response must be JSON.'); }
  }
  invariant(response && typeof response === 'object' && !Array.isArray(response), 'TOPOLOGY_REVIEWER_RESPONSE', 'Review response must be a JSON object.');
  invariant(VERDICTS.has(response.verdict), 'TOPOLOGY_REVIEWER_VERDICT', `Verdict must be one of ${[...VERDICTS].join(', ')}; got ${JSON.stringify(response.verdict)}.`);
  invariant(Array.isArray(response.findings), 'TOPOLOGY_REVIEWER_FINDINGS', 'Review response must carry a findings array, empty when there are none.');
  return response;
}

// ── Verdict submission (TM-365) ──────────────────────────────────────────────
// The verdict is a JSON record the reviewer SUBMITS, never text the host reads off its pane. Screen
// scraping was the most common reviewer failure (TOPOLOGY_REVIEWER_RESPONSE: wrapped rows, eaten
// backslashes, a verdict that scrolled away or died with its pane). The restricted reviewer has no
// shell and no Write tool, so its one way out is the `review_submit` MCP tool that buildReviewerArgv
// grants it (topology/review-mcp.mjs); a reviewer with a shell may run `ao-topology review submit`.
// Both call submitReviewVerdict, which writes <inbox>/verdicts/<task>-<revision>.json (durable on
// disk, so neither a collector restart nor a reviewer restart loses it) and mirrors it to the NATS
// ORCH_REVIEWS object store when NATS is live. collectReview reads that record and nothing else.

/** The request file for a submit target: its nonce, or its `<task>-<revision>` key. */
async function findReviewRequest(consumer, id, env, home) {
  const text = String(id ?? '').trim();
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text), 'TOPOLOGY_REVIEWER_NONCE', 'Name the review request by its nonce (or <task>-<revision>).');
  const dir = join(await reviewerInboxRoot(consumer, env, home), 'requests');
  const direct = await readJson(join(dir, `${text}.json`)).catch(() => null);
  if (direct?.nonce) return { request: direct, path: join(dir, `${text}.json`) };
  for (const name of (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'))) {
    const request = await readJson(join(dir, name)).catch(() => null);
    if (request?.nonce === text) return { request, path: join(dir, name) };
  }
  fail('TOPOLOGY_REVIEWER_NONCE', `No review request ${text} exists for this repository.`, { request: text });
}

const verdictPath = (requestPath) => join(dirname(dirname(requestPath)), 'verdicts', basename(requestPath));

/**
 * The designated reviewer submits its verdict for one request. Checked here, so a reviewer learns
 * at once what is wrong and can submit again: the caller is the request's reviewer at the request's
 * incarnation, the request is still open, and the verdict and findings pass the same schema
 * recordReview applies. Resubmitting before collection replaces the earlier verdict.
 */
export async function submitReviewVerdict({ consumer, request: id, verdict, findings = [], env = process.env, home = homedir(), transport = null, alive = bindingAlive }) {
  const { request, path } = await findReviewRequest(consumer, id, env, home);
  return withLock(path.replace(/\.json$/, '.lock'), async () => {
    const current = await readJson(path);
    const record = await readReviewerRecord(consumer, env, home);
    invariant(record && env.AO_AGENT_ID === record.agent_id && current.reviewer_id === record.agent_id && sameIncarnation(current.binding, record.binding) && await alive(record),
      'TOPOLOGY_REVIEWER_IDENTITY', 'Only the designated reviewer, at the incarnation the request was sent to, can submit its verdict.');
    invariant(current.nonce === request.nonce && !current.collected_at, 'TOPOLOGY_REVIEWER_RESPONSE', 'This review request was already collected; its verdict cannot change.');
    invariant(current.state !== 'failed', 'TOPOLOGY_REVIEWER_REQUEST_FAILED', `This review request failed (${current.failure?.reason ?? 'no reason recorded'}); the lead must request the review again.`);
    invariant(VERDICTS.has(verdict), 'TOPOLOGY_REVIEWER_VERDICT', `Verdict must be one of ${[...VERDICTS].join(', ')}; got ${JSON.stringify(verdict)}.`);
    const structured = checkVerdict(verdict, findings, await reviewedFiles(current.worktree && await exists(current.worktree) ? current.worktree : consumer, current.base_revision, current.revision), current.checks_unsatisfied ?? []);
    const submitted = { nonce: current.nonce, task: current.task, revision: current.revision, reviewer_id: record.agent_id, binding: incarnationOf(current.binding), verdict, findings: structured, submitted_at: nowIso() };
    submitted.mirror = await mirrorVerdict({ consumer, record, submitted, env, transport });
    await writeJson(verdictPath(path), submitted);
    return { ok: true, nonce: submitted.nonce, task: submitted.task, revision: submitted.revision, verdict, findings: structured.length, mirror: submitted.mirror };
  });
}

/** Best effort: the ORCH_REVIEWS object store copy, and the verdict subject `review await` listens on. */
async function mirrorVerdict({ consumer, record, submitted, env, transport }) {
  try {
    const { resolveTransport, publishReviewVerdict } = await import('./orch-transport.mjs');
    const active = transport ?? await resolveTransport({ env });
    if (active.kind !== 'nats') return null;
    const stored = await active.putReview({ bytes: JSON.stringify(submitted) });
    const body = JSON.stringify({ verdict: submitted.verdict, findings: submitted.findings });
    await publishReviewVerdict({ repo: repoKey(record.repo_id || (await canonicalRepoId(consumer)).id), nonce: submitted.nonce, verdict: body, transport: active, env }).catch(() => {});
    return { bucket: stored.bucket, name: stored.name };
  } catch { return null; }
}

/** The submitted verdict for a request, or null when the reviewer has not submitted one. */
async function readSubmittedVerdict(requestPath, request) {
  const submitted = await readJson(verdictPath(requestPath)).catch(() => null);
  return submitted?.nonce === request.nonce ? submitted : null;
}

/** A response the reviewer DID give that collection refuses. Not "no answer yet", not a changed identity. */
const REFUSED_RESPONSE_CODES = new Set(['TOPOLOGY_REVIEWER_RESPONSE', 'TOPOLOGY_REVIEWER_FINDINGS', 'TOPOLOGY_REVIEWER_VERDICT']);

/**
 * Collect the verdict the reviewer submitted for this request and record it. No verdict yet is
 * TOPOLOGY_REVIEWER_NO_VERDICT, which leaves the request pending. A verdict submitted before the
 * reviewer restarted is still collected: the submit proved it came from the incarnation the request
 * was sent to, so a restart does not orphan it. (Eligibility still asks the CURRENT incarnation for
 * approval, so an approve collected that way needs a re-review; changes_requested reaches the author.)
 */
export async function collectReview({ consumer, task, revision, env = process.env, home = homedir(), pluginRoot = null, deliver = sendStandingMessage, lead = readLeadRegistration, serverCompare = githubCompare, serverPullBase = githubPullBase }) {
  const path = join(await reviewerInboxRoot(consumer, env, home), 'requests', `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision')}.json`);
  return withLock(path.replace(/\.json$/,'.lock'),async()=>{
  const record = await readReviewerRecord(consumer, env, home);
  invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer.');
  const request = await readJson(path);
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision: request.admitted_base ?? request.base_revision, serverCompare, serverPullBase, env, home });
  invariant(request.patch_sha256 === range.patch_sha256, "TOPOLOGY_REVIEWER_RANGE", "Review request no longer covers the admitted task range.");
  invariant(request.reviewer_id === record.agent_id && request.repo_id === record.repo_id && request.revision === revision, 'TOPOLOGY_REVIEWER_IDENTITY', 'Request belongs to a different reviewer or revision.');
  if(request.collected_at) {
    const prior=await latestReview(consumer,task,env,home);
    invariant(prior?.revision===revision && prior.request_nonce===request.nonce && sameIncarnation(prior.binding,request.binding), 'TOPOLOGY_REVIEWER_RESPONSE', 'Collected review evidence is missing or differs from this request.');
    return prior;
  }
  // TM-220: a failed request is final; collecting it again would escalate a second time.
  invariant(request.state !== 'failed', 'TOPOLOGY_REVIEWER_REQUEST_FAILED', `This review request already failed (${request.failure?.reason ?? 'no reason recorded'}); request the review again for a fresh nonce.`);
  invariant(createHash('sha256').update(await readFile(request.patch_path)).digest('hex') === request.patch_sha256, 'TOPOLOGY_REVIEWER_RESPONSE', 'Review patch changed after the request.');
  // TM-216: the packet is evidence the reviewer read; a changed one is refused like a changed patch.
  invariant(!request.packet_sha256 || await packetDigest(request.packet_path).catch(() => null) === request.packet_sha256, 'TOPOLOGY_REVIEWER_RESPONSE', 'Review packet changed after the request.');
  const submitted = await readSubmittedVerdict(path, request);
  invariant(submitted || sameIncarnation(request.binding, record.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'Reviewer incarnation changed after the request; queue a new independent review.');
  invariant(submitted, 'TOPOLOGY_REVIEWER_NO_VERDICT', `No verdict has been submitted for review request ${request.nonce} yet. The reviewer submits it with its review_submit tool (or: ao-topology review submit ${request.nonce} --verdict <verdict> --findings @file.json).`, { nonce: request.nonce });
  let review;
  try {
    invariant(submitted.reviewer_id === request.reviewer_id && sameIncarnation(submitted.binding, request.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'The submitted verdict is not bound to the reviewer incarnation the request was sent to.');
    review = await recordReview({ consumer, task, revision, baseRevision: request.admitted_base ?? request.base_revision, patchHash: request.patch_sha256, requestNonce:request.nonce, submittedBinding: request.binding, uncheckedChecks: request.checks_unsatisfied ?? [], verdict: submitted.verdict, findings: submitted.findings, reviewerId: record.agent_id, authorAgentIds: request.author_agent_ids, env: { ...env, AO_AGENT_ID: record.agent_id }, home, pluginRoot, serverCompare, serverPullBase });
  } catch (error) {
    // TM-215 review 1: a refused verdict fails its request once, the lead is told, and requestReview
    // mints a fresh nonce. submitReviewVerdict applies the same schema first, so this is rare.
    if (REFUSED_RESPONSE_CODES.has(error.code)) {
      const failed = { ...request, state: 'failed', failure: { at: nowIso(), code: error.code, reason: `The reviewer's verdict was refused: ${error.message}` } };
      failed.escalation = await escalateFailedReview({ consumer, request: failed, env, home, deliver, lead });
      await writeJson(path, failed);
    }
    throw error;
  }
  await writeJson(path, { ...request, collected_at: nowIso(), verdict: review.verdict,state:'collected' });
  return review;
  });
}

/**
 * TM-525: the lead withdraws an uncollected review request, e.g. one sent to a reviewer that has no
 * review_submit tool and so can never answer it. The request becomes `failed` with code
 * TOPOLOGY_REVIEWER_WITHDRAWN, so every path that already treats a failed request as final applies:
 * it no longer holds off `agent restart`, its verdict can never be submitted or collected, and a
 * re-request of the same revision mints a fresh nonce for the current incarnation. The withdraw is
 * recorded in the task's management events before the request changes. `requireLead` and `store`
 * are injected by tests.
 */
export async function withdrawReview({ consumer, task, revision, reason, env = process.env, home = homedir(), requireLead = null, store = null, proof = {} }) {
  invariant(typeof reason === 'string' && reason.trim(), 'TOPOLOGY_REVIEWER_WITHDRAW', 'Pass --reason <text>: a withdraw is recorded with why.');
  const { bindingAgentId, requireLeadCaller } = await import('./delegation.mjs');
  const lookup = { consumer, env, home, ...proof };
  const named = env.AO_AGENT_ID || await bindingAgentId(lookup).catch(() => null);
  const lead = await (requireLead || requireLeadCaller)({ ...lookup, env: named ? { ...env, AO_AGENT_ID: named } : env });
  invariant(lead, 'TOPOLOGY_REVIEWER_WITHDRAW', `Only this repository's proven lead may withdraw a review request; this session is ${named ?? 'unidentified'}. Nothing was changed.`);
  const path = join(await reviewerInboxRoot(consumer, env, home), 'requests', `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision')}.json`);
  return withLock(path.replace(/\.json$/, '.lock'), async () => {
    const request = await readJson(path).catch(error => { if (error.code === 'ENOENT') fail('TOPOLOGY_REVIEWER_NONCE', `No review request exists for ${task} at ${revision}.`, { task, revision }); throw error; });
    invariant(!request.collected_at, 'TOPOLOGY_REVIEWER_RESPONSE', `Review request ${request.nonce} was already collected; a recorded review cannot be withdrawn.`);
    invariant(request.state !== 'failed', 'TOPOLOGY_REVIEWER_REQUEST_FAILED', `Review request ${request.nonce} already failed (${request.failure?.reason ?? 'no reason recorded'}); request the review again.`);
    // A verdict the reviewer did submit is collected, never discarded: a withdraw must not hide one.
    invariant(!await readSubmittedVerdict(path, request), 'TOPOLOGY_REVIEWER_RESPONSE', `The reviewer already submitted a verdict for request ${request.nonce}; collect it: ao-topology reviewer collect --task ${task} --revision ${revision}.`);
    const withdrawn = { at: nowIso(), by: lead, reason: reason.trim() };
    const { recordTaskEvent } = await import('./management.mjs');
    await recordTaskEvent({ consumer, task, env, home, ...(store ? { store } : {}) }, 'review-withdrawn', { revision, nonce: request.nonce, reviewer_id: request.reviewer_id, by: lead, reason: withdrawn.reason });
    const next = { ...request, state: 'failed', withdrawn, failure: { at: withdrawn.at, code: 'TOPOLOGY_REVIEWER_WITHDRAWN', reason: `Withdrawn by the lead ${lead}: ${withdrawn.reason}` } };
    await writeJson(path, next);
    return { ok: true, withdrawn: true, task, revision, nonce: request.nonce, reviewer_id: request.reviewer_id, by: lead, reason: withdrawn.reason,
      next: [`ao-topology agent restart ${request.reviewer_id} --mode handoff`, `ao-topology reviewer request --task ${task} --revision ${revision} --author <id>`] };
  });
}

/** TM-525: this repository's review requests still waiting on the registered reviewer, for doctor's advice. */
export async function pendingReviewRequests(consumer, env = process.env, home = homedir()) {
  const record = await readReviewerRecord(consumer, env, home);
  return record ? uncollectedReviewRequests(consumer, record, env, home) : [];
}

/** A repository tick collects responses automatically; no provider turn or
 * integration decision is inferred from a worker exit or a readiness signal. */
const reviewQueueCache = new Map();

export async function collectPendingReviews(options) {
  const dir=join(await reviewerInboxRoot(options.consumer,options.env,options.home),'requests');
  const results=[];
  const names=(await readdir(dir).catch(()=>[])).filter(name=>name.endsWith('.json')).sort();
  const cache=reviewQueueCache.get(dir)??{files:new Map(),cursor:''};
  reviewQueueCache.set(dir,cache);
  const currentNames=new Set(names);
  for(const name of cache.files.keys()) if(!currentNames.has(name)) cache.files.delete(name);
  const pending=[];
  for(const name of names) {
    const path=join(dir,name),info=await stat(path).catch(()=>null);
    if(!info) continue;
    const signature=`${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    let entry=cache.files.get(name);
    if(entry?.signature!==signature) {
      entry={signature,request:await readJson(path).catch(()=>null)};
      cache.files.set(name,entry);
    }
    if(entry.request && !entry.request.collected_at && entry.request.state!=='failed') pending.push({name,request:entry.request});
  }
  // Completed history never consumes the batch. Rotate among pending requests so
  // even more than one batch of unanswered reviews cannot starve newer work.
  const start=pending.findIndex(entry=>entry.name>cache.cursor);
  const batch=[...pending.slice(start<0?0:start),...pending.slice(0,start<0?0:start)].slice(0,100);
  for(const {name,request} of batch) {
    const path=join(dir,name);
    cache.cursor=name;
    try {
      const review=await collectReview({...options,task:request.task,revision:request.revision});
      results.push({task:request.task,revision:request.revision,state:'collected',verdict:review.verdict});
    } catch(error) {
      const collection={at:nowIso(),code:error.code??'TOPOLOGY_REVIEW_COLLECTION_FAILED',reason:error.message};
      let state='awaiting-review';
      await withLock(path.replace(/\.json$/,'.lock'),async()=>{
      const current=await readJson(path).catch(()=>null);
      if(!current || current.nonce!==request.nonce || current.collected_at) return;
      Object.assign(request,current);
      if(request.state==='failed') { state='failed'; await writeJson(path,{...request,collection}); return; }
      if(error.code==='TOPOLOGY_REVIEWER_NO_VERDICT' && !request.delivery?.rang && (request.delivery?.attempts??0)<MAX_REVIEW_WAKES && Date.now()-Date.parse(request.delivery?.at??0)>=10_000) {
        const record=await readReviewerRecord(options.consumer,options.env,options.home);
        if(record && sameIncarnation(record.binding,request.binding)) {
          const delivery=await wakeReviewRequest({...options,record,request,path}).catch(error=>({rang:false,reason:error.code??error.message}));
          request.delivery={...delivery,attempts:(request.delivery?.attempts??0)+1,at:nowIso()};
        }
      }
      // TM-215 f: a request no wake could deliver used to stay awaiting-review forever. After the
      // last attempt it is failed, the lead is told once, and requestReview mints a fresh one.
      if(error.code==='TOPOLOGY_REVIEWER_NO_VERDICT' && !request.delivery?.rang && (request.delivery?.attempts??0)>=MAX_REVIEW_WAKES) {
        state='failed';
        request.state='failed';
        request.failure={at:nowIso(),reason:`The review request could not be delivered to the reviewer after ${MAX_REVIEW_WAKES} wake attempts (${request.delivery?.reason??'no reason reported'}).`};
        request.escalation=await escalateFailedReview({...options,request});
      }
      // Retain publication and collection failures separately. Never change a
      // verdict or mark an unparsed response as an approval.
      await writeJson(path,{...request,collection});
      });
      results.push({task:request.task,revision:request.revision,state,...collection});
    }
  }
  return results;
}

/** Tell the repository lead, through its standing mailbox, that a review request failed. Best effort. */
async function escalateFailedReview({ consumer, request, env = process.env, home = homedir(), deliver = sendStandingMessage, lead = readLeadRegistration }) {
  const registration = await lead({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  if (!leadId) return { status: 'skipped', reason: 'no lead is registered for this repository' };
  const body = [
    `REVIEW REQUEST FAILED: ${request.task} at ${request.revision}.`,
    '',
    request.failure.reason,
    'No verdict was recorded and nothing was approved. Check the reviewer session and its prompt, then request the review again;',
    'a new request replaces this failed one.',
  ].join('\n');
  // TM-314: sent as the supervisor (`v2` id); with no sender it was held permanently as `source_identity_required`.
  return deliver({ id: createHash('sha256').update(`review-failed:v2:${request.nonce}`).digest('hex').slice(0, 32), consumer, fromProject: consumer, from: SUPERVISOR_SENDER, to: leadId,
    subject: `review request failed: ${request.task}`, body, task: request.task, provenance: { source: 'ao-topology review' } }, { env, home })
    .then(sent => ({ status: sent?.status ?? 'sent', to: leadId, message_id: sent?.envelope?.id ?? null }))
    .catch(error => ({ status: 'failed', to: leadId, reason: error?.code ?? String(error) }));
}
