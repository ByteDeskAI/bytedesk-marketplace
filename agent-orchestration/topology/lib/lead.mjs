// The persistent repository lead: registry, lifecycle, and the proof that it is listening.
//
// A lead is not a run. It outlives every run, every worktree, and this process, and four design
// decisions carry that weight:
//
// 1. Identity is the REPOSITORY, not the checkout. The registry is keyed by the canonical git
//    common-directory (repoid.mjs), so the main checkout and every linked worktree resolve to ONE
//    lead. Keying by cwd would mint a lead per worktree and two agents would each think they
//    coordinate the same repo.
// 2. Three states are kept distinct on purpose: "registered" (a record and a library lead agent
//    exist), "alive" (a tmux session/pane process is running), "responsive" (a nonce probe was
//    acknowledged). They are never conflated because a live process proves nothing about the agent
//    inside it — a CLI parked on a login screen is alive and useless, and an agent deep in a long
//    task is alive and unresponsive yet perfectly healthy. That is why a failed ack NEVER kills and
//    NEVER duplicates the session: "unresponsive" is a report, not a verdict.
// 3. Responsiveness is proven, never inferred. The probe is a nonce file under the registry's
//    probes/ directory plus a one-line pointer rung into the pane naming the ack command; the agent
//    acknowledges by writing the ack file (leadNonceAck — the CLI wires `lead ack` to it). Files,
//    not screen scraping: the mailbox invariant (the message of record is a file) applies to
//    liveness exactly as it applies to mail.
// 4. Ownership decides what may be destroyed. A DEDICATED lead (mode "dedicated", managed) is one
//    this module created: when its session dies it is restarted under the SAME identity — same
//    library agent, same role-session name, so its memory and address survive — and it is killed
//    only on an explicit { kill: true }. An ASSIGNED lead (mode "assigned", externally_owned) is a
//    human's already-running session enrolled by explicit handshake: it is never killed, never
//    respawned, never re-granted, and when it dies the only honest action is to report it.
//
// The recursion guard: a dedicated lead's own session environment carries AO_LEAD_ID, and
// ensureLead answers { action: "self" } the moment it sees it. Without that, the lead's own
// startup would ensure a lead, whose startup would ensure a lead.
//
// Every tmux touch goes through an injectable `probes` object ({ alive, responsive, open, and
// optionally pane/kill }) so the whole lifecycle is testable with no tmux server. Defaults use
// tmux.mjs and openRoleSession.
import { randomUUID } from "node:crypto";
import { mkdir, rm, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { agentDirs, createAgent, findLead, requireAgent } from "./agents.mjs";
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
import { exists, fail, invariant, nowIso, readJson, sleep, writeJson, writeText } from "./util.mjs";

const RECORD_VERSION = 1;
// TM-157. 5s was the window when nothing woke the lead and the answer could only come from a poll
// it was already about to make. Now the probe RINGS, so the window has to cover a model turn: read
// the line, decide, run one command. 30s is a starting point, not a measurement — override it with
// AO_LEAD_ACK_TIMEOUT_MS if a slower provider needs longer.
const DEFAULT_ACK_TIMEOUT_MS = Number(process.env.AO_LEAD_ACK_TIMEOUT_MS ?? 30_000);
const ACK_POLL_MS = Number(process.env.AO_LEAD_ACK_POLL_MS ?? 500);
// A nonce becomes a filename, so it is validated before it is ever joined to a path.
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;

/** Where lead registrations live: one <repoKey>.json per repository, plus probes/ and locks. */
export function leadRegistryDir(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), "leads");
}

function registryPaths(registryDir, key) {
  return { recordPath: join(registryDir, `${key}.json`), lockPath: join(registryDir, `${key}.lock`) };
}

/**
 * The registration for the repository containing `consumer`, or null.
 * Returns { identity, key, record } — the identity travels with the record so a caller never
 * re-derives it from a possibly-different cwd.
 */
export async function readLeadRegistration({ consumer, env = process.env, home = homedir() }) {
  const identity = await canonicalRepoId(consumer);
  const key = repoKey(identity.id);
  const { recordPath } = registryPaths(leadRegistryDir(env, home), key);
  if (!(await exists(recordPath))) return null;
  return { identity, key, record: await readJson(recordPath) };
}

// ── Default probes (the tmux-touching implementations) ───────────────────────

/** A pane id can die and be re-created; the session name is the durable address. Check both. */
async function defaultAlive(record) {
  if (record?.binding) {
    const panes = await tmux.listServerPanes({ tmuxServer: record.binding.serverKey });
    return panes.some((pane) => pane.alive && ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"].every((key) => pane[key] === record.binding[key]));
  }
  if (record?.pane) {
    const state = await tmux.paneState(record.pane);
    if (state.alive) return true;
  }
  if (record?.session) {
    const panes = await tmux.listPanes(record.session);
    return panes.some((pane) => pane.alive);
  }
  return false;
}

async function defaultPane(record) {
  if (!record?.session) return null;
  const panes = await tmux.listPanes(record.session);
  invariant(panes.filter(pane => pane.alive).length <= 1, "TOPOLOGY_LEAD_PANE_AMBIGUOUS", "Session has multiple live panes; enrollment needs an unambiguous agent session.");
  return panes.find((pane) => pane.alive)?.id ?? panes[0]?.id ?? null;
}

/**
 * Prove the agent answers, not just that a process exists: drop a nonce file, ring the pane with a
 * pointer naming the ack command, and wait for the ack file. A send failure or a timeout both mean
 * "unresponsive" — they never mean "dead", so nothing here kills anything.
 */
async function defaultResponsive(record, ackTimeoutMs, { registryDir, log = () => {} }) {
  if (!record?.pane) return false;
  const dir = join(registryDir, "probes");
  // TM-157. A PROOF THAT COST A MODEL TURN IS WORTH KEEPING. Every call used to mint a new nonce
  // and demand a fresh answer, so `role status` twice in a minute cost two turns, and a governed
  // launch — which needs the lead AND the reviewer responsive in the SAME call — needed both to
  // answer inside one window. They rarely align, which is why the demo could get each role
  // responsive on its own and never both at once.
  //
  // An ack that landed a minute ago is still evidence that this incarnation answers. It is bound to
  // the six-tuple, so a respawned pane invalidates it, and `alive` is checked separately on every
  // call — this caches "it answered", never "it is up".
  const cached = await recentAck(dir, record);
  if (cached) { log(`lead answered ${cached.age_ms}ms ago; proof reused`); return true; }
  // TM-161. AN ANSWER THAT ARRIVED AFTER WE STOPPED WAITING IS STILL AN ANSWER. Before minting a
  // new nonce, look for an ack against a probe still inside its own expiry — that is a lead which
  // was MID-TURN when the last ring landed, read it at its next boundary, and ran the command
  // correctly and promptly. It is the normal case for a working agent, and it used to be discarded.
  const late = await lateAck(dir, record);
  if (late) { await rememberAck(dir, record); log(`lead acknowledged probe ${late} after the previous wait returned`); return true; }
  // TM-161. `ackTimeoutMs <= 0` means READ ONLY: answer from proof already on disk, mint nothing.
  //
  // A fast readiness SCREEN — `startupCheck`, which runs on a SessionStart hook for every Claude
  // session on this machine — cannot afford to wait for a model turn, and must not pretend to. It
  // used to pass 1000ms, and a one-second probe is worse than no probe: no agent can answer inside
  // it, so it burns a ring, and then its own `sweepExpired` deletes it one second later. Worse
  // still for THIS fix, the ack a busy lead runs at its next boundary is refused as EXPIRED rather
  // than accepted as LATE — the exact case the late-ack path exists to serve, defeated by a caller
  // that never intended to wait.
  //
  // So a screen asks; it does not interrogate. Not proven is an honest answer for it to give.
  if (!(ackTimeoutMs > 0)) { log("readiness screen: cached proof only, no probe minted"); return false; }
  const nonce = randomUUID();
  const probePath = join(dir, `${nonce}.json`);
  const ackPath = join(dir, `${nonce}.ack.json`);
  await writeJson(probePath, { nonce, repo_id: record.repo_id, agent_id: record.agent_id, expires_at: Date.now() + ackTimeoutMs, created_at: nowIso() });
  // TM-157. The line above used to be the whole mechanism, under a comment claiming this function
  // "rings the pane with a pointer naming the ack command". It did not — and a pollable file is no
  // mechanism at all for an IDLE lead, which has no next safe boundary at which to poll. So ring
  // it, under the bell's rules, and keep the file as the fallback for a lead that is mid-turn:
  // a busy, moved, dead or modal pane gets nothing typed into it and answers when it next looks.
  await wakeLead(record, nonce, { log }).catch(() => {});
  // Pollable files never interrupt a composer or active tool input. The enrolled agent reads
  // pending probes at its safe boundary; inability to acknowledge remains unresponsive.
  const deadline = Date.now() + ackTimeoutMs;
  let acked = false;
  while (Date.now() <= deadline) {
    if (await exists(ackPath)) {
      const ack = await readJson(ackPath).catch(() => null);
      acked = ack?.nonce === nonce && ack?.repo_id === record.repo_id && ack?.agent_id === record.agent_id;
      break;
    }
    await sleep(ACK_POLL_MS);
  }
  // TM-161: the probe now OUTLIVES this wait, up to its own expires_at. Deleting it here is what
  // made a busy lead unprovable: it ran `lead ack` as its first action at the next turn boundary,
  // the file was already gone, and TOPOLOGY_LEAD_PROBE_UNKNOWN came back — a correct, prompt answer
  // refused. `expires_at` is still the line, and `leadNonceAck` still enforces it, so accepting a
  // LATE ack never becomes accepting a STALE one. Expired probes are swept on the next pass.
  if (acked) { await rm(probePath, { force: true }); await rm(ackPath, { force: true }); await rememberAck(dir, record); }
  else await sweepExpired(dir);
  if (acked) await rememberAck(dir, record);
  log(acked ? `lead acknowledged probe ${nonce}` : `lead probe ${nonce} timed out after ${ackTimeoutMs}ms`);
  return acked;
}

/**
 * An ack sitting against a probe that has not expired, left by a lead that answered after the
 * previous wait gave up. Returns the nonce it found, or null.
 */
export async function lateAckForTest(dir, record) { return lateAck(dir, record); }

async function lateAck(dir, record) {
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".ack.json")) continue;
    const nonce = name.slice(0, -".ack.json".length);
    const probe = await readJson(join(dir, `${nonce}.json`)).catch(() => null);
    const ack = await readJson(join(dir, name)).catch(() => null);
    const mine = ack?.agent_id === record.agent_id && ack?.repo_id === record.repo_id && ack?.nonce === nonce;
    if (!mine) continue;
    // The probe's own expiry is the line, exactly as `leadNonceAck` enforces it at write time.
    if (probe && Number(probe.expires_at) >= Date.now()) {
      await Promise.all([rm(join(dir, `${nonce}.json`), { force: true }), rm(join(dir, name), { force: true })]);
      return nonce;
    }
    await Promise.all([rm(join(dir, `${nonce}.json`), { force: true }), rm(join(dir, name), { force: true })]);
  }
  return null;
}

/** Remove probes nobody can answer any more. Cheap, and it keeps the directory from growing. */
async function sweepExpired(dir) {
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".json") || name.endsWith(".ack.json")) continue;
    const probe = await readJson(join(dir, name)).catch(() => null);
    if (!probe || Number(probe.expires_at) < Date.now()) await rm(join(dir, name), { force: true });
  }
}

/** How long an acknowledgement stands as proof. Not liveness — `alive` answers that every time. */
const RESPONSIVE_TTL_MS = Number(process.env.AO_RESPONSIVE_TTL_MS ?? 600_000);

const ackMemoPath = (dir, record) => join(dir, `${record.agent_id}.answered.json`);

async function recentAck(dir, record) {
  const memo = await readJson(ackMemoPath(dir, record)).catch(() => null);
  if (!memo?.at) return null;
  const age = Date.now() - Number(memo.at);
  if (!(age >= 0 && age < RESPONSIVE_TTL_MS)) return null;
  // The proof belongs to an INCARNATION, not to an agent id. A pane that has been respawned since
  // is a different process wearing the same name, and it has proven nothing.
  const same = JSON.stringify(memo.binding ?? null) === JSON.stringify(record.binding ?? null);
  return same ? { age_ms: age } : null;
}

async function rememberAck(dir, record) {
  await writeJson(ackMemoPath(dir, record), { at: Date.now(), agent_id: record.agent_id, binding: record.binding ?? null }).catch(() => {});
}

/**
 * Ring the lead with the command that answers the probe. Unlike the reviewer — whose READY signal
 * is a printed line because it has no shell — the lead has one, so the ring names the exact verb.
 */
async function wakeLead(record, nonce, { log = () => {} } = {}) {
  if (!record?.pane) return { rang: false, reason: "the record names no pane" };
  const adapters = await loadAdapters(providerDirs({ consumer: record.consumer, home: homedir(), env: process.env })).catch(() => null);
  const adapter = adapters ? adapterFor({ cli: record.provider, model: null, args: [], skills: [] }, adapters) : null;
  if (!adapter) return { rang: false, reason: `no adapter for provider ${record.provider}` };
  return wakeForProbe({
    pane: record.pane,
    adapter,
    format: composerFormat(adapter, tmuxFailureTrigger(adapter)),
    binding: record.binding,
    text: `AO_PROBE ${nonce} — prove you are listening by running: ao-topology lead ack ${nonce} --consumer ${record.consumer}`,
    log,
  });
}

function resolveProbes(probes, { registryDir, log }) {
  return {
    alive: probes?.alive ?? defaultAlive,
    responsive: probes?.responsive ?? ((record, ackTimeoutMs) => defaultResponsive(record, ackTimeoutMs, { registryDir, log })),
    open: probes?.open ?? ((args) => openRoleSession(args)),
    pane: probes?.pane ?? defaultPane,
    kill: probes?.kill ?? (async (record) => {
      invariant(record.binding && await defaultAlive(record), "TOPOLOGY_LEAD_OWNERSHIP_UNKNOWN", "Exact managed pane incarnation is absent or changed; refusing termination.");
      await tmux.tmux(["kill-pane", "-t", record.binding.paneId], { tmuxServer: record.binding.serverKey });
    }),
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * The lead's standing for this repository: { identity, record, status, library_lead }.
 * status is one of "none" | "registered" | "alive-unresponsive"... no — exactly:
 *   "none"         no registration record
 *   "registered"   a record exists but nothing is running
 *   "unresponsive" a session/pane is alive but did not acknowledge the nonce probe
 *   "responsive"   alive AND acknowledged
 * The library lead's presence rides alongside as `library_lead` rather than folding into status:
 * the enum describes the session lifecycle, and a record whose library agent was deleted is a
 * store problem that ensureLead must fail loudly on — not a fifth state callers would have to
 * guess at.
 */
export async function leadState({ consumer, home = homedir(), env = process.env, pluginRoot = null, ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS, probes = null, log = () => {} }) {
  const identity = await canonicalRepoId(consumer);
  const registration = await readLeadRegistration({ consumer, env, home });
  const libraryLead = await findLead(agentDirs({ pluginRoot, consumer, home }));
  if (!registration) return { identity, record: null, status: "none", library_lead: libraryLead?.id ?? null };
  const p = resolveProbes(probes, { registryDir: leadRegistryDir(env, home), log });
  const { record } = registration;
  let status;
  if (!(await p.alive(record))) {
    status = "registered";
  } else {
    status = (await p.responsive(record, ackTimeoutMs)) ? "responsive" : "unresponsive";
  }
  return { identity, record, status, library_lead: libraryLead?.id ?? null };
}

// ── Creation and launch helpers ──────────────────────────────────────────────

/**
 * Mint the library lead agent from configuration — template, provider and model all come from the
 * merged config layers (config.lead.template / config.lead.provider / config.lead.model over the
 * template's own cli/model). Nothing about the lead's CLI is hardcoded here; the plugin defaults
 * ship a template precisely so this stays data.
 */
async function createLeadAgent({ consumer, home, pluginRoot, env }) {
  const loaded = await loadConfig({ consumer, home, pluginRoot, env });
  const templateName = loaded.config.lead?.template ?? null;
  const found = findTemplate(loaded.layers, templateName);
  if (!found) {
    fail(
      "TOPOLOGY_LEAD_TEMPLATE_MISSING",
      templateName
        ? `The configured lead template "${templateName}" is not defined in any config layer.`
        : `No lead template is configured. Set "lead.template" in a config layer (the plugin defaults ship "lead-default").`,
      { template: templateName },
    );
  }
  const leadConfig = loaded.config.lead ?? {};
  const template = found.template;
  const spec = {
    role: "lead",
    template: found.name,
    cli: leadConfig.provider ?? template.cli,
    model: leadConfig.model ?? template.model,
    skills: template.skills,
    mcp: template.mcp,
    args: template.args,
    env: template.env,
    auto_approve: template.auto_approve,
    instructions: template.instructions,
    reports_to: template.reports_to,
  };
  if (typeof template.name === "string" && template.name) spec.full_name = template.name;
  const agent = await createAgent(consumer, spec, null, { home, pluginRoot, env });
  // The prompt is composed through the ONE resolver and written where every other surface reads
  // it: the agent directory's prompt.md.
  const composed = await composePrompt({ agent, consumer, dir: agent._dir, loaded, templateName: found.name });
  invariant(composed.ok, "TOPOLOGY_PROMPT_INVALID", "Lead prompt is invalid; refusing launch.", { errors: composed.errors });
  await writeText(join(agent._dir, "prompt.md"), composed.text);
  return agent;
}

/**
 * Open (or reattach) the lead's durable role-session. Mirrors `ao-topology session open`: the
 * session's cwd is the agent's own directory, and a coordinator is granted nothing beyond it.
 * AO_LEAD_ID rides in the environment — that is the recursion guard ensureLead checks first.
 */
async function openLeadSession({ agent, consumer, pluginRoot, home, env, log, open }) {
  const prompt = await refreshPrompt({ agent, consumer, pluginRoot, home, env });
  invariant(prompt.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", `Invalid lead prompt; refusing restart.${promptErrorDetail(prompt.errors)}`, { errors: prompt.errors ?? [] });
  const adapters = await loadAdapters(providerDirs({ pluginRoot, consumer, home }));
  const adapter = adapterFor(agent, adapters);
  const session = roleSessionName(agent.id);
  const addDirs = agent.coordinates_only === true ? [] : [consumer];
  const vars = {
    session,
    agent_id: agent.id,
    agent_role: agent.role,
    bootstrap_file: join(agent._dir, "prompt.md"),
    system_prompt: `You are ${displayName(agent)} (id "${agent.id}", role: ${agent.role}), the standing ${agent.role} for ${consumer}. Read ${join(agent._dir, "prompt.md")} and follow it.`,
  };
  const argv = buildArgv(adapter, { ...agent, add_dirs: addDirs }, vars);
  const opened = await open({
    agentsDir: dirname(agent._dir),
    agentId: agent.id,
    adapter,
    argv,
    env: {
      AO_AGENT_ID: agent.id,
      AO_AGENT_ROLE: agent.role,
      AO_SESSION: session,
      AO_CONSUMER: consumer,
      AO_LEAD_ID: agent.id,
      ...agent.env,
      AO_AGENT_ID: agent.id, AO_LEAD_ID: agent.id, AO_CONSUMER: consumer,
    },
    role: agent.role,
    log,
  });
  return { session: opened.session ?? session, pane: opened.pane ?? null, binding: opened.binding ?? null, provider: adapter.id };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Converge on ONE living lead for this repository. Serialized on a filesystem lock because several
 * startups race here and there is no daemon to arbitrate — the lock is what makes six concurrent
 * calls produce one session, not six.
 *
 * Actions: "self" (AO_LEAD_ID is set — we ARE the lead), "reused" (registered and responsive),
 * "kept-unresponsive" (alive but unacknowledged — left exactly as found), "restarted" (dead,
 * managed: relaunched under the same agent id and role-session name), "dead-external" (dead,
 * externally owned: reported, never recreated), "created" (no record: library lead found or minted
 * from config, session opened, record written).
 */
export async function ensureLead({ consumer, home = homedir(), pluginRoot = null, env = process.env, log = () => {}, ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS, probes = null, restartRequiresBinding = false }) {
  invariant(consumer && typeof consumer === "string", "TOPOLOGY_LEAD_CONSUMER_REQUIRED", "ensureLead needs the consumer repository path.");
  const identity = await canonicalRepoId(consumer);
  if (env?.AO_LEAD_ID && env?.AO_CONSUMER && (await canonicalRepoId(env.AO_CONSUMER)).id === identity.id) return { action: "self", lead_id: env.AO_LEAD_ID };
  const key = repoKey(identity.id);
  const registryDir = leadRegistryDir(env, home);
  await mkdir(registryDir, { recursive: true });
  const { recordPath, lockPath } = registryPaths(registryDir, key);
  const p = resolveProbes(probes, { registryDir, log });

  const decided = await withLock(lockPath, async () => {
    if (await exists(recordPath)) {
      const record = await readJson(recordPath);
      // TM-167. A live lead leaves the lock BEFORE it is probed. The probe can wait a model turn
      // (30s by default) and withLock's own timeout is also 30s, so probing in here made every
      // concurrent ensure behind it time out. Nothing below the probe mutates the registry — reused
      // and kept-unresponsive both leave it as found — so the lock has nothing left to protect.
      if (await p.alive(record)) return { probe: record };
      if (!record.managed || record.externally_owned) {
        // Someone else's session died. Recreating it would spawn a process we have no right to
        // create under an identity a human owns; report and stop.
        return { action: "dead-external", record };
      }
      // TM-167. An unattended restart needs proof that the RECORDED incarnation is gone. A record
      // with no six-tuple binding was judged dead by a session-name lookup on the default server,
      // which cannot tell "gone" from "on another server"; restarting on that would duplicate it.
      invariant(!restartRequiresBinding || record.binding, "TOPOLOGY_LEAD_OWNERSHIP_UNKNOWN",
        `The lead record names no exact pane incarnation, so its absence cannot be proven; refusing an unattended restart. Restart it deliberately with: ao-topology lead ensure --consumer ${consumer}`);
      const dirs = agentDirs({ pluginRoot, consumer, home });
      const agent = await requireAgent(record.agent_id, agentDirs({ pluginRoot, consumer: record.consumer || consumer, home })).catch(() => {
        fail(
          "TOPOLOGY_LEAD_AGENT_MISSING",
          `The registered lead agent "${record.agent_id}" is gone from the library, so the lead cannot be restarted under the same identity. Restore the agent or detach the registration (${recordPath}) and ensure again.`,
          { agent_id: record.agent_id },
        );
      });
      const opened = await openLeadSession({ agent, consumer, pluginRoot, home, env, log, open: p.open });
      const updated = { ...record, session: opened.session, pane: opened.pane, binding: opened.binding, provider: opened.provider, updated_at: nowIso() };
      await writeJson(recordPath, updated);
      return { action: "restarted", record: updated, session: opened.session, pane: opened.pane };
    }

    let agent = await findLead(agentDirs({ pluginRoot, consumer, home }));
    let agentCreated = false;
    if (!agent) {
      agent = await createLeadAgent({ consumer, home, pluginRoot, env });
      agentCreated = true;
    }
    const opened = await openLeadSession({ agent, consumer, pluginRoot, home, env, log, open: p.open });
    const now = nowIso();
    const record = {
      version: RECORD_VERSION,
      repo_id: identity.id,
      agent_id: agent.id,
      agent_name: agent.full_name ?? displayName(agent),
      mode: "dedicated",
      managed: true,
      externally_owned: false,
      session: opened.session,
      pane: opened.pane,
      binding: opened.binding,
      provider: opened.provider,
      created_at: now,
      updated_at: now,
      consumer,
      consumers: [],
    };
    await writeJson(recordPath, record);
    return { action: "created", agent_created: agentCreated, record, session: opened.session, pane: opened.pane };
  });
  if (!decided.probe) return decided;
  const record = decided.probe;
  if (await p.responsive(record, ackTimeoutMs)) return { action: "reused", record };
  // Alive but unanswered. The agent may be mid-task; doing nothing is the correct action, and doing
  // anything else — killing, respawning, opening a second session — is how one repo ends up with two
  // leads.
  return { action: "kept-unresponsive", record };
}

/**
 * Enroll an EXISTING live session as this repository's lead. This is a handshake, not a launch:
 * the session must already be running, and enrollment changes nothing about it — same process,
 * same cwd, same grants, same conversation. The record says so explicitly (privileges:
 * "unchanged") because the entire point is that a human's session keeps being theirs.
 */
export async function assignLead({ consumer, agentRef, session: existingSession = null, ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS, home = homedir(), pluginRoot = null, env = process.env, log = () => {}, probes = null }) {
  invariant(agentRef, "TOPOLOGY_LEAD_AGENT_REQUIRED", "Name the agent whose live session becomes the lead: assignLead needs an agent reference.");
  const identity = await canonicalRepoId(consumer);
  const key = repoKey(identity.id);
  const registryDir = leadRegistryDir(env, home);
  await mkdir(registryDir, { recursive: true });
  const { recordPath, lockPath } = registryPaths(registryDir, key);
  const p = resolveProbes(probes, { registryDir, log });

  return withLock(lockPath, async () => {
    const agent = await requireAgent(agentRef, agentDirs({ pluginRoot, consumer, home }));
    const session = existingSession || roleSessionName(agent.id);
    const previous = (await exists(recordPath)) ? await readJson(recordPath) : null;
    invariant(!previous || previous.agent_id === agent.id, "TOPOLOGY_LEAD_ALREADY_ASSIGNED", "Detach the existing lead before assigning a different identity.");
    const candidate = { session, pane: null, agent_id: agent.id, repo_id: identity.id };
    invariant(
      await p.alive(candidate),
      "TOPOLOGY_LEAD_NOT_ALIVE",
      `${displayName(agent)} has no live session (${session}). Assignment is a handshake with a RUNNING session — open one first; enrollment never spawns it for you.`,
      { agent_id: agent.id, session },
    );
    const pane = await p.pane(candidate);
    const otherLead = await findLead(agentDirs({ pluginRoot, consumer, home }));
    invariant(!otherLead || otherLead.id === agent.id, "TOPOLOGY_MULTIPLE_LEADS", "Another library lead exists; reconcile it before promotion.");
    const binding = probes?.binding ? await probes.binding(candidate) : (await tmux.listServerPanes({ env })).find(p => p.paneId === pane && p.sessionName === session) || null;
    invariant(probes || binding, "TOPOLOGY_LEAD_BINDING_REQUIRED", "Assignment needs exact observed session binding.");
    candidate.pane = pane;
    invariant(await p.responsive(candidate, ackTimeoutMs), "TOPOLOGY_LEAD_HANDSHAKE_REQUIRED", "Assignment requires an acknowledged nonce handshake; the existing session was preserved.");
    const now = nowIso();
    const record = {
      version: RECORD_VERSION,
      repo_id: identity.id,
      agent_id: agent.id,
      agent_name: agent.full_name ?? displayName(agent),
      mode: "assigned",
      managed: false,
      externally_owned: true,
      session,
      pane,
      binding,
      provider: agent.cli ?? null,
      created_at: previous?.created_at ?? now,
      updated_at: now,
      consumer,
      consumers: previous?.consumers ?? [],
    };
    await writeJson(agent._file, { ...Object.fromEntries(Object.entries(agent).filter(([key]) => !key.startsWith('_'))), role: 'lead' });
    await writeJson(recordPath, record);
    return {
      action: "assigned",
      record,
      privileges: "unchanged",
      preserved: { conversation: true, task: "kept", cwd: "kept" },
    };
  });
}

/**
 * Remove the lead registration. Detaching is about the RECORD, not the session: an externally
 * owned pane is never killed here, and a managed dedicated session is killed only when the caller
 * passes { kill: true } — the default ends the registration, not the conversation.
 */
export async function detachLead({ consumer, env = process.env, home = homedir(), kill = false, probes = null, log = () => {} }) {
  const registryDir = leadRegistryDir(env, home);
  const registration = await readLeadRegistration({ consumer, env, home });
  if (!registration) return { action: "absent", detached: false };
  const { recordPath, lockPath } = registryPaths(registryDir, registration.key);
  const p = resolveProbes(probes, { registryDir, log });

  return withLock(lockPath, async () => {
    if (!(await exists(recordPath))) return { action: "absent", detached: false };
    const record = await readJson(recordPath);
    let killed = false;
    if (!record.externally_owned && record.managed && kill === true) {
      await p.kill(record);
      killed = true;
    }
    await rm(recordPath, { force: true });
    return { action: "detached", detached: true, record, killed };
  });
}

/**
 * The agent's half of the liveness probe: write the ack file a pending probe is waiting on. The
 * probe file must exist — acknowledging a probe nobody asked about is almost certainly a mistyped
 * nonce, and saying so beats silently writing a file nothing will ever read.
 */
export async function leadNonceAck({ consumer, nonce, env = process.env, home = homedir() }) {
  invariant(
    NONCE_PATTERN.test(String(nonce ?? "")),
    "TOPOLOGY_LEAD_PROBE_INVALID",
    `A probe nonce is letters, digits and dashes; got ${JSON.stringify(nonce)}.`,
  );
  const identity = await canonicalRepoId(consumer);
  const dir = join(leadRegistryDir(env, home), "probes");
  const probePath = join(dir, `${nonce}.json`);
  invariant(
    await exists(probePath),
    "TOPOLOGY_LEAD_PROBE_UNKNOWN",
    `No pending probe ${nonce} for this repository — it may already have timed out.`,
    { nonce },
  );
  const probe = await readJson(probePath);
  invariant(probe.repo_id === identity.id && probe.agent_id === env.AO_AGENT_ID && probe.expires_at >= Date.now(), "TOPOLOGY_LEAD_PROBE_OWNER", "Probe must be acknowledged by its enrolled agent in the same repository before expiry.");
  const ackPath = join(dir, `${nonce}.ack.json`);
  await writeJson(ackPath, { nonce, repo_id: identity.id, agent_id: env.AO_AGENT_ID, created_at: nowIso() });
  return { ok: true, ack_path: ackPath };
}

/** Only metadata for this repository's agent; no terminal input is sent by probes. */
export async function pendingLeadProbes({ consumer, env = process.env, home = homedir() }) {
  const identity = await canonicalRepoId(consumer);
  const dir = join(leadRegistryDir(env, home), 'probes');
  const files = await readdir(dir).catch(() => []);
  const probes = await Promise.all(files.filter(name => name.endsWith('.json') && !name.endsWith('.ack.json')).map(name => readJson(join(dir,name)).catch(() => null)));
  return probes.filter(p => p && p.repo_id === identity.id && p.agent_id === env.AO_AGENT_ID && p.expires_at >= Date.now());
}
