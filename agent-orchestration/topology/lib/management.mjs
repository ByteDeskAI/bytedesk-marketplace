// Task-store-backed management. The task store owns claims, WIP and worktree provisioning;
// orchestration owns communication and the review/check/landing evidence it contributes.
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { callerServer, listServerPanes, tmux } from './tmux.mjs';
import { readCensus } from './census.mjs';
import { HEARTBEAT_TTL_MS, heartbeatDir } from './heartbeat.mjs';
import { AUTONOMY_LEVELS, loadConfig } from './config.mjs';
import { findActiveDelegation, managedSessionEvidence, requireLeadCaller } from './delegation.mjs';
import { agentDirs, findLead } from './agents.mjs';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, pinnedGithubRepo, repoKey, stateRoot } from './repoid.mjs';
import { finishCheckEvidence, githubCompare, reviewEligibility, reviewerAvailability, requestReview, reviewRangeBase } from './reviewer.mjs';
import { observeNativeWorkflow } from './workflow-control.mjs';
import { readStandingMessage, sendStandingMessage } from './standing-mailbox.mjs';
import { fail, invariant, nowIso, readJson, run, writeJson } from './util.mjs';
import { GH_PATHS, safeGit, trustedGh } from './safe-git.mjs';

const taskId = value => { invariant(/^TM-[0-9]+$/.test(value), 'TOPOLOGY_MANAGEMENT_TASK', 'Expected a task-store TM id.'); return value; };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.every(nonempty);
// TM-443: every git here runs through safe-git, so a worker's planted git config never runs as the lead.
const git = async (cwd, args, allowFailure = false) => safeGit(cwd, args, { allowFailure });
const gitText = async (cwd, args) => (await git(cwd, args)).stdout.trim();

/** Store paths the task store and orchestration write into the main checkout on their own.
 * Integration tolerates them being dirty and refuses any landing that would touch them.
 * Documented in docs/repository-leads.md; a change here changes that list. */
export const INTEGRATION_STORE_PATHS = Object.freeze(['.bytedesk/task-management/', '.bytedesk/agent-orchestration/agents/', '.bytedesk/knowledge/.km/']);
const storePath = path => INTEGRATION_STORE_PATHS.some(prefix => path.startsWith(prefix));
/** Dirty paths in the checkout other than the tools' own store paths (renames report both sides). */
export async function foreignDirtyPaths(cwd) {
  const fields = (await git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all'])).stdout.split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (/^[RC]/.test(entry)) paths.push(fields[++i]);
  }
  return paths.filter(path => path && !storePath(path));
}

/** TM-247 (AC9): is `head` a merge-in of the integration branch on top of the approved `revision`?
 * Exactly: a two-parent merge whose first parent IS the revision, whose second parent is on the
 * integration branch AS THE SERVER HAS IT (PR #226 review: never a local or remote-tracking ref, which
 * a worker writes; `gh api repos/<pinned>/compare/<parent>...<target>` must say ahead or identical),
 * and whose TREE is byte-for-byte the tree git itself computes
 * for that merge (`git merge-tree --write-tree <revision> <integration>`), so the merge added nothing
 * of its own. TM-441: never patch-id, which ignores whitespace (`rm -rf /tmp/build` and
 * `rm -rf / tmp/build` share one); a conflicted merge has no clean tree and is never a merge-in.
 * Returns { head, integration } or null. task-management governance-check.mjs mirrors it (no import
 * crosses the plugins); a conformance test runs both on one repository.
 * ponytail: one merge-in commit; a chain of merge-ins needs a walk down first parents. */
export async function mergeInOf(cwd, revision, head, target, { gh = defaultGh(cwd), env = process.env, home = homedir() } = {}) {
  if (!nonempty(head) || !nonempty(revision) || head === revision || !nonempty(target)) return null;
  const parents = (await git(cwd, ['rev-list', '--parents', '-n', '1', head], true)).stdout.trim().split(' ').slice(1);
  if (parents.length !== 2 || parents[0] !== revision) return null;
  const integration = parents[1];
  if (!await onServerBranch(gh, cwd, integration, target, { env, home })) return null;
  const merged = await git(cwd, ['merge-tree', '--write-tree', revision, integration], true);
  const expected = merged.code === 0 ? merged.stdout.split('\n')[0].trim() : '';
  const actual = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${head}^{tree}`], true)).stdout.trim();
  return expected && expected === actual ? { head, integration } : null;
}

/** TM-430: a worker's check runs, labelled as what they are. They are self-reported, so the review
 * packet shows them as CLAIMED (command and log prefixed) and they never satisfy a required check:
 * only the host's own run of the configured argv does (runRequiredChecks, in both integrate paths).
 * Every automatic review request (manage report, retry-review, the supervisor sweep) goes through here. */
export const CLAIMED = '[claimed by the worker; not run by the host]';
export function claimedCheckEvidence(report) {
  return finishCheckEvidence(report).map(check => ({ ...check, command: `${CLAIMED} ${check.command}`.trim(), log_tail: `${CLAIMED}\n${check.log_tail}` }));
}

/** TM-430: review reasons about check EVIDENCE in the review packet. The packet holds worker claims and
 * lead-supplied runs, so integration never treats it as a check result: integrate runs the configured
 * argv itself. These reasons stay visible as `claimed_check_reasons` on the gate. */
const CHECK_EVIDENCE_REASON = /^(required check |no check evidence is recorded for revision )/;

/** PR #226 review: is `sha` on `branch` of the PINNED repository on the server? Read through gh's compare
 * API (`ahead` or `identical` from sha to branch); any failure, an unpinned or repointed repository, or
 * another status is no. task-management governance-check.mjs `onServerBranch` mirrors it. */
export async function onServerBranch(gh, repoDir, sha, branch, options = {}) {
  return ['ahead', 'identical'].includes((await serverCompareStatus(gh, repoDir, sha, branch, options)).status);
}

/** { status } of `repos/<pinned>/compare/<sha>...<branch>` on the server, or { status: null, reason }. */
export async function serverCompareStatus(gh, repoDir, sha, branch, { env = process.env, home = homedir() } = {}) {
  if (!/^[0-9a-f]{40,64}$/.test(String(sha)) || !nonempty(branch)) return { status: null, reason: 'no commit or branch to compare' };
  let repo;
  try { ({ repo } = await pinnedGithubRepo(repoDir, gh, { env, home })); } catch (error) { return { status: null, reason: error.message }; }
  const compared = await ghJson(gh, ['api', `repos/${repo}/compare/${sha}...${encodeURIComponent(branch)}`]);
  return compared.code === 0 && typeof compared.value?.status === 'string' ? { status: compared.value.status, repo } : { status: null, reason: ghFailure(`gh api compare on ${repo}`, compared) };
}

/** Execute the repository's existing tm launcher, never a second provisioner or a shell. */
export async function taskStore({ consumer, owner = null, env = process.env, tmBin = null }) {
  const identity = await canonicalRepoId(consumer);
  invariant(identity.kind === 'git-common-dir', 'TOPOLOGY_MANAGEMENT_REPO', 'Management requires a Git repository.');
  const entries = (await gitText(consumer, ['worktree', 'list', '--porcelain'])).split('\n\n');
  const main = entries.find(entry => !entry.split('\n').includes('bare'));
  const root = main?.match(/^worktree (.+)$/m)?.[1];
  invariant(root && isAbsolute(root), 'TOPOLOGY_MANAGEMENT_REPO', 'No non-bare checkout exists for the task store.');
  const bin = tmBin || join(root, '.bytedesk/task-management/bin/tm');
  invariant(isAbsolute(bin), 'TOPOLOGY_MANAGEMENT_TM', 'tm launcher must be absolute.');
  const exec = async (args, cwd = root, extra = {}) => run(bin, args, { cwd, env: { ...env, TM_ROOT: root, CLAUDE_PROJECT_DIR: cwd, ...(owner ? { TM_SESSION_ID: owner } : {}), ...extra } });
  const where = JSON.parse((await exec(['where'])).stdout);
  invariant(isAbsolute(where.store), 'TOPOLOGY_MANAGEMENT_STORE', 'tm did not identify its task store.');
  return {
    root,
    workers: async () => Object.values((await readJson(join(where.store, 'agents.json')).catch(error => { if (error.code === 'ENOENT') return { agents: {} }; throw error; })).agents || {}),
    show: async id => JSON.parse((await exec(['show', taskId(id), '--json'])).stdout),
    claim: async id => {
      const { resolveTransport } = await import('./orch-transport.mjs');
      const transport = await resolveTransport({ env });
      return transport.getClaim({ repo: repoKey(identity.id), task: taskId(id), storeDir: where.store });
    },
    provision: async id => exec(['worktree', 'new', taskId(id)]),
    start: async (id, cwd) => exec(['start', taskId(id)], cwd),
    comment: async (id, value) => exec(['comment', taskId(id), value]),
    evidence: async (id, path) => exec(['evidence', taskId(id), path]),
    removeWorktree: async id => exec(['worktree', 'rm', taskId(id)]),
    // TM-218: the lead's one launcher. tm claims under TM_SESSION_ID=owner, reuses the admitted
    // worktree, spawns the backend, and writes the dispatch + registry row observeWorker reads.
    dispatch: async (id, backend) => JSON.parse((await exec(['dispatch', taskId(id), '--backend', backend, '--json'])).stdout),
    // TM-247 (AC7): move the claim to a new admission owner; --steal only from the recorded owner.
    claimFor: async (id, session, cwd, steal) => exec(['claim', taskId(id), ...(steal ? ['--steal'] : [])], cwd, { TM_SESSION_ID: session }),
    // TM-247: record a dead worker's result through tm's one write path (park rules, task_result event).
    collect: async id => JSON.parse((await exec(['collect', taskId(id), '--json'])).stdout),
    // TM-249: manage integrate closes as the grant's actor; tm stamps the done event from TM_ACTOR.
    done: async (id, actor = null) => exec(['done', taskId(id)], root, actor ? { TM_ACTOR: actor } : {}),
    govern: async (id, governance) => exec(['govern',taskId(id),'--workflow',governance.workflowRunId,'--lead',governance.leadId,'--record',governance.recordPath]),
    reviewReady: async (id, revision) => exec(['review-ready',taskId(id),'--revision',revision]),
    // TM-248: read-only; a plan grant freezes this list at grant time.
    epicTasks: async epic => JSON.parse((await exec(['find', `epic:${epic}`, 'kind:task', '--json'])).stdout).filter(t => t.epic === epic).map(t => t.id),
    // TM-368: report a cross-repo ticket's progress to its origin (TM-359's `tm ticket event`).
    ticketEvent: async (id, kind, detail) => exec(['ticket', 'event', taskId(id), kind, detail]),
  };
}

async function context(options) {
  const { consumer, env = process.env, home = homedir() } = options;
  const identity = await canonicalRepoId(consumer);
  const root = join(stateRoot(env, home), 'management', repoKey(identity.id));
  const path = join(root, `${taskId(options.task)}.json`);
  const store = options.store || await taskStore(options);
  return { root, path, store, identity, env, home };
}
const loadRecord = async path => readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
async function recordEvent(ctx, task, prior, event, details) {
  const entry = { event, at: nowIso(), ...details };
  // Comment first: a failed task-store write must never claim the lead received the protocol.
  await ctx.store.comment(task, JSON.stringify(entry));
  const next = { ...prior, task, repo_id: ctx.identity.id, events: [...(prior?.events || []), entry], updated_at: entry.at };
  await writeJson(ctx.path, next);
  return next;
}
/** TM-368: append one event to a task's management record (comment first, as recordEvent does) and
 * merge `patch` into the record. Refuses a task with no record: there is nothing to attach it to. */
export async function recordTaskEvent(options, event, details, patch = {}) {
  const ctx = await context(options), record = await loadRecord(ctx.path);
  invariant(record, 'TOPOLOGY_MANAGEMENT_PROTOCOL', `${options.task} has no management record to attach ${event} to.`);
  const next = Object.assign(await recordEvent(ctx, options.task, record, event, details), patch);
  await writeJson(ctx.path, next);
  return next;
}
/** TM-247: the refusal names the step that recovers. `released` admits a claim nobody holds (a retire
 * of a dead worker whose task was parked or blocked); a claim held by another session never passes. */
function ownClaim(claim, owner, task, { released = false, holders = [] } = {}) {
  if (!claim && released) return;
  if (claim && holders.includes(claim.session)) return;
  invariant(claim, 'TOPOLOGY_MANAGEMENT_OWNERSHIP', `Task claim for ${task} was released (the task was parked, blocked or collected), so its admission owner ${owner} holds nothing. Re-claim it with \`ao-topology manage admit --task ${task}\`, which resumes the same admission, then retry.`);
  invariant(claim.session === owner, 'TOPOLOGY_MANAGEMENT_OWNERSHIP', `Task claim for ${task} is held by ${claim.session ?? 'an unowned session'}, not the admission owner ${owner}; reconcile ownership without stealing, or record a handoff with \`ao-topology manage transfer --task ${task}\`.`);
}
async function ownedTask(ctx, task, owner, claimRule = {}) {
  const doc = await ctx.store.show(task);
  ownClaim(await ctx.store.claim(task), owner, task, claimRule);
  invariant(doc.worktree && doc.branch, 'TOPOLOGY_MANAGEMENT_WORKTREE', 'tm must provision and record the task worktree and branch.');
  invariant((await canonicalRepoId(doc.worktree)).id === ctx.identity.id && await realpath(doc.worktree) !== await realpath(ctx.store.root), 'TOPOLOGY_MANAGEMENT_WORKTREE', 'Task worktree must be isolated within this repository.');
  invariant(await gitText(doc.worktree, ['symbolic-ref', '--short', 'HEAD']) === doc.branch, 'TOPOLOGY_MANAGEMENT_BRANCH', 'Task worktree branch differs from the task store.');
  return doc;
}

const bindingKeys = ['serverKey', 'serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'];
async function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    return { start: raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19], boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), cwd: await realpath(`/proc/${pid}/cwd`) };
  } catch { return null; }
}
function processGone(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}
async function registeredWorker(ctx, doc, owner, claimRule = {}) {
  ownClaim(await ctx.store.claim(doc.id), owner, doc.id, claimRule);
  invariant(doc.dispatched?.run && doc.dispatched.session === owner, 'TOPOLOGY_MANAGEMENT_WORKER', 'Task dispatch must name the claim owner and worker run.');
  invariant(typeof ctx.store.workers === 'function', 'TOPOLOGY_MANAGEMENT_WORKER', 'Task store has no worker registry adapter.');
  const rows = (await ctx.store.workers()).filter(row => row.session === owner && row.runId === doc.dispatched.run && row.backend === doc.dispatched.backend);
  invariant(rows.length === 1, 'TOPOLOGY_MANAGEMENT_WORKER', 'Exactly one task-store worker must match the dispatch and claim.');
  return rows[0];
}

// Native identity comes from the producer's authenticated records and exact observations.
// Exclude changing liveness and record paths: an exact member can exit, and a legacy record
// can move into durable storage, without becoming a different task writer.
function nativeWriterIdentity(observation) {
  invariant(observation && typeof observation.runId === 'string' && Array.isArray(observation.agents) && Array.isArray(observation.children),
    'TOPOLOGY_MANAGEMENT_WORKER', 'Native producer returned incomplete workflow ownership.');
  return {
    run_id: observation.runId,
    repository_id: observation.repositoryId,
    task_id: observation.taskId ?? null,
    parent_agent_id: observation.parentAgentId ?? null,
    workload_cwd: observation.workloadCwd,
    write_authority: observation.writeAuthority ?? null,
    members: observation.agents.map(member => ({ id: member.id, pane: member.pane ?? null,
      binding: member.binding ? Object.fromEntries(bindingKeys.map(key => [key, member.binding[key]])) : null })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    children: observation.children.map(nativeWriterIdentity).sort((left, right) => left.run_id.localeCompare(right.run_id)),
  };
}

async function observedNativeWorker(ctx, doc) {
  const dispatched = doc.dispatched;
  invariant(typeof dispatched?.nativeRunId === 'string' && isAbsolute(dispatched.recordPath || '') && basename(dispatched.recordPath) === 'run.json',
    'TOPOLOGY_MANAGEMENT_WORKER', 'Topology dispatch needs its authentic native run ID and record path; reconcile the task through tm collect before reporting a finish.');
  invariant(!dispatched.workflowRunId || dispatched.workflowRunId === `topology:${dispatched.nativeRunId}`,
    'TOPOLOGY_MANAGEMENT_WORKER', 'Canonical workflow and native task run IDs differ.');
  const observation = await observeNativeWorkflow({ consumer: ctx.store.root, runDir: dirname(dispatched.recordPath),
    nativeRunId: dispatched.nativeRunId, taskId: doc.id, workloadCwd: doc.worktree, stateHome: stateRoot(ctx.env, ctx.home) });
  invariant(observation.runId === dispatched.nativeRunId && observation.observationError === null && typeof observation.hasLiveWriters === 'boolean' && typeof observation.fingerprint === 'string',
    'TOPOLOGY_MANAGEMENT_WORKER', 'Native producer could not establish every task writer incarnation.');
  return { observation, identity: nativeWriterIdentity(observation) };
}

async function observeWorker(ctx, doc, owner) {
  const row = await registeredWorker(ctx, doc, owner);
  const base = { name: row.name, run: row.runId, backend: row.backend, owner, registered_at: row.registeredAt, observed_at: nowIso() };
  if (row.backend === 'topology') {
    const { observation, identity } = await observedNativeWorker(ctx, doc);
    return { ...base, kind: 'topology', native_run_id: observation.runId, record_path: join(observation.runDir, 'run.json'), native_fingerprint: observation.fingerprint, native_identity: identity };
  }
  invariant(row.status === 'active', 'TOPOLOGY_MANAGEMENT_WORKER', 'Only a currently live registered worker can establish a new ownership binding.');
  if (row.backend === 'tmux') {
    const prefix = `${row.backend}:`;
    invariant(row.runId.startsWith(prefix), 'TOPOLOGY_MANAGEMENT_WORKER', 'Invalid task worker session handle.');
    const session = row.runId.slice(prefix.length);
    // TM-167: the worker's named session, not the whole implicit server. The registry row records no
    // server, so the SERVER here is still implicit ($TMUX or the default socket); the realpath check on
    // the pane's cwd below is what refuses a same-named session on some other server.
    const panes = (await listServerPanes({ session, env: ctx.env })).filter(p => p.sessionName === session && p.alive);
    invariant(panes.length === 1 && await realpath(panes[0].cwd) === await realpath(doc.worktree), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker must have one observed live pane in its task-owned worktree; unknown or multi-pane ownership needs explicit reconciliation.');
    return { ...base, kind: 'tmux', session_name: session, binding: Object.fromEntries(bindingKeys.map(key => [key, panes[0][key]])) };
  }
  const process = await processStart(row.pid);
  invariant(process && process.cwd === await realpath(doc.worktree), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker PID must be observed alive in the task-owned worktree.');
  return { ...base, kind: 'process', pid: row.pid, process_start: process.start, boot: process.boot };
}

/** A pane is idle only when its own process is a shell with no children: the harness exited.
 * Reads /proc, so it is Linux-only: elsewhere a live pane is never idle and is never closed.
 * A harness running as the pane process itself is never idle while alive; unreadable is not idle. */
const SHELLS = new Set(['bash', 'zsh', 'sh', 'dash', 'fish', 'ksh']);
async function idleShell(pid) {
  try {
    const comm = (await readFile(`/proc/${pid}/comm`, 'utf8')).trim();
    return SHELLS.has(comm) && (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim() === '';
  } catch { return false; }
}

/** A login shell (argv0 "-zsh", or -l/--login) is an operator's terminal. Unreadable is refused. */
async function loginShell(pid) {
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    return !argv.length || argv[0].startsWith('-') || argv.slice(1).some(arg => arg === '-l' || arg === '--login');
  } catch { return true; }
}

/** TM-218: a worker the lead started before this verb existed, proved from the live pane or process.
 * Fails closed on an unnamed server, a dead/unknown pane, a shared session, the caller itself, a
 * process outside the task worktree, or a pane/pid another task's record already binds. */
async function observeAdoptedWorker(ctx, doc, options) {
  const worktree = await realpath(doc.worktree), base = { name: `adopted:${doc.id}`, owner: options.owner, adopted: true, observed_at: nowIso() };
  const others = [];
  for (const name of (await readdir(ctx.root).catch(() => [])).filter(n => /^TM-[0-9]+\.json$/.test(n) && n !== `${doc.id}.json`)) {
    const other = await readJson(join(ctx.root, name)).catch(() => null);
    if (other?.worker && other.state !== 'cleaned') others.push(other.worker);
  }
  if (options.pane) {
    const server = options.tmuxServer || callerServer(ctx.env);
    invariant(server, 'TOPOLOGY_MANAGEMENT_WORKER', 'Name the tmux server (--server <socket>) or run inside it; a pane id means nothing on an implicit server.');
    invariant(options.pane !== ctx.env.TMUX_PANE, 'TOPOLOGY_MANAGEMENT_WORKER', 'Refusing to bind the calling pane as its own worker.');
    const panes = await listServerPanes({ tmuxServer: server, env: ctx.env });
    const pane = panes.find(p => p.paneId === options.pane && p.alive);
    invariant(pane && await realpath(pane.cwd).catch(() => null) === worktree, 'TOPOLOGY_MANAGEMENT_WORKER', 'Pane must be observed alive in the task-owned worktree.');
    invariant(panes.filter(p => p.alive && p.sessionId === pane.sessionId).length === 1, 'TOPOLOGY_MANAGEMENT_WORKER', 'Adopted pane must be the only live pane in its session; multi-pane ownership needs explicit reconciliation.');
    // Adopting a pane authorizes stop-worker and cleanup to close it, so an operator's own shell is
    // never adoptable: the session must postdate admission and the pane must not be a login shell.
    const admitted = Date.parse([...(options.record?.events || [])].reverse().find(e => e.event === 'start')?.at || '');
    invariant(Number.isFinite(admitted) && pane.sessionCreated >= Math.floor(admitted / 1000), 'TOPOLOGY_MANAGEMENT_WORKER', 'Adopted session must have been created after the task was admitted.');
    invariant(!(await loginShell(pane.panePid)), 'TOPOLOGY_MANAGEMENT_WORKER', 'Pane process is an interactive login shell, not a worker; refusing to adopt a session stop-worker would then close.');
    const binding = Object.fromEntries(bindingKeys.map(key => [key, pane[key]]));
    invariant(!others.some(w => w.binding?.serverKey === binding.serverKey && w.binding?.paneId === binding.paneId), 'TOPOLOGY_MANAGEMENT_WORKER', 'Pane is already bound to another task.');
    return { ...base, run: `tmux:${pane.sessionName}`, backend: 'tmux', kind: 'tmux', session_name: pane.sessionName, binding };
  }
  const pid = Number(options.pid);
  invariant(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid && pid !== process.ppid, 'TOPOLOGY_MANAGEMENT_WORKER', 'Bind an existing worker with --pane <id> or --pid <pid> (not the caller).');
  const observed = await processStart(pid);
  invariant(observed && observed.cwd === worktree, 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker PID must be observed alive in the task-owned worktree.');
  invariant(!others.some(w => w.pid === pid && w.process_start === observed.start), 'TOPOLOGY_MANAGEMENT_WORKER', 'Process is already bound to another task.');
  return { ...base, run: `process:${pid}`, backend: 'process', kind: 'process', pid, process_start: observed.start, boot: observed.boot };
}

/** Bind observed ownership after tm dispatch, without trusting caller-supplied pid/idle flags.
 * With --pane/--pid and no tm dispatch, adopt a worker the lead already started (TM-218). */
export async function bindTaskWorker(options) {
  const ctx = await context(options);
  return withLock(`${ctx.path}.lock`, async () => {
    const prior = await loadRecord(ctx.path);
    invariant(prior?.started && prior.owner === options.owner, 'TOPOLOGY_MANAGEMENT_WORKER', 'Admit the task and reconcile ownership before binding a worker.');
    const doc = await ownedTask(ctx, options.task, options.owner);
    const adopt = Boolean(options.pane || options.pid);
    invariant(!adopt || !doc.dispatched, 'TOPOLOGY_MANAGEMENT_WORKER', 'Task has a tm dispatch; bind it without --pane/--pid so the registry row is verified.');
    const worker = adopt ? await observeAdoptedWorker(ctx, doc, { ...options, record: prior }) : await observeWorker(ctx, doc, options.owner);
    // A stopped worker is history: the next round's worker replaces it (TM-218 review round 1).
    if (prior.worker?.stopped_at) { prior.previous_workers = [...(prior.previous_workers || []), prior.worker]; delete prior.worker; }
    invariant(!prior.worker || JSON.stringify({ ...prior.worker, observed_at: null }) === JSON.stringify({ ...worker, observed_at: null }), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker incarnation changed; preserve work and reconcile rather than rebinding a successor.');
    const record = await recordEvent(ctx, options.task, prior, 'worker-bound', { worker, workflow_run_id: prior.workflow_run_id ?? null });
    record.worker = worker; await writeJson(ctx.path, record);
    return { bound: true, worker };
  });
}

/** TM-218: the lead's one supported worker launch for an admitted task: tm dispatch, then bind.
 * A launched worker that cannot be bound yet is reported, never relaunched. */
export async function startTaskWorker(options) {
  const ctx = await context(options), backend = options.backend || 'tmux';
  invariant(['tmux', 'topology'].includes(backend), 'TOPOLOGY_MANAGEMENT_WORKER', 'start-worker supports --backend tmux or topology; both leave an observable worker to bind.');
  const dispatched = await withLock(`${ctx.path}.lock`, async () => {
    const prior = await loadRecord(ctx.path);
    invariant(prior?.started && prior.owner === options.owner, 'TOPOLOGY_MANAGEMENT_WORKER', 'Admit the task with manage admit before starting its worker.');
    invariant(!prior.worker || prior.worker.stopped_at, 'TOPOLOGY_MANAGEMENT_WORKER', 'Task already has a bound worker; a second writer is refused. Stop it with manage stop-worker first.');
    await reclaimAdmission(ctx, options.task, prior);
    invariant(typeof ctx.store.dispatch === 'function', 'TOPOLOGY_MANAGEMENT_WORKER', 'Task store has no dispatch adapter.');
    let result;
    // TM-247: tm's refusal is the answer the lead needs, as a TOPOLOGY_* error, never a Node stack.
    try { result = await ctx.store.dispatch(options.task, backend); }
    catch (error) { fail('TOPOLOGY_MANAGEMENT_DISPATCH', `tm dispatch ${options.task} failed: ${tmMessage(error)}`, { task: options.task, backend }); }
    await recordEvent(ctx, options.task, prior, 'worker-started', { backend: result.backend ?? backend, run: result.run ?? null, workflow_run_id: prior.workflow_run_id ?? null });
    return result;
  });
  try {
    const bound = await bindTaskWorker(options);
    return { started: true, bound: true, run: dispatched.run ?? null, worker: bound.worker };
  } catch (error) {
    return { started: true, bound: false, run: dispatched.run ?? null, reason: error.message,
      recovery: `tm dispatch launched the worker; do not launch another. Run manage bind --task ${options.task} once it is observable.` };
  }
}

/** The text tm printed when it refused, without execFile's "Command failed: <argv>" preamble. */
const tmMessage = error => (error?.stderr || error?.stdout || '').trim() || String(error?.message || error);

/** TM-247 (AC13-15): an admission whose claim was released (tm block, a park, a collect) is re-claimed
 * for its owner through tm start, never stolen: a claim another session holds still refuses. A
 * blocked task stays blocked until someone runs tm unblock; that is a person's call, not this verb's. */
async function reclaimAdmission(ctx, task, record) {
  if (!await ctx.store.claim(task)) {
    const doc = await ctx.store.show(task);
    invariant(doc.status !== 'blocked', 'TOPOLOGY_MANAGEMENT_BLOCKED', `${task} is blocked${doc.blockedReason ? ` (${doc.blockedReason})` : ''}; run tm unblock ${task} once the blocker is resolved, then retry.`);
    invariant(doc.worktree && resolve(doc.worktree) === resolve(record.worktree), 'TOPOLOGY_MANAGEMENT_WORKTREE', 'Task worktree differs from the admission record; reconcile it before re-claiming.');
    try { await ctx.store.start(task, record.worktree); }
    catch (error) { fail('TOPOLOGY_MANAGEMENT_OWNERSHIP', `Re-claiming ${task} for its admission owner ${record.owner} failed: ${tmMessage(error)}`); }
  }
  return ownedTask(ctx, task, record.owner);
}

/** Close exactly the bound tmux pane, on its recorded server. */
async function closeOwnedPane(record, env) {
  const binding = record.worker?.binding;
  invariant(record.worker?.kind === 'tmux' && binding?.paneId && binding.serverKey, 'TOPOLOGY_MANAGEMENT_WORKER', 'Only an owned tmux pane can be closed; stop other workers through their own runtime.');
  await tmux(['kill-pane', '-t', binding.paneId], { tmuxServer: binding.serverKey, env });
}

/** TM-218: stop the bound worker only when owned, idle and its finish collected; otherwise refuse.
 * TM-247: a worker observed gone (or an idle shell) with NO finish is retired instead: its incarnation
 * moves to previous_workers with the observation and what it left behind (a tm block reason, a blocker
 * report), tm collects its dispatch, and the worktree is untouched. A live or unproven worker is never
 * touched by either path. */
export async function stopTaskWorker(options) {
  const ctx = await context(options);
  return withLock(`${ctx.path}.lock`, async () => {
    const record = await loadRecord(ctx.path);
    const observe = value => options.workerState ? options.workerState(value) : taskWorkerState(options, value);
    const close = options.closeWorker || (value => closeOwnedPane(value, ctx.env));
    try {
      invariant(record?.worker && record.owner === options.owner, 'TOPOLOGY_MANAGEMENT_STOP', 'No worker binding owned by this session; start it with manage start-worker or adopt it with manage bind. A session this lead did not start or bind is never closed.');
      const state = await observe(record);
      if (!state.owned) {
        const dead = await (options.deadWorkerState || deadWorkerState)(options, record);
        if (dead.owned && dead.active === false) return await retireWorker(ctx, options, record, dead, close);
        // The dead-worker path names the more specific reason (a released claim, a live pane).
        invariant(false, 'TOPOLOGY_MANAGEMENT_STOP', dead.owned ? state.reason || 'Worker ownership is unproven.' : dead.reason || state.reason || 'Worker ownership is unproven.');
      }
      invariant(state.active === false, 'TOPOLOGY_MANAGEMENT_STOP', state.reason || 'Worker is still active.');
      if (state.alive) {
        await close(record);
        invariant((await observe(record)).alive === false, 'TOPOLOGY_MANAGEMENT_STOP', 'Owned worker did not stop.');
      }
      const next = await recordEvent(ctx, options.task, record, 'worker-stopped', { worker: record.worker, proof: state.proof, closed: state.alive === true });
      next.worker = { ...record.worker, stopped_at: next.updated_at };
      await writeJson(ctx.path, next);
      return { stopped: true, closed: state.alive === true, proof: state.proof };
    } catch (error) {
      const released = /claim for TM-[0-9]+ was released/.test(error.message);
      const recovery = released ? `Re-claim the task as its admission owner with ao-topology manage admit --task ${options.task} (it resumes the same admission), then retry stop-worker.`
        : 'Leave the worker running. Wait for it to finish and send its finish report, or ask it to exit its harness, then retry stop-worker.';
      if (record && record.owner === options.owner) await recordEvent(ctx, options.task, record, 'worker-stop-refused', { reason: error.message, recovery });
      return { stopped: false, reason: error.message, recovery };
    }
  });
}

/** TM-247: what a dead worker left behind, from the task store and its own reports. */
function retiredResult(record, doc) {
  const boundAt = [...(record.events || [])].reverse().find(e => e.event === 'worker-bound')?.at || '';
  const blocker = [...(record.events || [])].reverse().find(e => e.event === 'blocker' && e.at >= boundAt);
  if (doc.status === 'blocked' || blocker) return { outcome: 'blocked', reason: doc.blockedReason || blocker?.report?.message || null };
  return { outcome: 'exited-without-finish', reason: `worker ended (task ${doc.status}) without a finish report` };
}

async function retireWorker(ctx, options, record, dead, close) {
  if (dead.alive) {
    await close(record);
    invariant((await (options.deadWorkerState || deadWorkerState)(options, record)).alive === false, 'TOPOLOGY_MANAGEMENT_STOP', 'Owned worker did not stop.');
  }
  const result = retiredResult(record, dead.doc);
  // tm records the dispatch's result, so its duplicate-dispatch guard sees the worker as ended. A
  // refusal here is kept, not fatal: the retire is true, and start-worker then names tm's reason.
  let collected = null;
  if (dead.doc.dispatched && ctx.store.collect) {
    try { collected = await ctx.store.collect(options.task); } catch (error) { collected = { ok: false, reason: (error.stderr || error.message || '').trim() }; }
  }
  const next = await recordEvent(ctx, options.task, record, 'worker-retired', { worker: record.worker, proof: dead.proof, closed: dead.alive === true, result, collected,
    recovery: `Start a successor with ao-topology manage start-worker --task ${options.task}; the admission, base revision and worktree are unchanged.` });
  next.previous_workers = [...(next.previous_workers || []), { ...record.worker, stopped_at: next.updated_at, retired: { proof: dead.proof, observed_at: next.updated_at, result } }];
  delete next.worker;
  if (next.state === 'blocked') next.state = 'working';
  await writeJson(ctx.path, next);
  return { stopped: true, retired: true, closed: dead.alive === true, proof: dead.proof, result, collected };
}

/** Default production proof. An observed exited process plus a collected finish report is safe;
 * a live process is always active/unknown. Registry TTL/dead labels never prove process death.
 */
export async function taskWorkerState(options, record) {
  const ctx = await context(options);
  try {
    // TM-247 (AC8): tm done releases the claim, so a task with a recorded landing may be stopped and
    // cleaned up afterwards; a claim another session holds still refuses.
    const claimRule = record?.merge ? { released: true } : {};
    const doc = await ownedTask(ctx, options.task, record?.owner, claimRule);
    return await observeLiveness(ctx, doc, record, { finished: true, claimRule });
  } catch (error) { return { owned: false, active: true, alive: null, reason: error.message }; }
}

/** TM-247: the same observation without the finish requirement, for retiring a worker that died
 * before reporting. The claim may be released (a parked or blocked task) but never foreign. */
export async function deadWorkerState(options, record) {
  const ctx = await context(options);
  try {
    const doc = await ownedTask(ctx, options.task, record?.owner, { released: true });
    return { ...await observeLiveness(ctx, doc, record, { finished: false, claimRule: { released: true } }), doc };
  } catch (error) { return { owned: false, active: true, alive: null, reason: error.message }; }
}

async function observeLiveness(ctx, doc, record, { finished, claimRule = {} }) {
  const worker = record.worker;
  // TM-247 (AC7): a worker started before an ownership transfer keeps its own owner's identity; the
  // claim may then sit with the new owner. Only an owner the record transferred from is accepted.
  const workerOwner = worker?.owner ?? record.owner;
  invariant(workerOwner === record.owner || (record.transfers || []).some(t => t.from === workerOwner), 'TOPOLOGY_MANAGEMENT_WORKER', 'No matching observed task-worker incarnation.');
  const rule = workerOwner === record.owner ? claimRule : { ...claimRule, holders: [...(claimRule.holders || []), record.owner] };
  // An adopted worker (TM-218) has no tm dispatch; its binding in this record is the registry.
  const row = worker?.adopted && !doc.dispatched ? { backend: worker.backend, pid: worker.pid ?? null } : await registeredWorker(ctx, doc, workerOwner, rule);
  invariant(worker && (worker.adopted ? !doc.dispatched : worker.name === row.name && worker.run === row.runId && worker.backend === row.backend && worker.registered_at === row.registeredAt), 'TOPOLOGY_MANAGEMENT_WORKER', 'No matching observed task-worker incarnation.');
  if (finished) invariant(record.finish && record.events?.some(event => event.event === 'finish' && event.report?.revision === record.finish.revision), 'TOPOLOGY_MANAGEMENT_WORKER', 'Task worker result has not been collected through the finish protocol.');
  if (row.backend === 'topology') {
    invariant(worker.kind === 'topology' && worker.native_identity, 'TOPOLOGY_MANAGEMENT_WORKER', 'Legacy native ownership must be reconciled through a new verified finish report.');
    const { observation, identity } = await observedNativeWorker(ctx, doc);
    // Without a finish there is no post-finish fingerprint to hold; the writer identity must still match.
    invariant(worker.native_run_id === observation.runId && (!finished || worker.native_fingerprint === observation.fingerprint) && JSON.stringify(worker.native_identity) === JSON.stringify(identity),
      'TOPOLOGY_MANAGEMENT_WORKER', 'Native workflow membership or incarnation changed after the finish report; preserve it and submit a new verified finish.');
    return { owned: true, active: observation.hasLiveWriters, alive: observation.hasLiveWriters,
      proof: observation.hasLiveWriters ? 'observed-native-writers-live' : 'observed-native-workflow-exited', worker,
      ...(observation.hasLiveWriters ? { reason: 'An exact native workflow member or child is still alive; stop every task writer before integration.' } : {}) };
  }
  if (worker.kind === 'process') {
    invariant(row.pid === worker.pid, 'TOPOLOGY_MANAGEMENT_WORKER', 'Registered worker PID changed.');
    if (processGone(worker.pid)) return { owned: true, active: false, alive: false, proof: 'observed-process-exited', worker };
    const current = await processStart(worker.pid);
    invariant(current && current.start === worker.process_start && current.boot === worker.boot, 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker PID identity is unknown or was reused.');
    return { owned: true, active: true, alive: true, reason: 'Observed worker is still alive; finish its process before integration.' };
  }
  const panes = await listServerPanes({ tmuxServer: worker.binding.serverKey, env: ctx.env });
  const pane = panes.find(p => bindingKeys.every(key => p[key] === worker.binding[key]));
  if (!pane || !pane.alive) {
    // A replacement in the same session is another writer, not evidence the task is idle.
    invariant(!panes.some(p => p.alive && (p.sessionId === worker.binding.sessionId || p.sessionName === worker.session_name || resolve(p.cwd) === resolve(doc.worktree))), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker session contains a replacement live pane.');
    return { owned: true, active: false, alive: false, proof: 'observed-pane-exited', worker };
  }
  if (await idleShell(pane.panePid)) return { owned: true, active: false, alive: true, proof: 'observed-pane-idle-shell', worker };
  return { owned: true, active: true, alive: true, reason: 'Observed worker pane is still alive; its activity is not safely known.' };
}

/** New admission requires readiness before tm start (which enforces dependencies/claim/WIP).
 * An already active adopted worker is never moved; the response schedules ownership review.
 */
export async function admitTask(options) {
  const ctx = await context(options), { task, owner, intent, boundaries, dependencies, checks } = options;
  invariant(nonempty(owner) && nonempty(intent) && list(boundaries) && boundaries.length && list(dependencies) && list(checks) && checks.length, 'TOPOLOGY_MANAGEMENT_START_PROTOCOL', 'Start requires owner, intended change, boundaries, dependencies and required checks.');
  return withLock(`${ctx.path}.lock`, async () => {
    const doc = await ctx.store.show(task), prior = await loadRecord(ctx.path);
    const held = await ctx.store.claim(task);
    if (doc.status === 'in_progress' && (!prior || prior.owner !== owner)) {
      await recordEvent(ctx, task, prior, 'ownership-review-required', { owner, existing_owner: held?.session || null, worktree: doc.worktree || null, recovery: 'Preserve the live worker and its work; review ownership and schedule migration at a safe boundary.' });
      return { admitted: false, state: 'ownership-review-required' };
    }
    if (held) ownClaim(held, owner, task); // TTL expiry never authorizes silent reassignment here.
    if (prior?.owner === owner && prior.started) { await reclaimAdmission(ctx, task, prior); return { admitted: true, resumed: true, record: prior }; }
    invariant(doc.labels?.includes('ready-for-agent') && list(doc.touches) && doc.touches.length, 'TOPOLOGY_MANAGEMENT_SCOPE', 'Task needs approved ready-for-agent scope and declared files/touches.');
    const available = await (options.reviewerReady || reviewerAvailability)(options);
    invariant(available.available, 'TOPOLOGY_MANAGEMENT_REVIEWER', available.reason || 'Designated reviewer is not ready.');
    for (const id of doc.blockedBy || []) invariant((await ctx.store.show(id)).status === 'done', 'TOPOLOGY_MANAGEMENT_DEPENDENCY', `Dependency ${id} is not complete.`);
    if (!doc.worktree || resolve(doc.worktree) === resolve(ctx.store.root)) await ctx.store.provision(task);
    const provisioned = await ownedTask(ctx, task, owner);
    await ctx.store.start(task, provisioned.worktree);
    const record = await recordEvent(ctx, task, prior, 'start', { owner, worktree: provisioned.worktree, branch: provisioned.branch, intent, boundaries, dependencies, checks, files: doc.touches });
    const lead=await findLead(agentDirs({...options,consumer:ctx.store.root}));
    const workflowRunId=options.workflowRunId || provisioned.dispatched?.workflowRunId || `tm-${task}`;
    const leadId=lead?.id || options.leadId || owner;
    // TM-325: the PR base tm recorded on the task, frozen here so a later task-file edit cannot move the review range.
    const integration = String(provisioned.integrationBranch ?? '').trim();
    Object.assign(record, { integration_branch: integration && integration !== 'HEAD' ? integration : null, base_revision: await gitText(provisioned.worktree, ['rev-parse', 'HEAD']), owner, workflow_run_id:workflowRunId,lead_id:leadId, worktree: provisioned.worktree, branch: provisioned.branch, started: true, state: 'working' });
    await writeJson(ctx.path, record);
    await ctx.store.govern?.(task,{workflowRunId,leadId,recordPath:ctx.path});
    return { admitted: true, record };
  });
}

/** Mechanically validate before/during/finish reports; finish is never task completion. */
export async function workerReport(options) {
  const ctx = await context(options), { task, owner, kind, report } = options;
  return withLock(`${ctx.path}.lock`, async () => {
    const prior = await loadRecord(ctx.path);
    invariant(prior?.started, 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'Worker must be admitted and send its start report before reporting work.');
    // TM-247 (AC13): one identity. The admission owner may report, and so may the bound worker's own
    // dispatch session; the claim may sit with either (a claim minted by an older tm dispatch).
    const dispatchedSession = (await ctx.store.show(task)).dispatched?.session;
    const holders = prior.worker && !prior.worker.stopped_at && nonempty(dispatchedSession) ? [dispatchedSession] : [];
    invariant(owner === prior.owner || holders.includes(owner), 'TOPOLOGY_MANAGEMENT_PROTOCOL', `Only the admission owner ${prior.owner} or its bound worker may report on ${task}.`);
    const doc = await ownedTask(ctx, task, prior.owner, { holders });
    invariant(['blocker', 'scope-change', 'ownership-conflict', 'stale-activity', 'failed-check', 'finish'].includes(kind), 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'Unknown worker report kind.');
    if (kind === 'finish') {
      invariant(report && list(report.artifacts) && report.artifacts.length && Array.isArray(report.checks) && report.checks.every(check => nonempty(check) || (check && typeof check === 'object')) && report.checks.length && list(report.risks) && nonempty(report.evidence), 'TOPOLOGY_MANAGEMENT_FINISH_PROTOCOL', 'Finish requires artifacts, checks/evidence, remaining risks and exact revision.');
      invariant(report.revision === await gitText(doc.worktree, ['rev-parse', 'HEAD']), 'TOPOLOGY_MANAGEMENT_REVISION', 'Finish must name the current exact task commit.');
      invariant(!(await gitText(doc.worktree, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_DIRTY', 'Commit or preserve outstanding changes before readiness for review.');
      finishCheckEvidence(report); // TM-418: a malformed check run is refused here, where the worker can still fix it.
    } else invariant(nonempty(report?.message), 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'A during-work report requires a visible reason.');
    // The same native workflow can undergo a producer-controlled fallback. A new finish
    // records its newly verified member set; a change after this point blocks integration.
    if (kind === 'finish' && doc.dispatched && ctx.store.workers && (!prior.worker || doc.dispatched.backend === 'topology')) prior.worker = await observeWorker(ctx, doc, prior.owner);
    const next = await recordEvent(ctx, task, prior, kind, { owner, report, state: kind === 'finish' ? 'ready-for-review' : 'blocked' });
    next.state = kind === 'finish' ? 'ready-for-review' : 'blocked';
    if (kind === 'finish') { next.finish = report; next.collected = false; }
    await writeJson(ctx.path, next);
    if (kind === 'finish') {
      await ctx.store.reviewReady?.(task,report.revision);
      try {
        const request = await (options.queueReview || requestReview)({ ...options, revision: report.revision, baseRevision: prior.base_revision, authorAgentIds: [...new Set([prior.owner, owner])], checkEvidence: claimedCheckEvidence(report) });
        next.review_request = request;
      } catch (error) {
        next.review_blocked = error.message;
        // TM-244: before the task-store comment, so the lead hears it even when task-management is absent or failing.
        next.review_blocked_notice = await noticeReviewBlocked(ctx, options, next, report.revision, error);
      }
      await writeJson(ctx.path, next);
      await ctx.store.comment(task, JSON.stringify({ event: 'review-queued', request: next.review_request || null, blocked: next.review_blocked || null }));
    }
    return next;
  });
}

export const RETRY_REVIEW_VERB = 'ao-topology manage retry-review --task';
/**
 * TM-244: a finish whose review request was refused tells the owning lead, once per task revision,
 * through standing mail (agent-orchestration's own channel, so it works with task-management
 * absent). Never throws: the finish is already recorded, and a failed notice is reported on it.
 */
async function noticeReviewBlocked(ctx, options, record, revision, error) {
  const to = record.lead_id;
  if (!to) return { status: 'skipped', reason: 'no lead recorded on the management record' };
  const id = createHash('sha256').update(`review-blocked:v1:${repoKey(ctx.identity.id)}:${options.task}:${revision}`).digest('hex').slice(0, 32);
  const body = [
    `REVIEW NOT FILED: ${options.task} finished at ${revision} but its review request was refused.`,
    `Refusal: ${error.code ? `${error.code}: ` : ''}${error.message}`,
    `Fix the cause, then retry: ${RETRY_REVIEW_VERB} ${options.task}`,
  ].join('\n');
  try {
    const sent = await (options.notifyLead || sendStandingMessage)({ id, consumer: options.consumer, fromProject: options.consumer, from: 'ao-management', to,
      subject: `review blocked: ${options.task}`, body, task: options.task, provenance: { source: 'ao-topology manage report' } }, { env: ctx.env, home: ctx.home });
    return { to, message_id: id, status: sent?.status ?? 'unknown', ...(sent?.reason ? { reason: sent.reason } : {}) };
  } catch (failure) { return { to, message_id: id, status: 'failed', reason: failure?.code ?? String(failure?.message ?? failure) }; }
}

/** TM-244: the lead's one retry for a refused review request. Re-files it for the recorded finish revision. */
export async function retryReview(options) {
  const ctx = await context(options), { task } = options;
  return withLock(`${ctx.path}.lock`, async () => {
    const record = await loadRecord(ctx.path);
    invariant(record?.state === 'ready-for-review' && record.finish?.revision, 'TOPOLOGY_MANAGEMENT_PROTOCOL', `${task} has no finish report awaiting review.`);
    try {
      record.review_request = await (options.queueReview || requestReview)({ ...options, revision: record.finish.revision, baseRevision: record.base_revision, authorAgentIds: [record.owner], checkEvidence: claimedCheckEvidence(record.finish) });
      delete record.review_blocked; delete record.review_blocked_notice;
    } catch (error) { record.review_blocked = error.message; await writeJson(ctx.path, record); throw error; }
    await writeJson(ctx.path, record);
    await ctx.store.comment(task, JSON.stringify({ event: 'review-queued', request: record.review_request, blocked: null }));
    return record;
  });
}

/** TM-248: why the caller is a managed agent session (agent marker in env, or a Claude Code / Codex
 * ancestor), or [] for an operator shell. A managed session always needs a covering plan grant,
 * whatever management.auto_merge says, and --actor / --authorized there are self-assertion. */
const managedSession = (options, ctx) => managedSessionEvidence({ env: ctx.env, ancestors: options.ancestors, home: ctx.home });
function refuseSelfAssertion(options, managed) {
  const asserted = [...(options.authorized === true ? ['--authorized'] : []), ...(nonempty(options.actor) ? ['--actor'] : [])];
  invariant(!asserted.length || !managed.length, 'TOPOLOGY_MANAGEMENT_SELF_ASSERT', `${asserted.join(' and ')} cannot be self-asserted inside a managed agent session (${managed.join('; ')}); there, authority comes only from an operator plan grant (ao-topology delegate grant) and the actor is its grantee.`);
}
const MANAGED_NEEDS_GRANT = 'a managed agent session needs a valid standing delegation (an operator plan grant covering this caller, repository and task), whatever management.auto_merge says';

/** TM-249: the one authority gate integrate applies: caller (no self-assertion; the grantee in its own
 * pane), plan (a live grant covering caller, repository and task). The merge path and the close-retry
 * path both run it, so a recorded landing never lets an unauthorized caller close the task. */
async function integrationAuthority(options, ctx, policy) {
  // TM-234: a standing delegation the operator granted this exact caller stands in for --authorized,
  // so a lead exercising authority it was given never has to attest to authority it grants itself.
  // A corrupt delegations file or an unproven grantee is a reason, not a crash: `manage eligible`
  // and status must still answer for every task. integrateTask rethrows delegationError.
  // TM-248: a managed session always needs a covering grant; auto_merge speaks only for an operator shell.
  const refusals = [], refuse = (condition, reason) => refusals.push({ condition, reason });
  let delegation = null, delegationError = null, autonomy = null, authorized = options.authorized === true;
  const managed = await managedSession(options, ctx);
  try { refuseSelfAssertion(options, managed); }
  catch (error) { refuse('caller', `${error.code}: ${error.message}`); authorized = false; }
  const needsGrant = managed.length > 0 || (policy.auto_merge !== true && !authorized);
  if (needsGrant) {
    try { delegation = await (options.findDelegation || findActiveDelegation)({ consumer: options.consumer, agentId: ctx.env.AO_AGENT_ID, scope: 'integrate', task: { id: options.task }, env: ctx.env, home: ctx.home, listPanesFn: options.listPanesFn, readCensusFn: options.readCensusFn, callerProc: options.callerProc }); }
    catch (error) {
      if (!['TOPOLOGY_DELEGATION_INTEGRITY', 'TOPOLOGY_DELEGATION_ACTOR', 'TOPOLOGY_DELEGATION_PLAN'].includes(error.code)) throw error;
      delegationError = error;
    }
    // TM-263 (ADR-0027): no covering grant, so the lead-autonomy policy on the server's default branch
    // may stand in for one. A grant whose plan misses the task does not block it; anything else does.
    if (!delegation && (!delegationError || delegationError.code === 'TOPOLOGY_DELEGATION_PLAN')) {
      try { autonomy = await leadAutonomy(options, ctx, 'integrate'); if (autonomy) delegationError = null; }
      catch (error) { if (error.code !== 'TOPOLOGY_DELEGATION_ACTOR') throw error; delegationError = error; }
    }
    if (delegationError) refuse(delegationError.code === 'TOPOLOGY_DELEGATION_ACTOR' ? 'caller' : 'plan', `${delegationError.code}: ${delegationError.message}`);
  }
  if (needsGrant && !delegation && !autonomy) refuse('plan', managed.length ? MANAGED_NEEDS_GRANT : 'configured policy requires explicit integration authority or a valid standing delegation');
  if (delegation && nonempty(options.actor) && options.actor !== delegation.grantee) refuse('caller', `under a standing delegation the actor is the grantee ${delegation.grantee}; refusing --actor ${options.actor}`);
  return { refusals, delegation, delegationError, autonomy };
}

/** TM-263 (ADR-0027): the policy file the lead-autonomy grant lives in, read only from the server. */
export const LEAD_POLICY_PATH = '.bytedesk/agent-orchestration/config.json';

/** TM-263: management.lead_autonomy as committed on the SERVER's default branch, read through gh like
 * the TM-258 server anchor; never the local file, which any same-user session can edit. Returns null
 * when gh, the network, the file or the key is unavailable or malformed: no policy, so a grant is
 * required exactly as before. The server is the PINNED repository (pinnedGithubRepo): a repointed remote
 * or gh default is refused, so the policy is null. Same-uid limit as githubCompare: a process as this
 * user can replace gh. */
export async function serverLeadAutonomy(gh, repoDir, { env = process.env, home = homedir() } = {}) {
  const policy = (await serverPolicy(gh, repoDir, { env, home })).document?.management?.lead_autonomy;
  return policy && nonempty(policy.lead) && list(policy.scopes) && nonempty(policy.adr) && nonempty(policy.authorized_by) ? policy : null;
}

/** TM-263 / TM-442: the repository config (LEAD_POLICY_PATH) as committed on the SERVER's default
 * branch of the PINNED repository, read through gh. { document, source } or { document: null, reason }.
 * Never the local file, the shared .git refs or remote URL: a worker can write all three. */
export async function serverPolicy(gh, repoDir, { env = process.env, home = homedir() } = {}) {
  let repo, branch;
  try { ({ repo, branch } = await pinnedGithubRepo(repoDir, gh, { env, home })); } catch (error) { return { document: null, reason: error.message }; }
  const file = await ghJson(gh, ['api', `repos/${repo}/contents/${LEAD_POLICY_PATH}?ref=${encodeURIComponent(branch)}`]);
  if (file.code !== 0 || typeof file.value?.content !== 'string') return { document: null, reason: `cannot read ${LEAD_POLICY_PATH} on ${repo}@${branch}${file.error ? `: ${file.error}` : ''}` };
  try { return { document: JSON.parse(Buffer.from(file.value.content, 'base64').toString('utf8')), source: `${repo}@${branch}:${LEAD_POLICY_PATH}` }; }
  catch { return { document: null, reason: `${LEAD_POLICY_PATH} on ${repo}@${branch} is not valid JSON` }; }
}

/** TM-442: the management keys that grant authority or choose what the lead executes. They are honoured
 * ONLY from the repository config committed on the server's default branch. A worker runs as the
 * operator's OS user and can write the global layer (~/.config/agent-orchestration), the plugin
 * defaults and the checkout's own repo file, so a value there is ignored with a warning. A signed
 * operator layer would be a second honoured source; signing is not implemented. */
export const PROTECTED_MANAGEMENT_KEYS = Object.freeze(['autonomy', 'release', 'cutover', 'required_checks']);

/** loadConfig, with PROTECTED_MANAGEMENT_KEYS replaced by the server's committed values (absent when the
 * server cannot be read: autonomy falls back to "pr", and release, cutover and required checks are
 * unconfigured, so every verb that needs them refuses). Adds { warnings, policy: { source, reason } }. */
export async function loadGovernedConfig(options) {
  const loaded = await loadConfig(options);
  const server = await serverPolicy(options.gh || defaultGh(options.consumer), options.consumer, { env: options.env || process.env, home: options.home || homedir() });
  const committed = server.document?.management && typeof server.document.management === 'object' ? server.document.management : {};
  const management = { ...(loaded.config.management || {}) }, warnings = [];
  for (const key of PROTECTED_MANAGEMENT_KEYS) {
    const local = management[key];
    delete management[key];
    if (Object.hasOwn(committed, key) && !(key === 'autonomy' && !AUTONOMY_LEVELS.includes(committed[key]))) management[key] = committed[key];
    if (local !== undefined && JSON.stringify(local) !== JSON.stringify(management[key])) {
      const layers = loaded.layers.filter(l => l.ok && l.present && l.raw?.management?.[key] !== undefined).map(l => `${l.scope} (${l.path})`);
      warnings.push(`management.${key} in ${layers.join(', ') || 'a local layer'} is ignored: it is honoured only from ${server.source || `the server's default branch (${server.reason})`} (TM-442)`);
    }
  }
  return { ...loaded, config: { ...loaded.config, management }, warnings, policy: { source: server.source || null, reason: server.reason || null } };
}

/** TM-442: the effective autonomy and where it came from; "pr" unless the server's default branch says otherwise. */
export function governedAutonomy(governed) {
  const level = governed.config.management?.autonomy;
  return level ? { level, scope: 'server-default-branch', path: governed.policy.source } : { level: 'pr', scope: 'built-in', path: null };
}

/** TM-263: integrate authority from the server policy, or null. The policy must name the caller and
 * the scope, and the caller must be proven to be this repository's lead (requireLeadCaller, which
 * throws TOPOLOGY_DELEGATION_ACTOR for an unproven caller naming the lead). */
async function leadAutonomy(options, ctx, scope) {
  const caller = ctx.env.AO_AGENT_ID;
  if (!nonempty(caller)) return null;
  const policy = await serverLeadAutonomy(options.gh || defaultGh(ctx.store.root), ctx.store.root, ctx);
  if (policy?.lead !== caller || !policy.scopes.includes(scope)) return null;
  const lead = await requireLeadCaller({ consumer: options.consumer, env: ctx.env, home: ctx.home, listPanesFn: options.listPanesFn, readCensusFn: options.readCensusFn, callerProc: options.callerProc });
  if (lead !== caller) return null; // the policy names an agent that is not this repository's lead
  return { actor: lead, policy: { adr: policy.adr, authorized_by: policy.authorized_by, source: 'server-default-branch' } };
}

/** TM-249: the authorization record both integrate paths write; governed completion reads `authorized`. */
const integrationAuthorization = (options, ctx, { record, policy, delegation, autonomy = null, revision }) => ({
  decision: 'integrate', actor: delegation ? delegation.grantee : autonomy ? autonomy.actor : (options.actor || ctx.env.TM_ACTOR || ctx.env.USER || record.lead_id),
  authorized: options.authorized === true || delegation != null || autonomy != null, explicit: options.authorized === true, revision,
  channel: delegation ? 'standing-delegation' : autonomy ? 'lead-autonomy-policy' : (options.actor ? 'gateway-or-explicit-actor' : 'local-operator'),
  policy_auto_merge: policy.auto_merge === true,
  ...(delegation ? { delegated_by: delegation.grantor, delegation_id: delegation.id, plan: delegation.plan } : {}),
  ...(autonomy && !delegation ? { policy: autonomy.policy } : {}), at: nowIso() });

/** Read-only integration gate; tests are rerun by integrateTask, never trusted from reports. */
export async function integrationEligibility(options) {
  const ctx = await context(options), record = await loadRecord(ctx.path), reasons = [], refusals = [];
  // TM-249: every reason carries the condition it fails, so manage integrate refuses each by name.
  const refuse = (condition, reason) => { reasons.push(reason); refusals.push({ condition, reason }); };
  if (!record || record.state !== 'ready-for-review') refuse('protocol', 'task has no completed worker protocol ready for review');
  let doc, review = null, claimedReasons = [];
  try { doc = await ownedTask(ctx, options.task, record?.owner); } catch (error) { refuse('ownership', error.message); }
  const loaded = await loadGovernedConfig(options);
  const policy = loaded.config.management || {};
  if (loaded.errors.length) refuse('config', 'management configuration is invalid');
  const viaPullRequest = policy.integrate_via === 'pull-request';
  const authority = await integrationAuthority(options, ctx, policy);
  for (const { condition, reason } of authority.refusals) refuse(condition, reason);
  const { delegation, delegationError } = authority;
  if (!viaPullRequest && (!Array.isArray(policy.required_checks) || !policy.required_checks.length || policy.required_checks.some(c => !nonempty(c.name) || !list(c.argv) || !c.argv.length))) refuse('config', `configure named management.required_checks with executable argv in ${LEAD_POLICY_PATH} on the server's default branch, the only source honoured (TM-442)${loaded.policy.reason ? `; ${loaded.policy.reason}` : ''}`);
  if (!nonempty(policy.target_branch)) refuse('config', 'configure management.target_branch before integration');
  if (doc && record?.finish) {
    if (!doc.labels?.includes('ready-for-agent')) refuse('scope', 'task scope is no longer approved');
    const head = await gitText(doc.worktree, ['rev-parse', 'HEAD']);
    if (head !== record.finish.revision && !await mergeInOf(doc.worktree, record.finish.revision, head, policy.target_branch, { gh: options.gh || defaultGh(ctx.store.root), env: ctx.env, home: ctx.home })) refuse('head', `task changed after finish (approved ${record.finish.revision}, now ${head}); send a new report and obtain a new review`);
    if (await gitText(doc.worktree, ['status', '--porcelain'])) refuse('dirty', 'task worktree has uncommitted work');
    review = await (options.reviewGate || reviewEligibility)({ ...options, revision: record.finish.revision, baseRevision: record.base_revision, authorAgentIds: [record.owner] });
    claimedReasons = review.reasons.filter(reason => CHECK_EVIDENCE_REASON.test(reason));
    const reviewReasons = review.reasons.filter(reason => !CHECK_EVIDENCE_REASON.test(reason));
    for (const reason of reviewReasons) refuse('review', reason);
    if (review.eligible !== true && review.reasons.length === 0) refuse('review', 'review eligibility was not established');
    if (!record.base_revision || !list(doc.touches) || !doc.touches.length) refuse('scope', 'approved file scope or task base revision is unavailable');
    else {
      // TM-257: the same effective base the review range uses, so a merged default branch's landed files are not out of scope.
      try {
        const { effective_base: base } = await reviewRangeBase({ ...options, revision: record.finish.revision, admittedBase: record.base_revision });
        const paths = (await git(doc.worktree, ['diff', '--name-only', '-z', base, record.finish.revision])).stdout.split('\0').filter(Boolean);
        if (paths.some(path => !doc.touches.some(scope => path === scope || path.startsWith(scope.replace(/\/$/, '') + '/')))) refuse('scope', 'implementation changed files outside the approved task scope');
      } catch (error) { refuse('scope', error.message); }
    }
    // TM-442: a task never changes the management policy it is judged by; that is the operator's edit.
    const changed = await managementPolicyChange(doc.worktree, record.finish.revision, policy.target_branch);
    if (changed) refuse('scope', changed);
    const writer = options.workerState ? await options.workerState(record) : await taskWorkerState(options, record);
    if (!writer.owned || writer.active !== false) refuse('worker', writer.reason || 'worker ownership or absence of an active writer is unproven');
  }
  // TM-430: required checks are never satisfied here; integrate runs them on the host (runRequiredChecks).
  return { eligible: reasons.length === 0, reasons, refusals, record, doc, policy, review, delegation, delegationError, autonomy: authority.autonomy,
    required_checks: { satisfied_by: 'host-run-at-integrate', claimed_check_reasons: claimedReasons } };
}

/** TM-442: a reason when `revision` changes `management` in the committed repo config relative to its
 * merge base with the integration branch (local, else origin), or null. Unreadable counts as changed. */
export async function managementPolicyChange(cwd, revision, target) {
  if (!nonempty(target)) return null;
  let base = '';
  for (const ref of [`refs/heads/${target}`, `refs/remotes/origin/${target}`]) {
    base = (await git(cwd, ['merge-base', revision, ref], true)).stdout.trim();
    if (base) break;
  }
  if (!base) return `cannot find the merge base of ${revision} with ${target}, so a change to ${LEAD_POLICY_PATH} management cannot be ruled out`;
  const management = async rev => {
    const shown = await git(cwd, ['cat-file', '-p', `${rev}:${LEAD_POLICY_PATH}`], true);
    if (shown.code !== 0) return { value: null };
    try { return { value: JSON.parse(shown.stdout)?.management ?? null }; } catch { return { invalid: true }; }
  };
  const [before, after] = [await management(base), await management(revision)];
  if (after.invalid || JSON.stringify(before.value) !== JSON.stringify(after.value)) return `the task changes "management" in ${LEAD_POLICY_PATH}; management policy is the operator's change, made on the default branch, never landed through a task (TM-442)`;
  return null;
}

/** TM-444: the host runs each required check in a FRESH detached worktree of `revision`, never in the
 * worker's worktree, where an ignored file (a planted node_modules/.bin/<runner> that exits 0) would
 * fake a pass that `git status --porcelain` cannot see. The tree is created and removed through
 * safe-git (no hooks, no repository-scope filters) and holds exactly the committed files. Throws
 * TOPOLOGY_MANAGEMENT_CHECK_FAILED on the first failure; returns every run otherwise. */
export async function runRequiredChecks(root, revision, required) {
  const dir = await mkdtemp(join(tmpdir(), 'ao-checks-')), tree = join(dir, 'tree'), checks = [];
  try {
    await git(root, ['worktree', 'add', '--detach', tree, revision]);
    for (const check of required) {
      const result = await run(check.argv[0], check.argv.slice(1), { cwd: tree, allowFailure: true, timeoutMs: check.timeout_ms || 120000 });
      checks.push({ name: check.name, code: result.code, revision, runner: 'host', tree: 'fresh-detached-worktree' });
      invariant(result.code === 0, 'TOPOLOGY_MANAGEMENT_CHECK_FAILED', `Required check ${check.name} failed.`, { checks });
    }
    return checks;
  } finally {
    await git(root, ['worktree', 'remove', '--force', tree], true);
    await rm(dir, { recursive: true, force: true });
    await git(root, ['worktree', 'prune'], true);
  }
}

/** Merge only the reviewed commit after freshly running configured checks. No push or deploy. */
export async function integrateTask(options) {
  const ctx = await context(options);
  refuseSelfAssertion(options, await managedSession(options, ctx));
  return withLock(join(ctx.root, 'integration.lock'), async () => {
    if ((await loadConfig(options)).config.management?.integrate_via === 'pull-request') return integrateViaPullRequest(options, ctx);
    const gate = await integrationEligibility(options);
    if (gate.delegationError) throw gate.delegationError;
    invariant(gate.eligible, 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', gate.reasons.join('; '));
    const { record, doc, policy } = gate, checks = [];
    const targetBefore = await gitText(ctx.store.root, ['rev-parse', 'HEAD']);
    invariant(await gitText(ctx.store.root, ['symbolic-ref', '--short', 'HEAD']) === policy.target_branch, 'TOPOLOGY_MANAGEMENT_TARGET', 'Canonical checkout must be on the configured integration branch.');
    const foreign = await foreignDirtyPaths(ctx.store.root);
    invariant(!foreign.length, 'TOPOLOGY_MANAGEMENT_DIRTY', `Integration checkout has uncommitted or uncollected work outside the tool store paths: ${foreign.slice(0, 5).join(', ')}`);
    invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', targetBefore, record.finish.revision], true)).code === 0, 'TOPOLOGY_MANAGEMENT_TARGET', `Cannot fast-forward ${policy.target_branch} to ${record.finish.revision}; rebase the task onto the target branch and obtain a new review.`);
    const incoming = (await git(ctx.store.root, ['diff', '--name-only', '-z', targetBefore, record.finish.revision])).stdout.split('\0').filter(Boolean);
    invariant(!incoming.some(storePath), 'TOPOLOGY_MANAGEMENT_STORE_PATHS', `The landing would change tool store paths (${INTEGRATION_STORE_PATHS.join(', ')}); land it by hand and record it with manage record-landing.`);
    checks.push(...await runRequiredChecks(ctx.store.root, record.finish.revision, policy.required_checks));
    // Reread claims, revision and reviewer readiness after potentially long checks.
    const fresh = await integrationEligibility(options);
    invariant(fresh.eligible && fresh.record.finish.revision === record.finish.revision && JSON.stringify(fresh.policy) === JSON.stringify(policy), 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', fresh.reasons.join('; ') || 'Revision changed during checks.');
    invariant(await gitText(ctx.store.root, ['symbolic-ref', '--short', 'HEAD']) === policy.target_branch && await gitText(ctx.store.root, ['rev-parse', 'HEAD']) === targetBefore && !(await foreignDirtyPaths(ctx.store.root)).length, 'TOPOLOGY_MANAGEMENT_TARGET', 'Integration target changed during checks.');
    record.review = fresh.review.status?.review || null;
    await ctx.store.evidence(options.task, ctx.path);
    record.collected = true;
    await writeJson(ctx.path, record);
    await git(ctx.store.root, ['merge', '--ff-only', record.finish.revision]);
    const landed = await gitText(ctx.store.root, ['rev-parse', 'HEAD']);
    invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', record.finish.revision, landed], true)).code === 0, 'TOPOLOGY_MANAGEMENT_LANDING', 'Landing ancestry verification failed.');
    const authorization = integrationAuthorization(options, ctx, { record, policy, delegation: fresh.delegation, autonomy: fresh.autonomy, revision: record.finish.revision });
    const next = await recordEvent(ctx, options.task, record, 'merge', { revision: record.finish.revision, landed, checks, target_branch: policy.target_branch,authorization });
    Object.assign(next, { state: 'merged', collected: true, merge: { revision: record.finish.revision, landed, checks, target_branch: policy.target_branch,authorization } });
    await writeJson(ctx.path, next);
    return next;
  });
}

// ── TM-249: integrate by merging the task's pull request ──────────────────────
//
// With management.integrate_via "pull-request", manage integrate merges the PR itself, and only
// when every named condition holds: plan (a live grant covers caller and task), caller, base, head,
// ci, review and mergeable, plus the eligibility conditions integrate always had. It never passes
// --admin, --squash, --rebase or --auto, and --match-head-commit pins the merge to the approved SHA.

/** The one place gh runs. argv only, never a shell; tests inject options.gh. */
const GH_TIMEOUT_MS = 60_000;
// PR #226 follow-up: the root-owned gh at a pinned system path (trustedGh), never the first `gh` on PATH.
export const hostGh = cwd => {
  const bin = trustedGh();
  return async args => (bin ? run(bin, args, { cwd, allowFailure: true, timeoutMs: GH_TIMEOUT_MS })
    : { code: 127, stdout: '', stderr: `no root-owned gh at ${GH_PATHS.join(', ')}` });
};
const defaultGh = hostGh;
async function ghJson(gh, args) {
  const result = await gh(args);
  try { return { code: result.code, value: JSON.parse(result.stdout) }; }
  catch { return { code: result.code, value: null, error: (result.stderr || result.stdout || '').trim() }; }
}
const ghFailure = (what, r) => `${what} failed (exit ${r.code})${r.error ? `: ${r.error}` : ''}`;

/** CI rule: every reported check passes. `skipping` is allowed only for a check gh does not list
 * under --required; if the required set cannot be read, every check counts as required. No checks
 * at all, or none passing, is refused: an empty list must never read as green. */
async function ciStatus(gh, repo, number) {
  const fields = ['--repo', repo, '--json', 'name,state,bucket'];
  const all = await ghJson(gh, ['pr', 'checks', String(number), ...fields]);
  if (!Array.isArray(all.value)) return { refusal: ghFailure(`gh pr checks #${number}`, all) };
  if (!all.value.length) return { refusal: `no CI checks are reported for PR #${number}` };
  const required = await ghJson(gh, ['pr', 'checks', String(number), '--required', ...fields]);
  const requiredNames = Array.isArray(required.value) ? new Set(required.value.map(check => check.name)) : null;
  const bad = all.value.filter(check => !(check.bucket === 'pass' || (check.bucket === 'skipping' && requiredNames && !requiredNames.has(check.name))));
  if (bad.length) return { refusal: `CI is not green on PR #${number}: ${bad.map(check => `${check.name} is ${check.bucket || check.state}${check.bucket === 'skipping' ? ' (required)' : ''}`).join(', ')}` };
  if (!all.value.some(check => check.bucket === 'pass')) return { refusal: `no CI check passed on PR #${number}` };
  return { checks: all.value.map(check => ({ name: check.name, bucket: check.bucket })) };
}

/** After a remote merge, bring the local integration branch to the merge commit, fast-forward only,
 * so the store's governed-completion gate can verify the landing locally. */
async function syncTarget(root, target, landed) {
  // ponytail: the remote is origin; a repository landing through another remote needs a config key.
  const current = (await git(root, ['symbolic-ref', '--short', 'HEAD'], true)).stdout.trim();
  if (current === target) {
    await git(root, ['fetch', 'origin', target]);
    const foreign = await foreignDirtyPaths(root);
    invariant(!foreign.length, 'TOPOLOGY_MANAGEMENT_DIRTY', `Integration checkout has uncommitted work outside the tool store paths: ${foreign.slice(0, 5).join(', ')}`);
    await git(root, ['merge', '--ff-only', landed]);
  } else await git(root, ['fetch', 'origin', `${target}:${target}`]);
  invariant((await git(root, ['merge-base', '--is-ancestor', landed, `refs/heads/${target}`], true)).code === 0, 'TOPOLOGY_MANAGEMENT_TARGET', `${landed} did not reach the local ${target}.`);
}

/** The landing record integrate and record-landing both write; governed completion reads it. */
async function writeLanding(ctx, task, record, review, event, merge) {
  record.review = review;
  await ctx.store.evidence(task, ctx.path);
  record.collected = true;
  await writeJson(ctx.path, record);
  const next = await recordEvent(ctx, task, record, event, merge);
  Object.assign(next, { state: 'merged', collected: true, merge });
  await writeJson(ctx.path, next);
  return next;
}

/** Close a landed task through the store's gates only: attach the evidence, then `tm done` as the
 * caller's authorized actor. It never accepts a criterion: the worker's evidence or the operator does
 * that. When the store refuses, the landing stands and the result names the unaccepted criteria. */
async function closeLandedTask(ctx, task, record, auth) {
  const pr = record.merge.pull_request?.number, who = { actor: auth.actor, delegated_by: auth.delegated_by ?? null, delegation_id: auth.delegation_id ?? null };
  try {
    await ctx.store.evidence(task, ctx.path);
    await ctx.store.done(task, auth.actor);
  } catch (error) {
    let unaccepted = [];
    try { unaccepted = ((await ctx.store.show(task)).acceptance || []).map((c, i) => ({ index: i + 1, text: c.text, done: c.done })).filter(c => !c.done).map(({ index, text }) => ({ index, text })); } catch { /* the store's own refusal below still names the cause */ }
    const criteria = unaccepted.length ? ` Unaccepted acceptance criteria: ${unaccepted.map(c => `#${c.index} "${c.text}"`).join('; ')}. Integrate never accepts criteria on the task's behalf; the worker's evidence or the operator accepts them (tm accept ${task} <n>), then rerun manage integrate to close the task.` : ' Rerun manage integrate to retry closing.';
    fail('TOPOLOGY_INTEGRATE_UNCLOSED', `PR #${pr} is merged and its landing is recorded, but the store refused to close ${task}: ${error.message.trim()}.${criteria} A rerun never merges again.`, { merged: true, recorded: true, closed: false, pull_request: pr, unaccepted });
  }
  const next = await recordEvent(ctx, task, record, 'close', { ...who, pull_request: pr ?? null });
  next.closed = { ...who, at: nowIso() };
  await writeJson(ctx.path, next);
  return next;
}

const refuseIntegrate = (refusals, pr) => fail('TOPOLOGY_INTEGRATE_REFUSED', `manage integrate refused (${[...new Set(refusals.map(r => r.condition))].join(', ')}): ${refusals.map(r => `${r.condition}: ${r.reason}`).join('; ')}`, { refusals, pull_request: pr ?? null });

async function integrateViaPullRequest(options, ctx) {
  const gh = options.gh || defaultGh(ctx.store.root);
  const prior = await loadRecord(ctx.path);
  // A landing already recorded by this path: only closing can remain, and it never merges again.
  // Closing still needs the same caller and plan authority the merge needed.
  if (prior?.state === 'merged' && prior.merge?.pull_request) {
    if (prior.closed) return prior;
    const policy = (await loadConfig(options)).config.management || {};
    const { refusals, delegation, autonomy } = await integrationAuthority(options, ctx, policy);
    if (refusals.length) refuseIntegrate(refusals, prior.merge.pull_request.number);
    return closeLandedTask(ctx, options.task, prior, integrationAuthorization(options, ctx, { record: prior, policy, delegation, autonomy, revision: prior.merge.revision }));
  }
  const gate = await integrationEligibility(options);
  const { record, doc, policy, delegation, autonomy } = gate, refusals = [...gate.refusals];
  const refuse = (condition, reason) => refusals.push({ condition, reason });
  const revision = record?.finish?.revision, approved = gate.review?.status?.review;
  if (gate.review && approved?.verdict !== 'approve') refuse('review', `review verdict is ${approved?.verdict ?? 'missing'}, not approve`);
  let pr = null, ci = null, repo = null;
  // TM-263: every PR call names the pinned repository; a repointed remote or gh default refuses here.
  try { ({ repo } = await pinnedGithubRepo(ctx.store.root, gh, ctx)); } catch (error) { refuse('repository', error.message); }
  if (doc?.branch && repo) {
    const listed = await ghJson(gh, ['pr', 'list', '--repo', repo, '--head', doc.branch, '--state', 'all', '--json', 'number,state,baseRefName,headRefOid,mergeable']);
    if (!Array.isArray(listed.value)) refuse('pr', ghFailure('gh pr list', listed));
    else {
      const open = listed.value.filter(p => p.state === 'OPEN');
      if (open.length > 1) refuse('pr', `more than one open PR has head branch ${doc.branch}: ${open.map(p => `#${p.number}`).join(', ')}`);
      pr = open[0] || listed.value.find(p => p.state === 'MERGED') || null;
      if (!pr) refuse('pr', `no open PR has head branch ${doc.branch}`);
    }
  }
  let mergeIn = null;
  if (pr) {
    const merged = pr.state === 'MERGED', reviewed = approved?.verified_commit || approved?.revision;
    const at = merged ? `PR #${pr.number} was already merged at ${pr.headRefOid}` : `PR #${pr.number} head ${pr.headRefOid}`;
    if (pr.baseRefName !== policy.target_branch) refuse('base', `PR #${pr.number} targets ${pr.baseRefName}, not the integration branch ${policy.target_branch}`);
    // TM-247 (AC9): a head that only merged the integration branch into the approved revision lands that revision.
    if (revision && pr.headRefOid !== revision && nonempty(policy.target_branch)) {
      await git(ctx.store.root, ['fetch', 'origin', policy.target_branch, `refs/pull/${pr.number}/head`], true);
      mergeIn = await mergeInOf(ctx.store.root, revision, pr.headRefOid, policy.target_branch, { gh, env: ctx.env, home: ctx.home });
    }
    if (reviewed && pr.headRefOid !== reviewed && !(mergeIn && reviewed === revision)) refuse('head', `${at}, not the reviewed and approved revision ${reviewed}, nor a merge-in of ${policy.target_branch} on top of it`);
    if (revision && pr.headRefOid !== revision && !mergeIn) refuse('head', `${at}, not the task's recorded finish revision ${revision}, nor a merge-in of ${policy.target_branch} on top of it`);
    if (!merged) {
      if (pr.mergeable !== 'MERGEABLE') refuse('mergeable', `PR #${pr.number} is ${pr.mergeable || 'UNKNOWN'}, not MERGEABLE`);
      ci = await ciStatus(gh, repo, pr.number);
      if (ci.refusal) refuse('ci', ci.refusal);
    }
    if (revision && nonempty(policy.target_branch)) {
      // The local fast-forward after the merge would collide with the tools' own dirty store files.
      const incoming = await git(ctx.store.root, ['diff', '--name-only', '-z', `refs/heads/${policy.target_branch}...${revision}`], true);
      if (incoming.code !== 0) refuse('base', `cannot diff ${revision} against the local ${policy.target_branch}: ${incoming.stderr.trim()}`);
      else if (incoming.stdout.split('\0').some(path => path && storePath(path))) refuse('scope', `the PR changes tool store paths (${INTEGRATION_STORE_PATHS.join(', ')}); land it by hand and record it with manage record-landing`);
    }
  }
  // TM-430: the PR path's required checks are the host's own run of the configured argv at the approved
  // revision, never the worker's report (and CI is a separate gate above). Only before a merge.
  let hostChecks = [];
  if (!refusals.length && pr.state !== 'MERGED' && Array.isArray(policy.required_checks) && policy.required_checks.length) {
    try { hostChecks = await runRequiredChecks(ctx.store.root, revision, policy.required_checks); }
    catch (error) { refuse('checks', `${error.message}${error.details?.checks ? ` (${error.details.checks.map(c => `${c.name}: exit ${c.code}`).join(', ')})` : ''}`); }
  }
  if (refusals.length) refuseIntegrate(refusals, pr?.number);
  if (pr.state !== 'MERGED') {
    // The only merge this verb performs. Exactly these flags; nothing forces, bypasses or defers.
    const result = await gh(['pr', 'merge', String(pr.number), '--repo', repo, '--merge', '--match-head-commit', pr.headRefOid]);
    invariant(result.code === 0, 'TOPOLOGY_INTEGRATE_MERGE_FAILED', `gh pr merge #${pr.number} failed (exit ${result.code}); nothing was recorded: ${(result.stderr || result.stdout || '').trim()}`, { pull_request: pr.number, merged: false });
  }
  let next;
  try {
    const view = await ghJson(gh, ['pr', 'view', String(pr.number), '--repo', repo, '--json', 'state,headRefOid,baseRefName,mergeCommit']);
    const v = view.value;
    invariant(v?.state === 'MERGED' && v.headRefOid === pr.headRefOid && v.baseRefName === policy.target_branch && nonempty(v.mergeCommit?.oid), 'TOPOLOGY_MANAGEMENT_LANDING', v ? `gh reports PR #${pr.number} as ${v.state} at ${v.headRefOid} into ${v.baseRefName}, not merged at ${pr.headRefOid} into ${policy.target_branch}` : ghFailure('gh pr view', view));
    const landed = v.mergeCommit.oid;
    await syncTarget(ctx.store.root, policy.target_branch, landed);
    invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', revision, landed], true)).code === 0, 'TOPOLOGY_MANAGEMENT_LANDING', `Finish revision ${revision} is not an ancestor of the merge commit ${landed}.`);
    const authorization = integrationAuthorization(options, ctx, { record, policy, delegation, autonomy, revision });
    next = await writeLanding(ctx, options.task, record, approved, 'merge', { revision, landed, checks: ci?.checks || [], target_branch: policy.target_branch,
      pull_request: { number: pr.number, head: pr.headRefOid, already_merged: pr.state === 'MERGED' }, ...(mergeIn ? { merge_in: mergeIn } : {}), required_checks: hostChecks, authorization });
  } catch (error) {
    fail('TOPOLOGY_INTEGRATE_UNRECORDED', `PR #${pr.number} is merged, but its landing was not recorded: ${error.message}. Do not merge again; rerun manage integrate, which records an already-merged PR.`, { pull_request: pr.number, merged: true, recorded: false });
  }
  return closeLandedTask(ctx, options.task, next, next.merge.authorization);
}

/** Record an operator-authorized landing that ALREADY happened (TM-224). It never merges.
 * It writes the same merge record integrateTask writes, so governed completion accepts it
 * unchanged, and only for the exact reviewed finish revision reachable from the target branch. */
export async function recordLanding(options) {
  const ctx = await context(options);
  const managed = await managedSession(options, ctx);
  refuseSelfAssertion(options, managed);
  return withLock(join(ctx.root, 'integration.lock'), async () => {
    const { task, reason } = options;
    invariant(nonempty(reason), 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', 'record-landing requires a non-empty --reason.');
    const record = await loadRecord(ctx.path);
    const revision = record?.finish?.revision;
    invariant(!record?.merge, 'TOPOLOGY_MANAGEMENT_LANDING', 'Task already has a recorded landing.');
    invariant(record?.state === 'ready-for-review' && nonempty(revision), 'TOPOLOGY_MANAGEMENT_LANDING', 'Task has no finished worker revision ready for review.');
    const policy = (await loadConfig(options)).config.management || {};
    invariant(nonempty(policy.target_branch), 'TOPOLOGY_MANAGEMENT_TARGET', 'Configure management.target_branch before recording a landing.');
    // A managed session needs a plan grant (TM-248) covering this caller, repository, task and the
    // record-landing scope, whatever auto_merge says; an operator shell may instead pass --authorized
    // or rely on policy auto_merge. TM-263 (ADR-0027): the repository's own lead, proven by pane
    // ancestry, needs no grant; it records only a landing the server's default branch already has.
    const lookup = { consumer: options.consumer, env: ctx.env, home: ctx.home, listPanesFn: options.listPanesFn, readCensusFn: options.readCensusFn, callerProc: options.callerProc };
    let delegation = null, lead = null;
    if (managed.length || (options.authorized !== true && policy.auto_merge !== true)) {
      try { delegation = await (options.findDelegation || findActiveDelegation)({ ...lookup, agentId: ctx.env.AO_AGENT_ID, scope: 'record-landing', task: { id: task } }); }
      catch (error) {
        if (error.code !== 'TOPOLOGY_DELEGATION_PLAN' || !managed.length || !(lead = await requireLeadCaller(lookup))) throw error;
      }
      if (!delegation && !lead && managed.length) lead = await requireLeadCaller(lookup);
    }
    invariant(!managed.length || delegation || lead, 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', `record-landing refused: ${MANAGED_NEEDS_GRANT}, or the caller must be this repository's own lead (${managed.join('; ')}).`);
    const authorized = delegation != null || lead != null || options.authorized === true || policy.auto_merge === true;
    // TM-234: under a delegation the actor IS the grantee that exercised it; --actor may only repeat it.
    invariant(!delegation || !nonempty(options.actor) || options.actor.trim() === delegation.grantee, 'TOPOLOGY_DELEGATION_ACTOR', `Under a standing delegation the actor is the grantee ${delegation?.grantee}; refusing --actor ${options.actor}.`);
    const actor = delegation ? delegation.grantee : lead || options.actor;
    invariant(nonempty(actor), 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', 'record-landing requires a non-empty --actor.');
    invariant(authorized, 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', 'Configured policy requires explicit integration authority; pass --authorized, or have the operator grant a standing delegation with ao-topology delegate grant.');
    invariant(nonempty(options.landed), 'TOPOLOGY_MANAGEMENT_LANDING', 'record-landing requires --landed <commit>.');
    const resolved = await git(ctx.store.root, ['rev-parse', '--verify', '--quiet', `${options.landed}^{commit}`], true);
    invariant(resolved.code === 0, 'TOPOLOGY_MANAGEMENT_LANDING', `Landed commit ${options.landed} does not exist.`);
    const landed = resolved.stdout.trim();
    const ancestor = async (a, b) => (await git(ctx.store.root, ['merge-base', '--is-ancestor', a, b], true)).code === 0;
    invariant(await ancestor(revision, landed), 'TOPOLOGY_MANAGEMENT_LANDING', `Finish revision ${revision} is not an ancestor of ${landed}.`);
    // TM-247 (AC10) / TM-472: the landing must be on the target branch of the PINNED repository on the
    // server (gh compare), for every caller including an operator's --authorized: a local or origin ref is
    // one `git update-ref` away from a worker. Then bring the local branch forward so governed completion
    // can verify it locally too.
    const server = await serverCompareStatus(options.gh || defaultGh(ctx.store.root), ctx.store.root, landed, policy.target_branch, ctx);
    invariant(['ahead', 'identical'].includes(server.status), 'TOPOLOGY_MANAGEMENT_TARGET', `${landed} is not on the configured target branch ${policy.target_branch} on the server (${server.status ? `compare says ${server.status}` : server.reason}); a local or origin ref is not evidence of a landing.`);
    await git(ctx.store.root, ['fetch', 'origin', policy.target_branch], true);
    if (!await ancestor(landed, `refs/heads/${policy.target_branch}`)) await syncTarget(ctx.store.root, policy.target_branch, landed);
    const review = await (options.reviewGate || reviewEligibility)({ ...options, revision, baseRevision: record.base_revision, authorAgentIds: [record.owner] });
    invariant(review.eligible === true && review.reasons.length === 0 && review.status?.review, 'TOPOLOGY_MANAGEMENT_REVIEW', review.reasons.join('; ') || 'An eligible independent review of the finish revision is required.');
    if (lead && !delegation) {
      const approved = review.status.review;
      invariant(approved.verdict === 'approve' && (approved.verified_commit || approved.revision) === revision, 'TOPOLOGY_MANAGEMENT_REVIEW', `The repository lead records only a landing whose review approved ${revision}; the review is ${approved.verdict ?? 'missing a verdict'} at ${approved.verified_commit || approved.revision || 'no revision'}.`);
      let server;
      try { server = await (options.serverCompare || githubCompare)(ctx.store.root, landed, null); }
      catch (error) { fail('TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', `record-landing by the repository lead ${lead} needs the server to confirm ${landed} is on its default branch, and it could not answer (${error.message}); without that, a plan grant is required.`); }
      invariant(server?.status === 'ahead' || server?.status === 'identical', 'TOPOLOGY_MANAGEMENT_TARGET', `${landed} is not on the server's default branch (compare says ${server?.status ?? 'nothing'}); the repository lead records only a landing the server already has.`);
      // findLead reads local agent files a same-user session can edit. When the server's lead_autonomy
      // policy names the lead, that name wins; with no server policy, findLead's answer stands (documented bound).
      const named = (await serverLeadAutonomy(options.gh || defaultGh(ctx.store.root), ctx.store.root, ctx))?.lead;
      invariant(!named || named === lead, 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', `record-landing refused: the server's lead_autonomy policy names ${named} as this repository's lead, not ${lead}.`);
    }
    const authorization = { decision: 'integrate', actor: actor.trim(), authorized, explicit: options.authorized === true, revision, channel: lead && !delegation ? 'repository-lead' : 'recorded-landing', ...(lead && !delegation ? { adr: 'ADR-0027' } : {}), reason: reason.trim(), policy_auto_merge: policy.auto_merge === true,
      ...(delegation ? { delegated_by: delegation.grantor, delegation_id: delegation.id, plan: delegation.plan } : {}), at: nowIso() };
    // No checks run here: the actor attests to the checks run at landing time, cited in --reason.
    const merge = { revision, landed, checks: [], checks_skipped: true, target_branch: policy.target_branch, authorization };
    return writeLanding(ctx, task, record, review.status.review, 'recorded-landing', merge);
  });
}

/** TM-251: branches cleanup never deletes, whatever a record says: develop, main, master, release/*
 * and the configured integration branch. One predicate, so any future deletion path shares it. */
export function protectedBranch(name, target = null) {
  return ['develop', 'main', 'master'].includes(name) || /^release\//.test(name) || (nonempty(target) && name === target);
}

/** Cleanup fails closed with a recovery path; it never force-removes a tree. It deletes only the
 * local task branch (`git branch -d`, never -D); remote branch deletion is out of scope (TM-251). */
export async function cleanupTask(options) {
  const ctx = await context(options);
  return withLock(join(ctx.root, 'integration.lock'), async () => {
    const record = await loadRecord(ctx.path);
    try {
      invariant(record?.merge && record.collected, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Verified merge and collected results are required.');
      // Checked before anything is observed or removed: a protected branch is refused by name.
      invariant(!protectedBranch(record.branch, record.merge.target_branch), 'TOPOLOGY_MANAGEMENT_CLEANUP', `Refusing to clean up protected branch ${record.branch}: cleanup never touches develop, main, master, release/* or the integration branch.`);
      // TM-247 (AC8): a landed task's claim may already be released by tm done (integrate closes first).
      const doc = await ownedTask(ctx, options.task, record.owner, { released: true });
      invariant(record.worktree === doc.worktree && record.branch === doc.branch, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Task worktree ownership changed.');
      invariant(!(await gitText(doc.worktree, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Task tree has uncommitted work.');
      const head = await gitText(doc.worktree, ['rev-parse', 'HEAD']);
      invariant(head === record.merge.revision || await mergeInOf(doc.worktree, record.merge.revision, head, record.merge.target_branch, { gh: options.gh || defaultGh(ctx.store.root), env: ctx.env, home: ctx.home }), 'TOPOLOGY_MANAGEMENT_CLEANUP', `Task branch changed after integration (landed ${record.merge.revision}, now ${head}).`);
      invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', record.merge.revision, `refs/heads/${record.merge.target_branch}`], true)).code === 0, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Merge ancestry is no longer established.');
      const observe = value => options.workerState ? options.workerState(value) : taskWorkerState(options, value);
      const worker = await observe(record);
      invariant(worker.owned && worker.active === false, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Worker ownership or idle state is unproven.');
      if (worker.alive) {
        await (options.closeWorker || (value => closeOwnedPane(value, ctx.env)))(record);
        invariant((await observe(record)).alive === false, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Owned worker did not stop.');
      }
      await ctx.store.removeWorktree(options.task);
      await git(ctx.store.root, ['branch', '-d', '--', record.branch]);
      const next = await recordEvent(ctx, options.task, record, 'cleanup', { worktree: record.worktree, branch: record.branch, status: 'complete' });
      next.state = 'cleaned';
      await writeJson(ctx.path, next);
      await ctx.store.evidence(options.task, ctx.path);
      if (doc.status !== 'done') await ctx.store.done(options.task);
      return { cleaned: true, record: next };
    } catch (error) {
      const recovery = 'Preserve the task, results and worktree; resolve the named ownership, writer or landing gate, then retry cleanup.';
      await recordEvent(ctx, options.task, record, 'cleanup-blocked', { reason: error.message, recovery });
      return { cleaned: false, reason: error.message, recovery };
    }
  });
}

/** TM-247 (AC7): hand a governed admission to another lead session, recorded where both can see it
 * (a management-record event and a task comment). The owner may hand off to --to at any time; any
 * other session may take over only once the owner's claim is no longer live (released or expired),
 * so a lead that left does not strand its review rounds. A live bound worker refuses either way: its
 * identity names the old owner, so stop or retire it first. The admission, base, worktree, branch and
 * lead id are unchanged; only the owner and the claim move. */
export async function transferTask(options) {
  const ctx = await context(options);
  return withLock(`${ctx.path}.lock`, async () => {
    const record = await loadRecord(ctx.path), caller = options.owner;
    invariant(record?.started, 'TOPOLOGY_MANAGEMENT_TRANSFER', `${options.task} has no admission to transfer.`);
    invariant(nonempty(options.reason), 'TOPOLOGY_MANAGEMENT_TRANSFER', 'transfer requires a non-empty --reason.');
    invariant(nonempty(caller), 'TOPOLOGY_MANAGEMENT_TRANSFER', 'The caller has no session id (TM_SESSION_ID or AO_AGENT_ID).');
    const from = record.owner, to = nonempty(options.to) ? options.to.trim() : caller;
    invariant(to !== from, 'TOPOLOGY_MANAGEMENT_TRANSFER', `${options.task} is already owned by ${from}.`);
    invariant(caller === from || caller === to, 'TOPOLOGY_MANAGEMENT_TRANSFER', `Only the owner ${from} can hand ${options.task} to another session; another session can only take it over for itself.`);
    invariant(!record.worker || record.worker.stopped_at, 'TOPOLOGY_MANAGEMENT_TRANSFER', `${options.task} has a bound worker that is not stopped; stop or retire it with manage stop-worker first.`);
    const claim = await ctx.store.claim(options.task);
    invariant(!claim || claim.session === from || claim.session === to, 'TOPOLOGY_MANAGEMENT_OWNERSHIP', `${options.task} is claimed by ${claim?.session}, neither the owner ${from} nor ${to}; reconcile that claim first.`);
    invariant(caller === from || claim?.session !== from, 'TOPOLOGY_MANAGEMENT_TRANSFER', `${from} still holds a live claim on ${options.task}; ask it to run manage transfer --task ${options.task} --to ${to}, or wait for its claim to expire.`);
    if (caller !== from) {
      // TM-459: a takeover. `tm block` or `tm park` releases the claim while the owner is still alive,
      // so a released claim proves nothing. The caller must be proven to be this repository's lead, and
      // the owner must be proven gone: no live pane bound to it and no fresh heartbeat from it.
      const lookup = { consumer: options.consumer, env: ctx.env, home: ctx.home, listPanesFn: options.listPanesFn, readCensusFn: options.readCensusFn, callerProc: options.callerProc };
      const lead = await (options.requireLead || requireLeadCaller)(lookup);
      invariant(lead, 'TOPOLOGY_MANAGEMENT_TRANSFER', `Only this repository's proven lead may take over ${options.task} from ${from}; the caller is not it (requireLeadCaller). Ask ${from} to hand it over with manage transfer --to.`);
      const present = await (options.ownerPresence || ownerPresence)(ctx, lookup, from);
      invariant(!present, 'TOPOLOGY_MANAGEMENT_TRANSFER', `${from} is not proven absent (${present}); a released claim is not proof. Ask it to hand ${options.task} over with manage transfer --to, or retry once it has exited.`);
    }
    const doc = await ctx.store.show(options.task);
    invariant(doc.worktree && resolve(doc.worktree) === resolve(record.worktree), 'TOPOLOGY_MANAGEMENT_WORKTREE', 'Task worktree differs from the admission record; reconcile it before transferring.');
    try { await ctx.store.claimFor(options.task, to, record.worktree, claim?.session === from); }
    catch (error) { fail('TOPOLOGY_MANAGEMENT_OWNERSHIP', `Moving the claim on ${options.task} to ${to} failed: ${tmMessage(error)}`); }
    const next = await recordEvent(ctx, options.task, record, 'ownership-transfer', { from, to, by: caller, reason: options.reason.trim() });
    next.owner = to;
    next.transfers = [...(next.transfers || []), { from, to, by: caller, at: next.updated_at }];
    await writeJson(ctx.path, next);
    return { transferred: true, from, to, record: next };
  });
}

/** TM-459: why `owner` may still be alive, or null when nothing shows it is: a live pane the census
 * binds to it, or a heartbeat from it fresher than HEARTBEAT_TTL_MS. Unreadable panes are not absence. */
export async function ownerPresence(ctx, lookup, owner) {
  const census = await (lookup.readCensusFn || readCensus)({ consumer: lookup.consumer, env: ctx.env, home: ctx.home }).catch(() => null);
  for (const entry of (census?.agents || []).filter(a => a.agentId === owner && a.binding?.paneId)) {
    let panes;
    try { panes = await (lookup.listPanesFn || listServerPanes)({ tmuxServer: entry.binding.serverKey, env: ctx.env }); }
    catch (error) { return `its pane ${entry.binding.paneId} cannot be checked: ${error.message}`; }
    if (panes.some(pane => pane.alive && pane.paneId === entry.binding.paneId)) return `it has a live pane ${entry.binding.paneId}`;
  }
  const dir = heartbeatDir(ctx.env, ctx.home);
  for (const name of (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.json'))) {
    const beat = await readJson(join(dir, name)).catch(() => null);
    const age = Date.now() - Number(beat?.at);
    if (beat?.agent_id === owner && age >= 0 && age < HEARTBEAT_TTL_MS) return `it sent a heartbeat ${Math.round(age / 1000)}s ago`;
  }
  return null;
}

/** TM-247 (AC8): close a landed governed task in the one order that cannot strand a bound worker:
 * record the landing (only when none is recorded, from --landed and --reason), stop the worker, then
 * clean up, which removes the worktree and closes the task. Each step is the existing verb with its
 * own gates; the first refusal ends the sequence and is returned with its recovery. */
export async function closeTask(options) {
  const steps = [];
  let record = (await managementStatus(options)).management;
  if (!record?.merge) {
    invariant(nonempty(options.landed), 'TOPOLOGY_MANAGEMENT_CLOSE', `${options.task} has no recorded landing; pass --landed <commit> --reason <text> so close records it, or land it with manage integrate.`);
    record = await recordLanding(options);
    steps.push('recorded-landing');
  }
  if (record.worker && !record.worker.stopped_at) {
    const stopped = await stopTaskWorker(options);
    if (!stopped.stopped) return { closed: false, steps, refused: 'stop-worker', reason: stopped.reason, recovery: stopped.recovery };
    steps.push(stopped.retired ? 'worker-retired' : 'worker-stopped');
  }
  if (record.state !== 'cleaned') {
    const cleaned = await cleanupTask(options);
    if (!cleaned.cleaned) return { closed: false, steps, refused: 'cleanup', reason: cleaned.reason, recovery: cleaned.recovery };
    steps.push('cleaned');
  }
  return { closed: true, steps, record: (await managementStatus(options)).management };
}

export async function managementStatus(options) {
  const ctx = await context(options);
  return { task: await ctx.store.show(options.task), management: await loadRecord(ctx.path), claim: await ctx.store.claim(options.task) };
}

// ── Idle dispatch: handing a ready task to an agent that is ALREADY running ───
//
// A standing agent outlives any one task. `tm dispatch --backend idle` therefore does not launch
// anything: it claims the task, provisions the worktree through tm exactly as every other backend
// does, and then asks HERE for an idle agent to be bound to it.
//
// THE CENSUS IS A HINT; THIS RECORD IS THE AUTHORITY. The idle read and the assignment write happen
// inside ONE critical section, because they are one decision. Check idle in the scheduler and write
// the binding here and two ticks both see the same agent idle, both provision a worktree, and one
// pane silently interleaves two tasks.
//
// The lock is REPO-WIDE (`assignment.lock`), not the per-task `<task>.json.lock` every other verb in
// this file takes. Two different tasks racing for the same agent are the whole hazard, and two
// per-task locks are never contended with each other, so a per-task lock would leave exactly the
// double assignment this section exists to prevent. Same reasoning as `integration.lock`.
//
// ponytail: one lock for every assignment in a repository. Per-agent locks if assignment throughput
// ever matters — it is one write per dispatched task, so it does not.

const ASSIGNMENT_OUTCOMES = { DONE: 'done', BLOCKED: 'blocked', FAILED: 'failed' };
const assignmentLock = ctx => join(ctx.root, 'assignment.lock');
/**
 * The envelope id for one assignment. Derived, so a RETRIED assign delivers nothing twice — same
 * discipline as slot grants.
 *
 * `round` is load-bearing and not decoration. Without it the id is a pure function of
 * (repo, task, agent), so releasing an assignment and later handing the SAME task back to the SAME
 * agent recomputes the same id, `sendStandingMessage` dedupes to the already-delivered envelope,
 * and `assignmentResult` reads the PREVIOUS round's reply as this round's completion signal — the
 * task collects instantly with a stale outcome and nobody ever sees the second attempt. The round
 * is the count of assignments this record has already seen, which is stable across a retry of the
 * same attempt (nothing is written until delivery succeeded) and different across a reassignment.
 */
const assignmentMessageId = (ctx, task, agentId, round) =>
  createHash('sha256').update(`idle-dispatch:${ctx.identity.id}:${task}:${agentId}:${round}`).digest('hex').slice(0, 32);

/** Every unreleased assignment in this repository. Read under the assignment lock, never cached. */
async function heldAssignments(ctx) {
  const rows = [];
  for (const name of (await readdir(ctx.root).catch(() => [])).filter(n => /^TM-[0-9]+\.json$/.test(n))) {
    const record = await readJson(join(ctx.root, name)).catch(() => null);
    if (record?.assignee && !record.assignee.released_at) rows.push({ task: record.task, ...record.assignee });
  }
  return rows;
}

/**
 * What the assigned agent is told. It is a POINTER, never the handoff itself: the handoff is a file
 * in the task worktree that `tm` already rendered, and a standing agent's cwd is its own agent
 * directory by design, so the absolute path is the only thing that travels.
 *
 * TM_SESSION_ID is the DISPATCHING session, not a fresh synthetic id (CAP-0002). The claim on this
 * task is held by that session; `tm` run under any other id is a stranger to its own claim, so
 * `tm start` would refuse, `heartbeatClaim` would return null, and `ownedTask` below would reject
 * every later `manage` call from the agent. One owned claim, one session id, no new null-session
 * claims from this path.
 */
export function assignmentBody({ task, worktree, promptFile, session, agentId }) {
  return [
    `TASK ASSIGNMENT: ${task}`,
    '',
    `You are already running, so nothing was launched for this. The work is prepared:`,
    `  worktree     ${worktree}`,
    `  handoff      ${promptFile}`,
    '',
    `1. cd ${worktree}`,
    `2. export TM_SESSION_ID=${session}   # the claim on ${task} is held by this session id; tm refuses under any other`,
    `3. Read ${promptFile} and do exactly what it says. Close the task through the gates (\`tm done ${task}\`).`,
    '',
    `When you are finished, REPLY TO THIS MESSAGE. The reply is the completion signal — your session`,
    `is not expected to exit, and nothing is watching it for death. Start the reply with one word:`,
    `  DONE     you closed ${task} through the gates`,
    `  BLOCKED  you could not proceed; say why on the following lines`,
    `  FAILED   you tried and it did not work; say why on the following lines`,
    `Anything else is recorded as FAILED. "DONE" is a claim about the store and the store gets the`,
    `last word: if ${task} is not actually done, the result is downgraded to failed with the status`,
    `named. Then you are free again — you are ${agentId}, not this task.`,
  ].join('\n');
}

/** A reply body → the outcome recorded against the task. Unknown first word is an honest failure. */
export function parseAssignmentReply(body) {
  const text = String(body ?? '').trim();
  const first = text.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  return { outcome: ASSIGNMENT_OUTCOMES[first] ?? 'failed', summary: text };
}

/**
 * Bind one idle agent to one owned task, and deliver the pointer.
 *
 * Refuses, in order: a task this session does not own or that tm has not provisioned; a task that
 * already carries a live assignment; a stale census (a stale document is not old news, it is NO
 * news — the agent it calls idle has had a minute to start working); an agent that already holds an
 * unreleased assignment anywhere in this repository; an undeliverable pointer.
 */
export async function assignTaskToAgent(options) {
  const ctx = await context(options);
  const { task, owner, agent = null } = options;
  invariant(nonempty(owner), 'TOPOLOGY_MANAGEMENT_ASSIGN', 'Assignment requires the dispatching session id (TM_SESSION_ID); an unowned claim cannot be handed to anyone.');
  return withLock(assignmentLock(ctx), async () => {
    const doc = await ownedTask(ctx, task, owner);
    const prior = await loadRecord(ctx.path);
    invariant(!prior?.assignee || prior.assignee.released_at,
      'TOPOLOGY_MANAGEMENT_ASSIGNED', `${task} is already assigned to ${prior?.assignee?.agent_id}; release it before reassigning.`);
    const census = await (options.census ?? readCensus)({ ...options, identity: ctx.identity, env: ctx.env, home: ctx.home });
    invariant(census && !census.stale, 'TOPOLOGY_MANAGEMENT_CENSUS',
      'No fresh liveness census for this repository; start the repository supervisor. Nothing is dispatchable from a stale or missing census.');
    const held = new Set((await heldAssignments(ctx)).map(row => row.agent_id));
    const free = (census.agents ?? []).filter(row => row.dispatchable && !held.has(row.agentId));
    const pick = agent ? free.find(row => row.agentId === agent) : free[0];
    invariant(pick, 'TOPOLOGY_MANAGEMENT_NO_IDLE_AGENT', agent
      ? `${agent} is not an idle, unassigned agent in this repository right now.`
      : `No idle unassigned agent in this repository. Observed: ${(census.agents ?? []).map(row => `${row.agentId}=${row.state}`).join(', ') || 'none'}.`);
    // The census is a HINT even when it is fresh: `staleAfterMs` is 45s off the supervisor's
    // slowest rung, which is 45s in which a pane can exit. So the six-tuple is re-proved HERE,
    // inside the same critical section as the write, exactly as `observeWorker` proves a dispatched
    // worker's. Assigning to a pane that is already gone costs the task a whole collect cycle
    // before anyone notices, and the agent slot until someone releases it by hand.
    // TM-167: re-proved on the server the census binding names; no binding, nothing to prove.
    const panes = pick.binding ? await (options.listPanes ?? listServerPanes)({ tmuxServer: pick.binding.serverKey, env: ctx.env }) : [];
    invariant(pick.binding && panes.some(pane => pane.alive && bindingKeys.every(key => pane[key] === pick.binding[key])),
      'TOPOLOGY_MANAGEMENT_AGENT_GONE', `${pick.agentId} read as idle in the census but its pane incarnation is no longer live; nothing was assigned.`);
    const promptFile = options.promptFile ? (isAbsolute(options.promptFile) ? options.promptFile : join(doc.worktree, options.promptFile)) : join(doc.worktree, '.tm-dispatch-prompt.md');
    const round = (prior?.events ?? []).filter(entry => entry.event === 'assigned').length;
    const messageId = assignmentMessageId(ctx, task, pick.agentId, round);
    const mail = await (options.deliver ?? sendStandingMessage)({
      id: messageId, consumer: ctx.store.root, fromProject: ctx.store.root, from: options.from ?? 'tm-dispatch',
      to: pick.agentId, task, subject: `task assignment ${task}`, assignment: true,
      body: assignmentBody({ task, worktree: doc.worktree, promptFile, session: owner, agentId: pick.agentId }),
      provenance: { source: 'tm dispatch --backend idle' },
    }, { env: ctx.env, home: ctx.home });
    invariant(mail?.status === 'delivered', 'TOPOLOGY_MANAGEMENT_ASSIGN_UNDELIVERED',
      `The assignment pointer for ${task} could not be delivered to ${pick.agentId}: ${mail?.reason ?? 'unknown'}.`);
    const assignee = { agent_id: pick.agentId, session_name: pick.sessionName ?? null, binding: pick.binding ?? null,
      message_id: messageId, round, owner, worktree: doc.worktree, prompt_file: promptFile, assigned_at: nowIso(), released_at: null };
    const record = await recordEvent(ctx, task, prior, 'assigned', { assignee });
    record.assignee = assignee;
    await writeJson(ctx.path, record);
    return { assigned: true, task, agent_id: pick.agentId, message_id: messageId, worktree: doc.worktree, prompt_file: promptFile };
  });
}

/**
 * The completion signal, which is the REPLY and not session death — the standing session outlives
 * the task, which is the entire point of dispatching to it. `{ pending: true }` while the assignment
 * is live and unanswered; a read, never a wait.
 */
export async function assignmentResult(options) {
  const ctx = await context({ ...options, store: options.store ?? { root: null } });
  const record = await loadRecord(ctx.path);
  const assignee = record?.assignee ?? null;
  // TM-360: tm's one duplicate-dispatch guard reads this verb, so a worker this lead started or
  // adopted (and has not stopped) is reported alongside the idle-dispatch assignee.
  const live = record?.worker && !record.worker.stopped_at
    ? { worker: { kind: record.worker.kind ?? null, backend: record.worker.backend ?? null, run: record.worker.run ?? null }, owner: record.owner ?? null } : {};
  if (!assignee) return { assigned: false, reason: `${options.task} has no idle-dispatch assignment.`, ...live };
  if (assignee.released_at) return { assigned: false, released_at: assignee.released_at, agent_id: assignee.agent_id, ...live };
  const mail = await (options.readMessage ?? readStandingMessage)({ id: assignee.message_id, env: ctx.env, home: ctx.home });
  if (!mail?.reply) return { assigned: true, pending: true, agent_id: assignee.agent_id, message_id: assignee.message_id, ...live };
  return { assigned: true, pending: false, agent_id: assignee.agent_id, message_id: assignee.message_id,
    replied_at: mail.reply.created_at, ...parseAssignmentReply(mail.reply.body), ...live };
}

/**
 * Free the agent. Idempotent, and it keeps the record: an assignment that happened is history, and
 * `heldAssignments` reads `released_at` rather than the absence of a row.
 */
export async function releaseAssignment(options) {
  const ctx = await context({ ...options, store: options.store ?? { root: null } });
  return withLock(assignmentLock(ctx), async () => {
    const record = await loadRecord(ctx.path);
    if (!record?.assignee) return { released: false, reason: `${options.task} has no idle-dispatch assignment.` };
    if (record.assignee.released_at) return { released: false, already: true, agent_id: record.assignee.agent_id, released_at: record.assignee.released_at };
    const assignee = { ...record.assignee, released_at: nowIso(), release_reason: options.reason ?? null };
    await writeJson(ctx.path, { ...record, assignee, updated_at: assignee.released_at,
      events: [...(record.events || []), { event: 'assignment-released', at: assignee.released_at, agent_id: assignee.agent_id, reason: assignee.release_reason }] });
    return { released: true, agent_id: assignee.agent_id, task: options.task };
  });
}
