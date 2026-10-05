// TM-250: `manage cutover` and `manage cut-release`, the External-class verbs of ADR-0001
// (production deploy, release publish). agent-orchestration never deploys, restarts a host, pushes
// or tags by itself: each verb runs only the repository's OWN configured argv (deploy-safe.sh,
// release-gitflow.sh), without a shell, and only after every named guardrail holds.
//
//   management.cutover = { branch, argv, postflight_argv?, identity_argv, timeout_ms? }
//   management.release = { branch, argv, verify_argv, finish_argv?, timeout_ms? }
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { managedSessionEvidence } from './delegation.mjs';
import { foreignDirtyPaths, taskStore } from './management.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { fail, nowIso, run, writeJson } from './util.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const git = (cwd, args) => run('git', ['-C', cwd, ...args], { allowFailure: true });

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

/** Every External-class authority this verb has, or a refusal. TM-250: an operator shell passing
 * --authorized. A managed agent session never self-asserts it. */
async function externalAuthority(options, env, home, verb) {
  const managed = await managedSessionEvidence({ env, ancestors: options.ancestors, home });
  if (options.authorized === true && !managed.length) return { authorization: { decision: verb, class: 'external', adr: 'ADR-0001', channel: 'operator-explicit', actor: env.USER || 'operator', at: nowIso() } };
  return { refusal: options.authorized === true
    ? `--authorized cannot be self-asserted inside a managed agent session (${managed[0]})`
    : `${verb} is an External-class action (ADR-0001); pass --authorized from an operator shell` };
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

  // All planned tasks landed: the approved plan is an epic, and every one of its tasks is done.
  const epic = options.epic;
  if (!nonempty(epic)) refuse('plan', `name the approved plan with --epic EP-n; ${verb} runs only when every task in it has landed`);
  else {
    try {
      const store = options.store || await taskStore(options);
      const open = [];
      for (const id of await store.epicTasks(epic)) { const doc = await store.show(id); if (doc.status !== 'done') open.push(`${id} (${doc.status})`); }
      if (open.length) refuse('plan', `${epic} still has tasks that have not landed: ${open.join(', ')}`);
    } catch (error) { refuse('plan', `cannot read ${epic} from the task store: ${error.message}`); }
  }
  return { ready: refusals.length === 0, refusals, root, branch, revision, config, authorization, loaded, env };
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
  const steps = [], stopped = (code, message) => fail(code, message, { steps });
  const probe = async () => { const r = await step(gate, gate.config.identity_argv, 'identity'); steps.push(r); return r.code === 0 ? r.stdout : null; };
  const before = await probe();
  if (!before) stopped('TOPOLOGY_CUTOVER_REFUSED', 'manage cutover refused (identity): the running binary identity probe gave no answer before cutover, so a switch could not be proven; nothing was deployed.');
  const deploy = await step(gate, gate.config.argv, 'deploy'); steps.push(deploy);
  if (deploy.code !== 0) stopped('TOPOLOGY_CUTOVER_FAILED', `cutover step ${gate.config.argv.join(' ')} exited ${deploy.code}: ${deploy.stderr || deploy.stdout}`);
  if (gate.config.postflight_argv) {
    const post = await step(gate, gate.config.postflight_argv, 'postflight'); steps.push(post);
    if (post.code !== 0) stopped('TOPOLOGY_CUTOVER_POSTFLIGHT', `postflight ${gate.config.postflight_argv.join(' ')} exited ${post.code}: ${post.stderr || post.stdout}`);
  }
  const after = await probe();
  if (!after || after === before) stopped('TOPOLOGY_CUTOVER_NOT_SWITCHED', `the running binary did not switch: identity was ${before} and is ${after ?? 'unreadable'} after cutover.`);
  return writeRecord(options, gate, 'cutover', { kind: 'cutover', at: nowIso(), branch: gate.branch, revision: gate.revision, epic: options.epic, identity: { before, after }, steps, authorization: gate.authorization });
}

/** TM-250: the repository's /release behind guardrails: from the release branch's source (develop)
 * to release/*, then the configured verify proves the published result. */
export async function cutRelease(options) {
  const gate = await releaseReadiness(options, 'release');
  if (!gate.ready) refuseNamed('TOPOLOGY_RELEASE_REFUSED', 'cut-release', gate.refusals);
  const steps = [], stopped = (code, message) => fail(code, message, { steps });
  const cut = await step(gate, gate.config.argv, 'release'); steps.push(cut);
  if (cut.code !== 0) stopped('TOPOLOGY_RELEASE_FAILED', `release step ${gate.config.argv.join(' ')} exited ${cut.code}: ${cut.stderr || cut.stdout}`);
  const verify = await step(gate, gate.config.verify_argv, 'verify'); steps.push(verify);
  if (verify.code !== 0) stopped('TOPOLOGY_RELEASE_POSTFLIGHT', `release verify ${gate.config.verify_argv.join(' ')} exited ${verify.code}; the published result is not proven: ${verify.stderr || verify.stdout}`);
  if (gate.config.finish_argv) {
    const finish = await step(gate, gate.config.finish_argv, 'finish'); steps.push(finish);
    if (finish.code !== 0) stopped('TOPOLOGY_RELEASE_FAILED', `release finish ${gate.config.finish_argv.join(' ')} exited ${finish.code}: ${finish.stderr || finish.stdout}`);
  }
  return writeRecord(options, gate, 'release', { kind: 'release', at: nowIso(), branch: gate.branch, revision: gate.revision, epic: options.epic, verified: true, steps, authorization: gate.authorization });
}
