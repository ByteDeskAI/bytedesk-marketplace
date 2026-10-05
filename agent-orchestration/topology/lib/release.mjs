// TM-250: `manage cutover` and `manage cut-release`, the External-class verbs of ADR-0001
// (production deploy, release publish). agent-orchestration never deploys, restarts a host, pushes
// or tags by itself: each verb runs only the repository's OWN configured argv (deploy-safe.sh,
// release-gitflow.sh), without a shell, and only after every named guardrail holds.
//
//   management.cutover = { branch, argv, postflight_argv?, identity_argv, timeout_ms? }
//   management.release = { branch, argv, verify_argv, finish_argv?, timeout_ms?,
//                          teamcity?: { build_type, url?, timeout_ms?, poll_ms? } }
//
// TM-368: `management.autonomy` (pr | merge | publish, default pr) drives `manage land`, and at
// `publish` it is the grant for these External-class verbs; the record names the layer that set it.
// A stop after anything has run (a failed step, a red or missing TeamCity build, a failed verify or
// postflight, a missing reviewer approval) pages the operator through ntfy.
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { autonomyOf, loadConfig } from './config.mjs';
import { managedSessionEvidence } from './delegation.mjs';
import { foreignDirtyPaths, integrateTask, integrationEligibility, recordTaskEvent, taskStore } from './management.mjs';
import { page } from './ntfy.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { teamcityClient, teamcityTarget } from './teamcity.mjs';
import { fail, nowIso, run, writeJson } from './util.mjs';
import { safeGit } from './safe-git.mjs';

/** TM-368: the effective autonomy policy for this repository and the config layer that set it. */
export async function resolveAutonomy(options, loaded = null) {
  return autonomyOf(loaded || await loadConfig(options));
}

/** Page, then throw: the run stops, and the operator hears about it whether or not ntfy answers. */
async function stop(options, loaded, code, message, details = {}) {
  const paged = await (options.page || page)({ title: `agent-orchestration: ${code}`, body: `${options.consumer}\n${message}`, config: loaded?.config?.management?.ntfy || {}, env: options.env || process.env });
  fail(code, message, { ...details, paged });
}

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const git = (cwd, args) => safeGit(cwd, args, { allowFailure: true }); // TM-443

/** A lead never runs these directly, and neither does a configured step: the step must be the
 * repository's own script. ponytail: argv[0] only; the script itself is the repo's reviewed code. */
export const FORBIDDEN_EXECUTABLES = Object.freeze(['systemctl', 'launchctl', 'service', 'sudo', 'doas', 'git', 'gh', 'sh', 'bash', 'zsh', 'dash', 'env', 'ssh']);
export function argvProblem(argv, key) {
  if (!Array.isArray(argv) || !argv.length || !argv.every(nonempty)) return `configure ${key} as a nonempty argv array`;
  const exe = basename(argv[0]);
  if (FORBIDDEN_EXECUTABLES.includes(exe)) return `${key} runs ${exe} directly; it must name the repository's own script (deploy-safe.sh, release-gitflow.sh), never ${FORBIDDEN_EXECUTABLES.join(', ')}`;
  return null;
}

const STEPS = {
  cutover: { required: ['argv', 'identity_argv'], optional: ['postflight_argv'] },
  release: { required: ['argv', 'verify_argv'], optional: ['finish_argv'] },
};

/** Every External-class authority this verb has, or a refusal: the autonomy policy at `publish`
 * (TM-368, the operator's standing grant, recorded with the layer that holds it), or an operator
 * shell passing --authorized (TM-250). A managed agent session never self-asserts it. */
async function externalAuthority(options, env, home, verb, loaded) {
  const base = { decision: verb, class: 'external', adr: 'ADR-0001', at: nowIso() };
  const autonomy = await resolveAutonomy(options, loaded);
  if (autonomy.level === 'publish') return { authorization: { ...base, channel: 'autonomy-policy', autonomy: autonomy.level, granted_by: { scope: autonomy.scope, path: autonomy.path }, actor: env.AO_AGENT_ID || env.USER || 'lead' } };
  const managed = await managedSessionEvidence({ env, ancestors: options.ancestors, home });
  if (options.authorized === true && !managed.length) return { authorization: { ...base, channel: 'operator-explicit', actor: env.USER || 'operator' } };
  return { refusal: options.authorized === true
    ? `--authorized cannot be self-asserted inside a managed agent session (${managed[0]}); autonomy is "${autonomy.level}", and only "publish" grants ${verb}`
    : `${verb} is an External-class action (ADR-0001); autonomy is "${autonomy.level}", so pass --authorized from an operator shell or set management.autonomy to "publish"` };
}

/** Read-only gate: every condition is checked and every failure is named, nothing runs. */
export async function releaseReadiness(options, kind) {
  const env = options.env || process.env, home = options.home || homedir();
  const verb = kind === 'cutover' ? 'cutover' : 'release';
  const refusals = [], refuse = (condition, reason) => refusals.push({ condition, reason });
  const loaded = await loadConfig(options);
  if (loaded.errors.length) refuse('config', `configuration is invalid: ${loaded.errors.map(e => e.message).join('; ')}`);
  const config = loaded.config.management?.[kind] || {};
  for (const key of STEPS[kind].required) { const problem = argvProblem(config[key], `management.${kind}.${key}`); if (problem) refuse('config', problem); }
  for (const key of STEPS[kind].optional) { if (config[key] !== undefined) { const problem = argvProblem(config[key], `management.${kind}.${key}`); if (problem) refuse('config', problem); } }
  const branch = nonempty(config.branch) ? config.branch : 'develop';
  const { authorization, refusal } = await (options.authority || externalAuthority)(options, env, home, verb, loaded);
  if (refusal) refuse('authority', refusal);

  const top = await git(options.consumer, ['rev-parse', '--show-toplevel']);
  const root = top.code === 0 ? top.stdout.trim() : null;
  let revision = null;
  if (!root) refuse('repository', `${options.consumer} is not a Git checkout`);
  else {
    const current = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
    if (current !== branch) refuse('branch', `${verb} runs only from ${branch}; the checkout is on ${current || 'a detached HEAD'}`);
    const foreign = await foreignDirtyPaths(root);
    if (foreign.length) refuse('dirty', `the checkout has uncommitted work outside the tool store paths: ${foreign.slice(0, 5).join(', ')}`);
    const fetched = await git(root, ['fetch', '--quiet', 'origin', branch]);
    revision = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const remote = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])).stdout.trim();
    if (fetched.code !== 0) refuse('sync', `cannot fetch origin/${branch}: ${fetched.stderr.trim()}`);
    else if (remote !== revision) refuse('sync', `${branch} is at ${revision}, origin/${branch} is at ${remote || 'nothing'}; ${verb} runs only from a checkout synced with origin`);
  }

  // All planned tasks landed: the approved plan is an epic (or, for a task with no epic, the task
  // list `manage land` passes), and every one of its tasks is done.
  const epic = options.epic;
  if (!nonempty(epic) && !Array.isArray(options.planTasks)) refuse('plan', `name the approved plan with --epic EP-n; ${verb} runs only when every task in it has landed`);
  else {
    try {
      const open = await openPlanTasks(options);
      if (open.length) refuse('plan', `${epic || 'the plan'} still has tasks that have not landed: ${open.join(', ')}`);
    } catch (error) { refuse('plan', `cannot read ${epic || 'the plan'} from the task store: ${error.message}`); }
  }

  // TM-368: a release waits for its TeamCity build. Under the autonomy policy that wait is required,
  // so a red build can stop the run; an operator may release without one configured.
  let teamcity = null;
  if (kind === 'release') {
    const tc = config.teamcity;
    if (tc !== undefined || authorization?.channel === 'autonomy-policy') {
      if (!nonempty(tc?.build_type)) refuse('teamcity', 'configure management.release.teamcity.build_type: under autonomy "publish" a release must wait for its TeamCity build');
      else {
        const target = teamcityTarget({ config: tc, env });
        if (target.reason) refuse('teamcity', target.reason);
        else teamcity = { ...target, build_type: tc.build_type, timeout_ms: tc.timeout_ms, poll_ms: tc.poll_ms };
      }
    }
  }
  return { ready: refusals.length === 0, refusals, root, branch, revision, config, authorization, loaded, env, teamcity };
}

async function openPlanTasks(options) {
  const store = options.store || await taskStore(options);
  const ids = nonempty(options.epic) ? await store.epicTasks(options.epic) : options.planTasks;
  const open = [];
  // landedTask: the task manage land just merged; its landing is recorded even before tm closes it.
  for (const id of ids.filter(id => id !== options.landedTask)) { const doc = await store.show(id); if (doc.status !== 'done') open.push(`${id} (${doc.status})`); }
  return open;
}

const refuseNamed = (code, verb, refusals) => fail(code, `manage ${verb} refused (${[...new Set(refusals.map(r => r.condition))].join(', ')}): ${refusals.map(r => `${r.condition}: ${r.reason}`).join('; ')}`, { refusals });

async function step(gate, argv, name) {
  const [exe, ...args] = argv;
  const command = isAbsolute(exe) || !exe.includes('/') ? exe : resolve(gate.root, exe);
  const result = await run(command, args, { cwd: gate.root, env: gate.env, allowFailure: true, timeoutMs: gate.config.timeout_ms || 3_600_000 });
  return { name, argv, code: result.code, stdout: result.stdout.trim().slice(-2000), stderr: result.stderr.trim().slice(-2000) };
}

async function writeRecord(options, gate, kind, record) {
  const identity = await canonicalRepoId(options.consumer);
  const path = join(stateRoot(options.env || process.env, options.home || homedir()), 'management', repoKey(identity.id), 'releases', `${kind}-${record.at.replace(/[:.]/g, '-')}.json`);
  await writeJson(path, record);
  return { ...record, path };
}

/** TM-250: deploy-safe behind guardrails. It proves the running binary switched: the configured
 * identity probe must answer before, and answer something different after. */
export async function cutover(options) {
  const gate = await releaseReadiness(options, 'cutover');
  if (!gate.ready) refuseNamed('TOPOLOGY_CUTOVER_REFUSED', 'cutover', gate.refusals);
  const steps = [], stopped = (code, message) => stop(options, gate.loaded, code, message, { steps });
  const probe = async () => { const r = await step(gate, gate.config.identity_argv, 'identity'); steps.push(r); return r.code === 0 ? r.stdout : null; };
  const before = await probe();
  if (!before) fail('TOPOLOGY_CUTOVER_REFUSED', 'manage cutover refused (identity): the running binary identity probe gave no answer before cutover, so a switch could not be proven; nothing was deployed.', { steps });
  const deploy = await step(gate, gate.config.argv, 'deploy'); steps.push(deploy);
  if (deploy.code !== 0) await stopped('TOPOLOGY_CUTOVER_FAILED', `cutover step ${gate.config.argv.join(' ')} exited ${deploy.code}: ${deploy.stderr || deploy.stdout}`);
  if (gate.config.postflight_argv) {
    const post = await step(gate, gate.config.postflight_argv, 'postflight'); steps.push(post);
    if (post.code !== 0) await stopped('TOPOLOGY_CUTOVER_POSTFLIGHT', `postflight ${gate.config.postflight_argv.join(' ')} exited ${post.code}: ${post.stderr || post.stdout}`);
  }
  const after = await probe();
  if (!after || after === before) await stopped('TOPOLOGY_CUTOVER_NOT_SWITCHED', `the running binary did not switch: identity was ${before} and is ${after ?? 'unreadable'} after cutover.`);
  return writeRecord(options, gate, 'cutover', { kind: 'cutover', at: nowIso(), branch: gate.branch, revision: gate.revision, epic: options.epic, identity: { before, after }, steps, authorization: gate.authorization });
}

/** TM-250: the repository's /release behind guardrails: from the release branch's source (develop)
 * to release/*. TM-368: it then waits for the TeamCity build the release started, and the
 * configured verify proves the published artifact. */
export async function cutRelease(options) {
  const gate = await releaseReadiness(options, 'release');
  if (!gate.ready) refuseNamed('TOPOLOGY_RELEASE_REFUSED', 'cut-release', gate.refusals);
  const steps = [], stopped = (code, message, extra = {}) => stop(options, gate.loaded, code, message, { steps, ...extra });
  const tc = gate.teamcity, client = tc && (options.teamcity || teamcityClient(tc));
  let since = null, build = null;
  if (tc) {
    // Read before anything runs, so a TeamCity that cannot answer refuses with nothing released.
    try { since = await client.latestBuildId(tc.build_type); }
    catch (error) { refuseNamed('TOPOLOGY_RELEASE_REFUSED', 'cut-release', [{ condition: 'teamcity', reason: error.message }]); }
  }
  const cut = await step(gate, gate.config.argv, 'release'); steps.push(cut);
  if (cut.code !== 0) await stopped('TOPOLOGY_RELEASE_FAILED', `release step ${gate.config.argv.join(' ')} exited ${cut.code}: ${cut.stderr || cut.stdout}`);
  if (tc) {
    try { build = await client.waitForBuild({ buildType: tc.build_type, after: since, timeoutMs: tc.timeout_ms, pollMs: tc.poll_ms }); }
    catch (error) { await stopped('TOPOLOGY_RELEASE_BUILD_UNKNOWN', `the release ran, but TeamCity could not be read: ${error.message}`); }
    if (build.timeout) await stopped('TOPOLOGY_RELEASE_BUILD_TIMEOUT', `no finished TeamCity ${tc.build_type} build after the release${build.build ? ` (build ${build.build.number ?? build.build.id} is ${build.build.state})` : ''}.`, { build: build.build });
    if (build.status !== 'SUCCESS') await stopped('TOPOLOGY_RELEASE_BUILD_RED', `TeamCity ${tc.build_type} build ${build.number ?? build.id} is ${build.status}${build.statusText ? `: ${build.statusText}` : ''}${build.webUrl ? ` (${build.webUrl})` : ''}.`, { build });
  }
  const verify = await step(gate, gate.config.verify_argv, 'verify'); steps.push(verify);
  if (verify.code !== 0) await stopped('TOPOLOGY_RELEASE_POSTFLIGHT', `release verify ${gate.config.verify_argv.join(' ')} exited ${verify.code}; the published artifact is not proven: ${verify.stderr || verify.stdout}`);
  if (gate.config.finish_argv) {
    const finish = await step(gate, gate.config.finish_argv, 'finish'); steps.push(finish);
    if (finish.code !== 0) await stopped('TOPOLOGY_RELEASE_FAILED', `release finish ${gate.config.finish_argv.join(' ')} exited ${finish.code}: ${finish.stderr || finish.stdout}`);
  }
  const teamcity = build ? { build_type: tc.build_type, id: build.id, number: build.number ?? null, status: build.status, web_url: build.webUrl ?? null } : null;
  return writeRecord(options, gate, 'release', { kind: 'release', at: nowIso(), branch: gate.branch, revision: gate.revision, epic: options.epic ?? null, teamcity, verified: true, steps, authorization: gate.authorization });
}

/** TM-368: the lead's landing path, driven by management.autonomy.
 *   pr      stop at the reviewed pull request; a human merges.
 *   merge   manage integrate (its own authority and guardrails unchanged).
 *   publish integrate, then, once every task of the plan has landed, cut-release (TeamCity wait and
 *           verify included), record the publish with its grant source, and notify the origin. */
export async function landTask(options) {
  const loaded = await loadConfig(options);
  const autonomy = autonomyOf(loaded), base = { task: options.task, autonomy };
  if (autonomy.level === 'pr') return { ...base, landed: false, stopped: 'pr', reason: 'autonomy is "pr": the lead stops at the reviewed pull request, and a human merges it' };

  const gate = await integrationEligibility(options);
  let record = gate.record;
  if (!['merged', 'cleaned'].includes(record?.state)) {
    // Missing reviewer approval stops the run and pages. No review computed means the protocol is
    // incomplete, which integrate refuses by name.
    if (gate.review) {
      const verdict = gate.review.status?.review?.verdict, reasons = gate.refusals.filter(r => r.condition === 'review').map(r => r.reason);
      if (verdict !== 'approve' || reasons.length) await stop(options, loaded, 'TOPOLOGY_LAND_REVIEW', `${options.task} has no reviewer approval (verdict ${verdict ?? 'missing'}${reasons.length ? `; ${reasons.join('; ')}` : ''}); the landing stopped before merge.`);
    }
    record = await (options.integrate || integrateTask)(options);
  }
  if (autonomy.level === 'merge') return { ...base, landed: true, merge: record.merge };
  if (record.published) return { ...base, landed: true, published: true, release: record.published, already: true };

  const store = options.store || await taskStore(options);
  const doc = await store.show(options.task);
  const plan = doc.epic ? { epic: doc.epic } : { epic: null, planTasks: [options.task] };
  // This task's own landing is recorded above; the fast-forward path closes it only at cleanup.
  const waiting = await openPlanTasks({ ...options, ...plan, store, landedTask: options.task });
  if (waiting.length) return { ...base, landed: true, published: false, waiting, reason: `publish waits until every task of ${plan.epic || options.task} has landed` };

  // A refused release after a merge is still an autonomous run that stopped: page it too. Every
  // other cut-release stop has already paged.
  const release = await cutRelease({ ...options, ...plan, store, landedTask: options.task }).catch(async error => {
    if (error.code === 'TOPOLOGY_RELEASE_REFUSED') await stop(options, loaded, error.code, `${options.task} merged, but publishing stopped: ${error.message}`, error.details);
    throw error;
  });
  const published = { release: release.path, revision: release.revision, teamcity: release.teamcity, verified: release.verified, authorization: release.authorization, at: release.at };
  await recordTaskEvent({ ...options, store }, 'publish', published, { published });
  let origin = null;
  if (doc.origin?.repo) {
    const detail = `released ${release.revision.slice(0, 12)}${release.teamcity ? `, TeamCity ${release.teamcity.build_type} build ${release.teamcity.number ?? release.teamcity.id} ${release.teamcity.status}` : ''}, artifact verified`;
    try { await store.ticketEvent(options.task, 'published', detail); origin = { notified: true, detail }; }
    catch (error) { origin = { notified: false, reason: error.message }; }
  }
  return { ...base, landed: true, published: true, release, origin };
}
