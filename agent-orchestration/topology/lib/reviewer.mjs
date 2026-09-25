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
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { agentDirs, createAgent, findLead, requireAgent, resolveAgentRef } from "./agents.mjs";
import { readLeadRegistration } from "./lead.mjs";
import { sendStandingMessage } from "./standing-mailbox.mjs";
import { findTemplate, loadConfig } from "./config.mjs";
import { displayName } from "./identity.mjs";
import { composerFormat, LATE_ACK_GRACE_MS, wakeForProbe } from "./delivery.mjs";
import { openRoleSession, roleSessionName, tmuxFailureTrigger } from "./launch.mjs";
import { withLock } from "./lockfile.mjs";
import { composePrompt, promptErrorDetail } from "./prompts.mjs";
import { refreshPrompt, protocolOutputLine } from "./prompt-lifecycle.mjs";
import { incarnationOf, sameIncarnation } from "./incarnation.mjs";
import { adapterFor, buildArgv, loadAdapters, providerDirs } from "./providers.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import * as tmux from "./tmux.mjs";
import { AO_HOME, exists, fail, invariant, nowIso, readJson, run, sleep, writeJson, writeText } from "./util.mjs";

const REGISTRY_KIND = "reviewers";
const DEFAULT_REVIEWER_PROVIDERS = ["claude", "codex"];
const DEFAULT_TEMPLATE = "reviewer-default";
const VERDICTS = new Set(["approve", "changes_requested", "blocked"]);
// TM-215: findings are structured. Only blocker and major findings stop an approval; minor, nit and
// note findings ride along with it. A note is informational and needs no action, so it may omit
// evidence and fix; it still names a file and line in the diff.
const SEVERITIES = ["blocker", "major", "minor", "nit", "note"];
const BLOCKING_SEVERITIES = new Set(["blocker", "major"]);
const FINDING_TEXT_FIELDS = ["claim", "evidence", "fix"];
/** Wake attempts after publication before an undeliverable request is marked failed (TM-215 f). */
const MAX_REVIEW_WAKES = 5;
/** Scrollback captured when collecting a verdict; the reviewer may keep printing after it (TM-215 a). */
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
  return `You are ${displayName(agent)} (id "${agent.id}", role: reviewer), the standing code reviewer for ${consumer}. Read ${join(agent._dir, 'prompt.md')} and follow it. At safe boundaries read unexpired probes in ${join(inboxRoot, 'probes')} for your agent id and emit exactly AO_REVIEWER_READY followed by a space and the nonce on its own line; the host records the response. Read requests under ${join(inboxRoot, 'requests')}; review the complete base_revision..revision patch, never only the final commit, then emit one line AO_REVIEW followed by a space, the request nonce, a space, and JSON {"verdict":"approve|changes_requested|blocked","findings":[{"severity":"blocker|major|minor|nit|note","file":"<path changed in the patch>","line":<positive integer>,"claim":"...","evidence":"...","fix":"..."}]}; a note may omit evidence and fix. Approve only when every finding is minor, nit or note; changes_requested needs at least one blocker or major finding. Never execute code or change files.`;
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
 * The real session opener, used when no probes are injected. Mirrors the CLI's `session open`.
 * `openRoleSession` (TM-242) launches the pane's actual cwd at the repo root — not the agent's own
 * directory — because that cwd is what Claude Code resolves `CLAUDE_PROJECT_DIR` from when it runs
 * a project hook, and an exported/inherited value is not honoured. The agent's own directory (still
 * the agent's own directory the whole library keys by) stays reachable because it lives inside the
 * repo tree, and is carried forward as `AO_AGENT_DIR` for anything that specifically needs it. The
 * reviewer's coordinates_only flag keeps the grant read-only on CLIs that can express it. Review
 * verdicts go back to the author; the reviewer never writes the project.
 */
async function defaultOpen({ agent, consumer, home, pluginRoot, provider, model, log, env = process.env }) {
  const adapters = await loadAdapters(providerDirs({ pluginRoot, consumer, home }));
  const adapter = adapterFor({ ...agent, cli: provider, model }, adapters);
  const session = roleSessionName(agent.id);
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
    role: "reviewer",
    log,
  });
}

/** Restricted Claude explicitly removes code execution and ambient MCP/configs. Custom
 * agent args, environment and MCP would undo that trust boundary and are refused.
 * Other providers need an independently verified equivalent, never a silent downgrade.
 */
export function buildReviewerArgv(adapter, agent, vars, { consumer, model = null, inboxRoot = null }) {
  invariant(!(agent.args?.length) && !(agent.mcp?.length) && !Object.keys(agent.env || {}).length && !agent.command, "TOPOLOGY_REVIEWER_READ_ONLY", "Reviewer custom args, environment, command and MCP are not allowed to override the read-only policy.");
  invariant(adapter.id === "claude", "TOPOLOGY_REVIEWER_READ_ONLY", "This adapter has no verified reviewer isolation covering ambient MCP. Configure a supported restricted reviewer; no provider substitution was made.");
  /**
   * TM-150. WHAT ENFORCES READ-ONLY HERE IS `--restricted` AND `--safe-mode`, NOT THIS LIST.
   *
   * Measured, because the list looks like the enforcement and is not: an agent given
   * `--disallowed-tools Write,Edit` refused to Write and then CREATED THE FILE WITH BASH. The deny
   * list removes named tools; it does not remove the shell. `--restricted`/`--safe-mode` remove
   * Bash entirely, and that is why a reviewer under this argv answers "no file-writing tool is
   * available to me (no Write/Edit/Bash…)".
   *
   * So do not "simplify" this by dropping those two flags and trusting the deny list plus
   * TOPOLOGY_REVIEWER_READ_ONLY. Isolation would fail SILENTLY — every test still green, the
   * invariant still passing — which is precisely what the "never a silent downgrade" note above
   * fears, arriving through the door that note is not watching.
   *
   * `MultiEdit` was removed from the list: the CLI reports "Permission deny rule 'MultiEdit'
   * matches no known tool", and a rule that matches nothing is noise in the one place a reader
   * most needs to trust what they see.
   */
  const restricted = { ...adapter, args: ["--restricted", "--safe-mode", "--strict-mcp-config", "--disallowed-tools", "Write,Edit,NotebookEdit,Agent,Task", "--permission-prompts", "none"], coordinator_args: [], auto_approve_args: [] };
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
 * its own pane, which is why this needs no shell and works under `--restricted --safe-mode`.
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

export async function reviewerProbeReady({ consumer, record, env = process.env, home = homedir(), timeoutMs = PROBE_TIMEOUT_MS, onProbe = null, output = reviewerOutput, wake = defaultWake, adapters = null, alive = bindingAlive, readOnly = false }) {
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
  await writeJson(path, probe);
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
      await writeJson(path, probe).catch(() => {});
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
async function resolveReviewerConfig({ consumer, home, pluginRoot, env }) {
  const loaded = await loadConfig({ consumer, home, pluginRoot, env });
  invariant(loaded.errors.length === 0, "TOPOLOGY_REVIEWER_CONFIG", "Reviewer config is invalid.", { errors: loaded.errors });
  const templateName = loaded.config.reviewer?.template ?? DEFAULT_TEMPLATE;
  const found = findTemplate(loaded.layers, templateName);
  invariant(
    found,
    "TOPOLOGY_REVIEWER_TEMPLATE",
    `No reviewer template named "${templateName}" in any config layer. Declare one (the plugin defaults ship "reviewer-default") or set reviewer.template to a template that exists.`,
  );
  const provider = loaded.config.reviewer?.provider ?? found.template.cli ?? null;
  const model = loaded.config.reviewer?.model ?? found.template.model ?? null;
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
export async function ensureReviewer({ consumer, home = homedir(), pluginRoot = null, env = process.env, log = () => {}, notAgentIds = [], probes = null }) {
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
      const current = await resolveReviewerConfig({ consumer, home, pluginRoot, env });
      invariant(current.provider === record.provider, "TOPOLOGY_REVIEWER_PROVIDER", "Registered reviewer provider differs from current policy; reconcile explicitly.");
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
      const updated = { ...record, session: opened.session ?? record.session, pane: opened.pane ?? record.pane ?? null, binding: opened.binding ?? null, updated_at: nowIso() };
      await writeJson(recordPath, updated);
      log(`restarted reviewer ${record.agent_id} in ${updated.session}`);
      return { record: updated, agent, created: false, reattached: false, restarted: true };
    }

    // First ensure for this repository: mint the reviewer from the configured template, on the
    // configured (and approved) provider.
    const { provider, model, templateName, template, loaded } = await resolveReviewerConfig({ consumer, home, pluginRoot, env });
    const agent = await createAgent(consumer, {
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

    const prompt = await refreshPrompt({ agent, consumer, home, pluginRoot, env, live: false });
    invariant(prompt.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", `Reviewer prompt config is invalid.${promptErrorDetail(prompt.errors)}`, { errors: prompt.errors ?? [] });
    const opened = await session.open({ agent, consumer, home, pluginRoot, env, provider, model, log });
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
    log(`ensured reviewer ${agent.id} on ${provider} in ${record.session}`);
    return { record, agent, created: true, reattached: false, restarted: false };
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
    const name = existingSession || roleSessionName(agent.id);
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

/** Admission owns the base; caller-supplied narrower ranges never establish review scope. */
async function trustedReviewRange({ consumer, task, revision, baseRevision = null, env = process.env, home = homedir() }) {
  const identity = await canonicalRepoId(consumer);
  const path = join(stateRoot(env, home), 'management', repoKey(identity.id), `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}.json`);
  const management = await readJson(path).catch(() => null);
  invariant(management?.started && management.repo_id === identity.id && management.task === task && management.finish?.revision === revision, 'TOPOLOGY_REVIEWER_RANGE', 'Review requires the task admission record and its current completed revision.');
  const base = management.base_revision;
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(base)) && (!baseRevision || baseRevision === base), 'TOPOLOGY_REVIEWER_RANGE', 'Review base must equal the original task admission commit.');
  const ancestor = await run('git', ['-C', consumer, 'merge-base', '--is-ancestor', base, revision], { allowFailure: true });
  invariant(ancestor.code === 0, 'TOPOLOGY_REVIEWER_RANGE', 'Task admission base must be an ancestor of the finished revision.');
  const patch = await run('git', ['-C', consumer, 'diff', '--no-ext-diff', '--no-textconv', '--binary', base, revision, '--'], { allowFailure: true });
  invariant(patch.code === 0, 'TOPOLOGY_REVIEWER_RANGE', 'Cannot produce the complete task diff.');
  return { base, patch: patch.stdout, patch_sha256: createHash('sha256').update(patch.stdout).digest('hex'), owner: management.owner };
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
 */
export function validateFindings(findings, files) {
  invariant(Array.isArray(findings), "TOPOLOGY_REVIEWER_FINDINGS", "Findings must be an array.");
  return findings.map((finding, index) => {
    const at = `Finding ${index + 1}`;
    invariant(finding && typeof finding === "object" && !Array.isArray(finding), "TOPOLOGY_REVIEWER_FINDINGS", `${at} must be an object with severity, file, line, claim, evidence and fix.`);
    invariant(SEVERITIES.includes(finding.severity), "TOPOLOGY_REVIEWER_FINDINGS", `${at} severity must be one of ${SEVERITIES.join(", ")}.`);
    invariant(typeof finding.file === "string" && finding.file.trim(), "TOPOLOGY_REVIEWER_FINDINGS", `${at} must name the file.`);
    const file = finding.file.trim().replace(/^\.\//, "");
    invariant(files.has(file), "TOPOLOGY_REVIEWER_FINDINGS", `${at} names ${file}, which is not in the reviewed diff.`, { file });
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

/**
 * Record a review verdict. `revision` is REQUIRED — the verdict binds to exactly that commit,
 * tree, or diff identifier, and any later edit supersedes it.
 */
export async function recordReview({ consumer, task, revision, verdict, findings = [], reviewerId = null, authorAgentIds = [], env = process.env, home = homedir(), pluginRoot = null, baseRevision = null, patchHash = null, requestNonce = null, expectedBinding = null }) {
  const registered = await readReviewerRecord(consumer, env, home);
  invariant(registered && registered.agent_id === reviewerId && env.AO_AGENT_ID === reviewerId, "TOPOLOGY_REVIEWER_IDENTITY", "Only the designated reviewer session can record its review.");
  invariant(!expectedBinding || sameIncarnation(expectedBinding,registered.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'Reviewer incarnation changed before recording the verdict.');
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
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision, env, home });
  invariant(authorAgentIds.includes(range.owner) && (!patchHash || patchHash === range.patch_sha256), 'TOPOLOGY_REVIEWER_RANGE', 'Review authors and patch must match the admitted task range.');
  const structured = validateFindings(findings, await reviewedFiles(consumer, range.base, revision));
  invariant(verdict !== "approve" || approvable(structured), "TOPOLOGY_REVIEWER_FINDINGS", "A blocker or major finding blocks approval; approve only with minor or nit findings.");
  invariant(verdict !== "changes_requested" || !approvable(structured) && structured.length > 0, "TOPOLOGY_REVIEWER_FINDINGS", "Changes requested needs at least one blocker or major finding; with only minor, nit or note findings, approve.");
  const record = {
    base_revision: range.base,
    patch_sha256: range.patch_sha256,
    task: String(task ?? "").trim(),
    revision: String(revision).trim(),
    verdict,
    findings: structured,
    reviewer_id: reviewerId,
    binding: incarnationOf(registered.binding),
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
export async function reviewEligibility({ consumer, task, revision, env = process.env, home = homedir(), probes = null, authorAgentIds = [], pluginRoot = null, baseRevision = null }) {
  const availability = await reviewerAvailability({ consumer, env, home, probes });
  const status = await currentReviewStatus(consumer, task, revision, env, home);
  const reasons = [];
  if (status.review) {
    try {
      const range = await trustedReviewRange({ consumer, task, revision, baseRevision, env, home });
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
  if (status.state === 'satisfied') {
    const collected = await independentReviewStatus({ consumer, task, env, home, pluginRoot });
    if (collected.status !== 'approved' || collected.sourceRevision !== revision) reasons.push(`independent review is not collected for this revision: ${collected.reason ?? collected.status}`);
  }
  return { eligible: reasons.length === 0, reasons, availability, status };
}

/** Historical review projection. It validates evidence without waking or probing a provider. */
export async function independentReviewStatus({ consumer, task, env = process.env, home = homedir(), pluginRoot = null }) {
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
    const range=await trustedReviewRange({consumer,task,revision:result.sourceRevision,env,home});
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

/** Queue an independent exact-revision review without requiring an idle input composer. */
export async function requestReview({ consumer, task, revision, authorAgentIds, baseRevision = null, env = process.env, home = homedir(), wake = wakeReviewRequest }) {
  const record = await readReviewerRecord(consumer, env, home);
  invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer; preserve the finished task until one is available.');
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(revision)), 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'Review request requires a full commit SHA.');
  invariant(Array.isArray(authorAgentIds) && authorAgentIds.length && !authorAgentIds.includes(record.agent_id), 'TOPOLOGY_REVIEWER_CONFLICT', 'Review request must identify independent authors.');
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision, env, home });
  invariant(authorAgentIds.includes(range.owner), 'TOPOLOGY_REVIEWER_AUTHORS', 'Review authors must include the admitted task owner.');
  const dir = join(await reviewerInboxRoot(consumer, env, home), 'requests');
  const key = `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${revision}`;
  return withLock(join(dir, `${key}.lock`), async () => {
    const path = join(dir, `${key}.json`);
    const prior = await readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    invariant(incarnationOf(record.binding), 'TOPOLOGY_REVIEWER_BINDING_REQUIRED', 'Review requires the exact designated reviewer incarnation.');
    if (prior && prior.state !== 'failed' && sameIncarnation(prior.binding,record.binding) && prior.base_revision === range.base && prior.patch_sha256 === range.patch_sha256 && prior.reviewer_id === record.agent_id && JSON.stringify(prior.author_agent_ids) === JSON.stringify(authorAgentIds)) return { ...prior, path };
    const patchPath = join(dir, `${key}.patch`);
    await writeText(patchPath, range.patch);
    const request = { base_revision: range.base, patch_path: patchPath, patch_sha256: range.patch_sha256, nonce: randomUUID(), task, revision, repo_id: record.repo_id, reviewer_id: record.agent_id, binding:incarnationOf(record.binding), author_agent_ids: authorAgentIds, created_at: nowIso() };
    await writeJson(path, request);
    const delivery=await wake({consumer,record,request,path,env,home}).catch(error=>({rang:false,reason:error.code??error.message}));
    const published={...request,delivery:{...delivery,at:nowIso()},state:'published'};
    await writeJson(path,published);
    return { ...published, path };
  });
}

async function wakeReviewRequest({consumer,record,request,path,env,home}) {
  const loaded=await loadAdapters(providerDirs({consumer,home,env}));
  const adapter=adapterFor({cli:record.provider,model:null,args:[],skills:[]},loaded);
  return wakeForProbe({pane:record.pane??record.binding.paneId,adapter,format:composerFormat(adapter,tmuxFailureTrigger(adapter)),binding:record.binding,
    text:`AO_REVIEW_REQUEST ${request.nonce}: Read ${path} and its complete patch. Review the requested revision and emit the nonce-bound AO_REVIEW verdict using read tools only.`});
}

// Values whose text must never gain a space at a wrap: a cut inside them is always a cut.
const STRICT_VALUE_KEYS = new Set(["verdict", "severity", "file"]);

/**
 * The first JSON object in `text`, repaired for what Claude Code's renderer does to it.
 *
 * TM-233. The renderer treats the reply as Markdown, and Markdown's backslash escape turns `\"`
 * into a bare `"`. So a claim quoting `{"enabled": true}` reaches the pane with unescaped quotes,
 * and a reviewer's `\u{2014}` is not a JSON escape at all. Every long verdict with a quote in it
 * was refused as "Review response must be JSON".
 *
 * A key closes at its first quote. A value quote closes the string only where JSON continues after
 * it (`,"key":`, `,"` in an array, `]`, or a `}` followed by more structure); any other quote is
 * prose and is re-escaped. A backslash that starts no valid escape is kept as a literal backslash.
 *
 * `glueAt(i, strict)` returns what to insert before `text[i]` when a wrap boundary falls there;
 * `strict` is true outside strings and inside verdict, severity and file values.
 *
 * ponytail: prose that itself contains `","key":` or `"]` is read as structure. That shape does
 * not occur in review prose; the schema check after parsing refuses the rare mis-split.
 */
function lenientJson(text, glueAt = () => "") {
  let out = "", depth = 0, key = null, lastKey = null, inString = false, before = "";
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) {
      out += glueAt(i, true) + c;
      if (c === '"') { inString = true; key = stack.at(-1) === "{" && (before === "{" || before === ",") ? "" : null; }
      else if (c === "{" || c === "[") { stack.push(c); depth++; }
      else if ((c === "}" || c === "]") && depth > 0) { stack.pop(); if (--depth === 0) return { text: out, closed: true }; }
      if (!/\s/.test(c)) before = c;
      continue;
    }
    out += glueAt(i, key !== null || STRICT_VALUE_KEYS.has(lastKey));
    if (c === "\\") {
      const unicode = /^u\{([0-9a-fA-F]{1,6})\}/.exec(text.slice(i + 1));
      if (/^u[0-9a-fA-F]{4}/.test(text.slice(i + 1, i + 6))) { out += text.slice(i, i + 6); i += 5; }
      else if (unicode && Number.parseInt(unicode[1], 16) <= 0x10ffff) { out += JSON.stringify(String.fromCodePoint(Number.parseInt(unicode[1], 16))).slice(1, -1); i += unicode[0].length; }
      else if (/["\\/bfnrt]/.test(text[i + 1] ?? "")) { out += c + text[++i]; }
      else out += "\\\\";
      continue;
    }
    if (c !== '"') { out += c; if (key !== null) key += c; continue; }
    const rest = text.slice(i + 1);
    const closes = key !== null
      || (stack.at(-1) === "[" ? /^\s*(?:,\s*"|\])/.test(rest)
        : /^\s*(?:,\s*"[^"\\]*"\s*:|\}\s*(?:[,\]}]|$))/.test(rest) || (depth === 1 && /^\s*\}/.test(rest)));
    if (!closes) { out += '\\"'; continue; }
    out += c; inString = false; before = c;
    if (key !== null) { lastKey = key; key = null; } else lastKey = null;
  }
  return { text: out, closed: false };
}

/**
 * Every AO_REVIEW response for `nonce` on the pane, as candidate JSON texts, oldest first.
 *
 * TM-215 h. Claude Code's renderer wraps a long line into several pane lines, indenting the
 * continuations, and `capture-pane -J` does not rejoin them. So an unbalanced response keeps
 * absorbing the following indented lines until its braces close.
 *
 * TM-233. Where a break falls decides the join. Outside strings and inside verdict, severity and
 * file values, nothing is lost at a break, so the rows join with nothing: those are the fields the
 * schema checks exactly. Inside prose a word wrap drops a space and a cut through a word longer
 * than a row drops nothing; TM-215's width estimate tells the two apart, and when it is wrong the
 * claim differs by one space at the break, never in a field the schema checks.
 */
export function reviewResponsesOnScreen(screen, nonce) {
  const prefix = `AO_REVIEW ${nonce} `;
  const lines = String(screen ?? "").split(/\r?\n/);
  const responses = [];
  for (let i = 0; i < lines.length; i++) {
    const line = protocolOutputLine(lines[i]);
    if (!line.startsWith(prefix) && line !== prefix.trimEnd()) continue;
    const raw = [lines[i]], parts = [line.slice(prefix.length)];
    while (!lenientJson(parts.join("")).closed && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !protocolOutputLine(lines[i + 1]).startsWith("AO_REVIEW ")) {
      raw.push(lines[++i]); parts.push(protocolOutputLine(lines[i]));
    }
    const width = Math.max(...raw.slice(0, -1).map(text => text.trimEnd().length));
    const prose = k => {
      if (raw[k - 1].trimEnd().length < width) return " ";
      // A full row is a cut only when the word across the break could not fit on a row of its own.
      const word = parts[k - 1].split(" ").at(-1) + parts[k].split(" ")[0];
      return word.length > width - (raw[k].length - raw[k].trimStart().length) ? "" : " ";
    };
    const breaks = new Map();
    parts.reduce((offset, part, k) => { if (k) breaks.set(offset, k); return offset + part.length; }, 0);
    const fitted = lenientJson(parts.join(""), (at, strict) => !breaks.has(at) || strict ? "" : prose(breaks.get(at)));
    const texts = [fitted.text, lenientJson(parts.join(" ")).text, lenientJson(parts.join("")).text];
    // Braces that never close before the capture ends (or before the next unindented line) are a
    // verdict still being printed, not a malformed one.
    texts.closed = fitted.closed;
    responses.push(texts);
  }
  return responses;
}

/** The reviewer's one verdict for `nonce`. Repeats are fine when they agree; the last one is taken. */
export function parseReviewResponse(screen, nonce) {
  const candidates = reviewResponsesOnScreen(screen, nonce);
  invariant(candidates.length > 0, 'TOPOLOGY_REVIEWER_RESPONSE', 'Expected a nonce-bound review response from the designated pane.');
  const parsed = candidates.map(texts => {
    for (const text of texts) { try { return JSON.parse(text); } catch { /* next candidate */ } }
    return fail('TOPOLOGY_REVIEWER_RESPONSE', 'Review response must be JSON.');
  });
  const last = parsed[parsed.length - 1];
  invariant(parsed.every(response => JSON.stringify(response) === JSON.stringify(last)), 'TOPOLOGY_REVIEWER_RESPONSE', 'The pane shows different review responses for one nonce.');
  return last;
}

/** Host collects a restricted reviewer's explicit response from its verified pane. The reviewer
 * writes no files and receives no execution tool just to deliver a verdict.
 */
/** A response the reviewer DID give that collection refuses. Not "no answer yet", not a changed identity. */
const REFUSED_RESPONSE_CODES = new Set(['TOPOLOGY_REVIEWER_RESPONSE', 'TOPOLOGY_REVIEWER_FINDINGS', 'TOPOLOGY_REVIEWER_VERDICT']);

export async function collectReview({ consumer, task, revision, env = process.env, home = homedir(), pluginRoot = null, output = reviewerOutput, deliver = sendStandingMessage, lead = readLeadRegistration }) {
  const path = join(await reviewerInboxRoot(consumer, env, home), 'requests', `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision')}.json`);
  return withLock(path.replace(/\.json$/,'.lock'),async()=>{
  const record = await readReviewerRecord(consumer, env, home);
  invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer.');
  const request = await readJson(path);
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision: request.base_revision, env, home });
  invariant(request.patch_sha256 === range.patch_sha256, "TOPOLOGY_REVIEWER_RANGE", "Review request no longer covers the admitted task range.");
  invariant(request.reviewer_id === record.agent_id && request.repo_id === record.repo_id && request.revision === revision, 'TOPOLOGY_REVIEWER_IDENTITY', 'Request belongs to a different reviewer or revision.');
  invariant(sameIncarnation(request.binding,record.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'Reviewer incarnation changed after the request; queue a new independent review.');
  if(request.collected_at) {
    const prior=await latestReview(consumer,task,env,home);
    invariant(prior?.revision===revision && prior.request_nonce===request.nonce && sameIncarnation(prior.binding,record.binding), 'TOPOLOGY_REVIEWER_RESPONSE', 'Collected review evidence is missing or differs from this request.');
    return prior;
  }
  invariant(createHash('sha256').update(await readFile(request.patch_path)).digest('hex') === request.patch_sha256, 'TOPOLOGY_REVIEWER_RESPONSE', 'Review patch changed after the request.');
  const screen = await output(record);
  const shown = reviewResponsesOnScreen(screen, request.nonce);
  invariant(shown.length > 0, 'TOPOLOGY_REVIEWER_RESPONSE', 'Expected a nonce-bound review response from the designated pane.');
  // TM-215 review 2: Claude Code prints a long line gradually. A capture taken mid-line is not a
  // refusal; it is collected on a later tick, so it throws a code that does not fail the request.
  invariant(shown.at(-1).closed, 'TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE', 'The review response is still being printed; collect it again later.');
  let review;
  try {
  const response = parseReviewResponse(screen, request.nonce);
  const current = await readReviewerRecord(consumer,env,home);
  invariant(current?.agent_id===record.agent_id && sameIncarnation(current.binding,record.binding), 'TOPOLOGY_REVIEWER_IDENTITY', 'Reviewer changed while collecting output.');
  review = await recordReview({ consumer, task, revision, baseRevision: request.base_revision, patchHash: request.patch_sha256, requestNonce:request.nonce, expectedBinding:record.binding, verdict: response.verdict, findings: response.findings, reviewerId: record.agent_id, authorAgentIds: request.author_agent_ids, env: { ...env, AO_AGENT_ID: record.agent_id }, home, pluginRoot });
  } catch (error) {
    // TM-215 review 1: a refused answer used to leave the request pending forever — retried under
    // the same nonce, and a corrected answer then disagreed with the refused copy still on screen.
    // Now the request fails, the lead is told once, and requestReview mints a fresh nonce.
    if (REFUSED_RESPONSE_CODES.has(error.code)) {
      const failed = { ...request, state: 'failed', failure: { at: nowIso(), code: error.code, reason: `The reviewer's response was refused: ${error.message}` } };
      failed.escalation = await escalateFailedReview({ consumer, request: failed, env, home, deliver, lead });
      await writeJson(path, failed);
    }
    throw error;
  }
  await writeJson(path, { ...request, collected_at: nowIso(), verdict: review.verdict,state:'collected' });
  return review;
  });
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
      if(error.code==='TOPOLOGY_REVIEWER_RESPONSE' && !request.delivery?.rang && (request.delivery?.attempts??0)<MAX_REVIEW_WAKES && Date.now()-Date.parse(request.delivery?.at??0)>=10_000) {
        const record=await readReviewerRecord(options.consumer,options.env,options.home);
        if(record && sameIncarnation(record.binding,request.binding)) {
          const delivery=await wakeReviewRequest({...options,record,request,path}).catch(error=>({rang:false,reason:error.code??error.message}));
          request.delivery={...delivery,attempts:(request.delivery?.attempts??0)+1,at:nowIso()};
        }
      }
      // TM-215 f: a request no wake could deliver used to stay awaiting-review forever. After the
      // last attempt it is failed, the lead is told once, and requestReview mints a fresh one.
      if(error.code==='TOPOLOGY_REVIEWER_RESPONSE' && !request.delivery?.rang && (request.delivery?.attempts??0)>=MAX_REVIEW_WAKES) {
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
  return deliver({ id: createHash('sha256').update(`review-failed:${request.nonce}`).digest('hex').slice(0, 32), consumer, to: leadId,
    subject: `review request failed: ${request.task}`, body, task: request.task, provenance: { source: 'ao-topology review' } }, { env, home })
    .then(sent => ({ status: sent?.status ?? 'sent', to: leadId, message_id: sent?.envelope?.id ?? null }))
    .catch(error => ({ status: 'failed', to: leadId, reason: error?.code ?? String(error) }));
}
