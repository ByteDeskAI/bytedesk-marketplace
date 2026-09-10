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
import { readdir, readFile, rm, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { agentDirs, createAgent, findLead, requireAgent, resolveAgentRef } from "./agents.mjs";
import { findTemplate, loadConfig } from "./config.mjs";
import { displayName } from "./identity.mjs";
import { composerFormat, wakeForProbe } from "./delivery.mjs";
import { openRoleSession, roleSessionName, tmuxFailureTrigger } from "./launch.mjs";
import { withLock } from "./lockfile.mjs";
import { composePrompt, promptErrorDetail } from "./prompts.mjs";
import { refreshPrompt } from "./prompt-lifecycle.mjs";
import { adapterFor, buildArgv, loadAdapters, providerDirs } from "./providers.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import * as tmux from "./tmux.mjs";
import { AO_HOME, exists, fail, invariant, nowIso, readJson, run, sleep, writeJson, writeText } from "./util.mjs";

const REGISTRY_KIND = "reviewers";
const DEFAULT_REVIEWER_PROVIDERS = ["claude", "codex"];
const DEFAULT_TEMPLATE = "reviewer-default";
const VERDICTS = new Set(["approve", "changes_requested", "blocked"]);

/** Host-local reviewer registry, one record per canonical repository. */
export function reviewersRoot(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), REGISTRY_KIND);
}

/** Only this repository's pollable input is granted to its restricted reviewer. */
export async function reviewerInboxRoot(consumer, env = process.env, home = homedir()) {
  return join(reviewersRoot(env, home), 'inboxes', repoKey((await canonicalRepoId(consumer)).id));
}

export function reviewerProtocolPrompt(agent, consumer, inboxRoot) {
  return `You are ${displayName(agent)} (id "${agent.id}", role: reviewer), the standing code reviewer for ${consumer}. Read ${join(agent._dir, 'prompt.md')} and follow it. At safe boundaries read unexpired probes in ${join(inboxRoot, 'probes')} for your agent id and emit exactly AO_REVIEWER_READY followed by a space and the nonce on its own line; the host records the response. Read requests under ${join(inboxRoot, 'requests')}; review the complete base_revision..revision patch, never only the final commit, then emit one line AO_REVIEW followed by a space, the request nonce, a space, and JSON with verdict (approve, changes_requested, blocked) and findings array. Never execute code or change files.`;
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
  const restricted = { ...adapter, args: ["--restricted", "--safe-mode", "--strict-mcp-config", "--disallowed-tools", "Write,Edit,NotebookEdit,MultiEdit,Agent,Task", "--permission-prompts", "none"], coordinator_args: [], auto_approve_args: [] };
  return buildArgv(restricted, { ...agent, args: [], auto_approve: false, coordinates_only: false, model, add_dirs: [consumer, inboxRoot].filter(Boolean) }, vars);
}

async function bindingAlive(record) {
  if (!record?.binding) return false;
  const panes = await tmux.listServerPanes({ tmuxServer: record.binding.serverKey });
  return panes.some(p => p.alive && ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"].every(key => p[key] === record.binding[key]));
}
async function reviewerOutput(record) {
  if (!await bindingAlive(record)) return "";
  const result = await run("tmux", ["-S", record.binding.serverKey, "capture-pane", "-p", "-t", record.binding.paneId, "-S", "-80"], { allowFailure: true });
  return result.code === 0 ? result.stdout : "";
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

export async function reviewerProbeReady({ consumer, record, env = process.env, home = homedir(), timeoutMs = PROBE_TIMEOUT_MS, onProbe = null, output = reviewerOutput, wake = defaultWake, adapters = null }) {
  if (!record?.agent_id) return false;
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
    const mine = ack?.agent_id === record.agent_id && ack?.repo_id === record.repo_id && ack?.session === record.session;
    await Promise.all([rm(join(dir, `${stale}.json`), { force: true }), rm(join(dir, name), { force: true })]);
    if (mine && pending && Number(pending.expires_at) >= Date.now()) { await rememberReviewerAck(dir, record); return true; }
  }
  const nonce = randomUUID();
  const path = join(dir, `${nonce}.json`), ackPath = join(dir, `${nonce}.ack.json`);
  const probe = { nonce, repo_id: record.repo_id, agent_id: record.agent_id, session: record.session, expires_at: Date.now() + timeoutMs };
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
      await writeJson(path, probe).catch(() => {});
    }
    while (Date.now() <= probe.expires_at) {
      const screen = await output(record);
      if (readySignalOnScreen(screen, nonce)) { await rememberReviewerAck(dir, record); return true; }
      const ack = await readJson(ackPath).catch(() => null);
      if (ack?.nonce === nonce && ack.agent_id === record.agent_id && ack.repo_id === record.repo_id && ack.session === record.session) { await rememberReviewerAck(dir, record); return true; }
      // TM-157: the window is now seconds rather than one second, so the poll has to be a poll and
      // not a spin — at 25ms this would take ~800 captures of the same pane to answer one probe.
      await sleep(Math.min(PROBE_POLL_MS, Math.max(1, probe.expires_at - Date.now())));
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
  return JSON.stringify(memo.binding ?? null) === JSON.stringify(record.binding ?? null) ? { age_ms: age } : null;
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

export async function reviewerNonceAck({ consumer, nonce, env = process.env, home = homedir() }) {
  invariant(/^[a-f0-9-]{36}$/.test(String(nonce)), "TOPOLOGY_REVIEWER_NONCE", "Invalid reviewer nonce.");
  const dir = join(await reviewerInboxRoot(consumer, env, home), "probes");
  const probe = await readJson(join(dir, `${nonce}.json`));
  const record = await readReviewerRecord(consumer, env, home);
  const identity = await canonicalRepoId(consumer);
  invariant(record && probe.repo_id === identity.id && probe.agent_id === record.agent_id && env.AO_AGENT_ID === record.agent_id && probe.session === record.session && probe.expires_at >= Date.now(), "TOPOLOGY_REVIEWER_ACK_OWNER", "Only the designated reviewer can acknowledge its current unexpired challenge.");
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
  const session = probes ?? defaultProbes();
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
export async function reviewerStanding({ consumer, env = process.env, home = homedir(), probes = null }) {
  const session = probes ?? defaultProbes();
  const record = await readReviewerRecord(consumer, env, home);
  if (!record) {
    return { registered: false, alive: false, responsive: false, record: null, reason: "no reviewer is registered for this repository — run ensureReviewer first" };
  }
  if (!(await session.alive(record.session, record))) {
    return { registered: true, alive: false, responsive: false, record, reason: `reviewer session ${record.session} is not running — restart it before requesting a review` };
  }
  const responsive = probes?.responsive
    ? await probes.responsive(record)
    : await reviewerProbeReady({ consumer, record, env, home });
  return { registered: true, alive: true, responsive, record, reason: responsive ? null : "reviewer is alive but has not acknowledged a readiness nonce" };
}

/**
 * Can this repository's reviewer actually review right now? { available, record, reason }.
 * Fail closed and say why: an unavailable reviewer is REPORTED, so the merge gate blocks on facts
 * instead of pretending a review can happen. The three facts behind the one boolean are in
 * reviewerStanding; this is the merge gate's view, where only "yes or no, and why not" matters.
 */
export async function reviewerAvailability({ consumer, env = process.env, home = homedir(), probes = null }) {
  const standing = await reviewerStanding({ consumer, env, home, probes });
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
  const session = probes ?? defaultProbes();
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
    const candidate = { session: name, pane: null, agent_id: agent.id, repo_id: identity.id };
    invariant(
      await session.alive(name, candidate),
      "TOPOLOGY_REVIEWER_NOT_ALIVE",
      `${displayName(agent)} has no live session (${name}). Assignment is a handshake with a RUNNING session — open one first; enrollment never spawns it for you.`,
      { agent_id: agent.id, session: name },
    );
    const binding = probes?.binding
      ? await probes.binding(candidate)
      : (await tmux.listServerPanes({ env })).find(pane => pane.sessionName === name && pane.alive !== false) || null;
    invariant(probes || binding, "TOPOLOGY_REVIEWER_BINDING_REQUIRED", "Assignment needs exact observed session binding.");
    candidate.binding = binding;
    candidate.pane = binding?.paneId ?? null;
    const responsive = probes?.responsive
      ? await probes.responsive(candidate)
      : await reviewerProbeReady({ consumer, record: candidate, env, home });
    invariant(responsive, "TOPOLOGY_REVIEWER_HANDSHAKE_REQUIRED", "Assignment requires an acknowledged readiness nonce; the existing session was preserved.");
    await writeJson(agent._file, { ...Object.fromEntries(Object.entries(agent).filter(([key]) => !key.startsWith("_"))), role: "reviewer" });
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

/**
 * Record a review verdict. `revision` is REQUIRED — the verdict binds to exactly that commit,
 * tree, or diff identifier, and any later edit supersedes it.
 */
export async function recordReview({ consumer, task, revision, verdict, findings = [], reviewerId = null, authorAgentIds = [], env = process.env, home = homedir(), pluginRoot = null, baseRevision = null, patchHash = null }) {
  const registered = await readReviewerRecord(consumer, env, home);
  invariant(registered && registered.agent_id === reviewerId && env.AO_AGENT_ID === reviewerId, "TOPOLOGY_REVIEWER_IDENTITY", "Only the designated reviewer session can record its review.");
  const lead = await findLead(agentDirs({ consumer: registered.consumer || consumer, home, pluginRoot }));
  assertIndependent(reviewerId, { lead, notAgentIds: authorAgentIds });
  invariant(Array.isArray(authorAgentIds) && authorAgentIds.length > 0, "TOPOLOGY_REVIEWER_AUTHORS", "Name the author identities for independent review.");
  invariant(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(revision)), "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "Review requires an exact full Git commit ID.");
  const verified = await run("git", ["-C", consumer, "rev-parse", "--verify", `${revision}^{commit}`], { allowFailure: true });
  invariant(verified.code === 0 && verified.stdout.trim() === revision, "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "Review revision must exist as an exact commit in this repository.");
  invariant(Array.isArray(findings), "TOPOLOGY_REVIEWER_FINDINGS", "Findings must be an array.");
  invariant(verdict !== "approve" || findings.length === 0, "TOPOLOGY_REVIEWER_FINDINGS", "Any unresolved finding blocks approval.");
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
  const record = {
    base_revision: range.base,
    patch_sha256: range.patch_sha256,
    task: String(task ?? "").trim(),
    revision: String(revision).trim(),
    verdict,
    findings: Array.isArray(findings) ? findings : [String(findings)],
    reviewer_id: reviewerId,
    author_agent_ids: authorAgentIds,
    repo_id: registered.repo_id,
    verified_commit: revision,
    created_at: nowIso(),
  };
  invariant(record.task, "TOPOLOGY_REVIEWER_TASK", "A review must name the task it covers.");
  const path = join(await reviewsRoot(consumer, env, home), segment(record.task, "TOPOLOGY_REVIEWER_TASK", "the task"), `${segment(record.revision, "TOPOLOGY_REVIEWER_REVISION_REQUIRED", "the exact revision")}.json`);
  await writeJson(path, record);
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
 *   satisfied          approved, of THIS exact revision
 *   changes_requested  the reviewer asked for changes on this revision
 *   blocked            the reviewer could not review this revision
 *   stale              the latest review covers a DIFFERENT revision — any edit since invalidated it
 *   missing            no review exists at all
 */
export async function currentReviewStatus(consumer, task, currentRevision, env = process.env, home = homedir()) {
  const review = await latestReview(consumer, task, env, home);
  if (!review) return { state: "missing", review: null };
  if (String(review.revision) !== String(currentRevision)) return { state: "stale", review };
  return { state: review.verdict === "approve" && review.findings?.length === 0 && review.verified_commit === currentRevision ? "satisfied" : "blocked", review };
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
    if (lead?.id === status.review.reviewer_id || authorAgentIds.includes(status.review.reviewer_id) || status.review.author_agent_ids?.includes(status.review.reviewer_id)) reasons.push("reviewer is not independent of the lead and authors");
    if (!Array.isArray(status.review.author_agent_ids) || status.review.author_agent_ids.length === 0 || authorAgentIds.some(id => !status.review.author_agent_ids.includes(id))) reasons.push("review does not cover the current author identities");
    if (status.review.repo_id !== availability.record?.repo_id) reasons.push("review repository identity differs");
  }
  if (!availability.available) reasons.push(`reviewer unavailable: ${availability.reason}`);
  if (status.state === "missing") reasons.push(`no review of ${task} exists — a satisfied review of revision ${revision} is required`);
  else if (status.state === "stale") reasons.push(`the latest review covers revision ${status.review.revision}, not the current revision ${revision} — a re-review is required`);
  else if (status.state !== "satisfied") reasons.push(`review of revision ${revision} is "${status.state}", not satisfied`);
  return { eligible: reasons.length === 0, reasons, availability, status };
}

/** Queue an independent exact-revision review without requiring an idle input composer. */
export async function requestReview({ consumer, task, revision, authorAgentIds, baseRevision = null, env = process.env, home = homedir() }) {
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
    if (prior && prior.base_revision === range.base && prior.patch_sha256 === range.patch_sha256 && prior.reviewer_id === record.agent_id && JSON.stringify(prior.author_agent_ids) === JSON.stringify(authorAgentIds)) return { ...prior, path };
    const patchPath = join(dir, `${key}.patch`);
    await writeText(patchPath, range.patch);
    const request = { base_revision: range.base, patch_path: patchPath, patch_sha256: range.patch_sha256, nonce: randomUUID(), task, revision, repo_id: record.repo_id, reviewer_id: record.agent_id, author_agent_ids: authorAgentIds, created_at: nowIso() };
    await writeJson(path, request);
    return { ...request, path };
  });
}

/** Host collects a restricted reviewer's explicit response from its verified pane. The reviewer
 * writes no files and receives no execution tool just to deliver a verdict.
 */
export async function collectReview({ consumer, task, revision, env = process.env, home = homedir(), pluginRoot = null, output = reviewerOutput }) {
  const record = await readReviewerRecord(consumer, env, home);
  invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer.');
  const path = join(await reviewerInboxRoot(consumer, env, home), 'requests', `${segment(task, 'TOPOLOGY_REVIEWER_TASK', 'task')}-${segment(revision, 'TOPOLOGY_REVIEWER_REVISION_REQUIRED', 'revision')}.json`);
  const request = await readJson(path);
  const range = await trustedReviewRange({ consumer, task, revision, baseRevision: request.base_revision, env, home });
  invariant(request.patch_sha256 === range.patch_sha256, "TOPOLOGY_REVIEWER_RANGE", "Review request no longer covers the admitted task range.");
  invariant(request.reviewer_id === record.agent_id && request.repo_id === record.repo_id && request.revision === revision, 'TOPOLOGY_REVIEWER_IDENTITY', 'Request belongs to a different reviewer or revision.');
  invariant(createHash('sha256').update(await readFile(request.patch_path)).digest('hex') === request.patch_sha256, 'TOPOLOGY_REVIEWER_RESPONSE', 'Review patch changed after the request.');
  const prefix = `AO_REVIEW ${request.nonce} `;
  const lines = String(await output(record)).split(/\r?\n/).map(s => s.trim()).filter(line => line.startsWith(prefix));
  invariant(lines.length === 1, 'TOPOLOGY_REVIEWER_RESPONSE', 'Expected exactly one nonce-bound review response from the designated pane.');
  let response;
  try { response = JSON.parse(lines[0].slice(prefix.length)); } catch { fail('TOPOLOGY_REVIEWER_RESPONSE', 'Review response must be JSON.'); }
  const review = await recordReview({ consumer, task, revision, baseRevision: request.base_revision, patchHash: request.patch_sha256, verdict: response.verdict, findings: response.findings, reviewerId: record.agent_id, authorAgentIds: request.author_agent_ids, env: { ...env, AO_AGENT_ID: record.agent_id }, home, pluginRoot });
  await writeJson(path, { ...request, collected_at: nowIso(), verdict: review.verdict });
  return review;
}
