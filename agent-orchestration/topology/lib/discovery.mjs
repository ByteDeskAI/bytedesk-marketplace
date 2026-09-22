// Discovery is a projection. Native ACP snapshots and topology journals remain authoritative.
// This module is dependency-free so both the bundled broker and installed topology CLI can use it.
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalRepoId, repoKey, repositoryConsumer, stateRoot } from './repoid.mjs';
import { invariant, isInside, nowIso, readJson, run as command, writeJson } from './util.mjs';
import { withLock } from './lockfile.mjs';
import { incarnationOf } from './incarnation.mjs';
import * as tmux from './tmux.mjs';

export const WORKFLOW_INDEX_VERSION = 1;
const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const TERMINAL = new Set(['stopped', 'succeeded', 'completed', 'failed', 'cancelled', 'timed_out', 'rejected']);
const parsed = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const homeOf = options => resolve(options.stateHome || stateRoot(options.env));

export async function workflowRepository(consumer) {
  invariant(typeof consumer === 'string' && isAbsolute(consumer), 'TOPOLOGY_REPO_REQUIRED', 'Pass an absolute consumer repository path.');
  invariant((await stat(consumer)).isDirectory(), 'TOPOLOGY_REPO_REQUIRED', 'Consumer must be an existing directory.');
  const identity = await canonicalRepoId(consumer);
  return { id: identity.id, key: repoKey(identity.id), root: await repositoryConsumer(consumer) };
}

export function workflowIndexPath(repository, options = {}) {
  return join(homeOf(options), 'workflow-index', 'v1', repository.key, 'index.json');
}

export function durableTopologyRoot(repository, options = {}) {
  return join(homeOf(options), 'repositories', repository.key, 'topology', 'runs');
}

export async function topologyRunLocation({ consumer, nativeRunId, ...options }) {
  invariant(NATIVE_ID.test(nativeRunId), 'TOPOLOGY_INVALID_RUN_ID', 'Run ID must be one safe path component.');
  const repository = await workflowRepository(consumer);
  return { repository, stateHome: homeOf(options), runDir: join(durableTopologyRoot(repository, options), nativeRunId) };
}

async function cachedJson(path) {
  const info = await stat(path);
  const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const old = parsed.get(path);
  if (old?.stamp === stamp) return old.value;
  const value = await readJson(path);
  if (parsed.size > 2048) parsed.clear();
  parsed.set(path, { stamp, value });
  return value;
}

export async function readWorkflowIndex({ consumer, ...options }) {
  const repository = await workflowRepository(consumer);
  const path = workflowIndexPath(repository, options);
  const index = await readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!index) return { schemaVersion: 1, revision: '0', repository, updatedAt: null, workflows: [], rejected: [] };
  invariant(index.schemaVersion === 1 && /^[0-9]+$/.test(index.revision) && index.repository?.id === repository.id && index.repository?.key === repository.key && Array.isArray(index.workflows),
    'TOPOLOGY_DISCOVERY_REPOSITORY', 'Workflow index does not belong to this repository.');
  return index;
}

async function publish(repository, entry, options) {
  const path = workflowIndexPath(repository, options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return withLock(`${path}.lock`, async () => {
    const index = await readWorkflowIndex({ consumer: repository.root, ...options });
    const parent = index.workflows.find(item => item.workflowId === entry.lineage.parentWorkflowId);
    if (parent) entry.lineage.rootWorkflowId = parent.lineage.rootWorkflowId;
    const previous = index.workflows.find(item => item.workflowId === entry.workflowId);
    const equal = previous && JSON.stringify({ ...previous, revision: undefined }) === JSON.stringify({ ...entry, revision: undefined });
    if (equal) return previous;
    entry.revision = String(BigInt(previous?.revision || '0') + 1n);
    index.workflows = [...index.workflows.filter(item => item.workflowId !== entry.workflowId), entry].sort((a, b) => a.workflowId.localeCompare(b.workflowId));
    index.revision = String(BigInt(index.revision) + 1n);
    index.updatedAt = nowIso();
    await writeJson(path, index);
    return entry;
  });
}

function topologyShape(run) {
  invariant(run?.version === 1 && NATIVE_ID.test(run.run_id) && typeof run.name === 'string' && run.name.length > 0 &&
    typeof run.consumer === 'string' && isAbsolute(run.consumer) && Array.isArray(run.agents),
  'TOPOLOGY_INVALID_RUN_RECORD', 'Native topology record lacks its run, workflow, repository, or member identity.');
}

export async function publishTopologyWorkflow({ run, recordPath, ...options }) {
  topologyShape(run);
  options = { ...options, stateHome: options.stateHome || run.state_home };
  const repository = run.repository || await workflowRepository(run.consumer);
  invariant(repository.key === repoKey(repository.id), 'TOPOLOGY_DISCOVERY_REPOSITORY', 'Invalid canonical repository key.');
  const workflowId = `topology:${run.run_id}`;
  const journal = await stat(join(dirname(recordPath), 'journal.jsonl')).catch(() => null);
  return publish(repository, {
    workflowId, runtime: 'topology', nativeRunId: run.run_id, repositoryId: repository.id, repositoryRoot: repository.root,
    workflowName: run.name, taskId: run.task_id || (/^tm-(TM-[0-9]+)$/i.exec(run.name)?.[1]?.toUpperCase()) || null,
    lineage: { parentWorkflowId: run.parent?.run_id ? `topology:${run.parent.run_id}` : null,
      retryOfWorkflowId: run.retry_of ? `topology:${run.retry_of}` : null, rootWorkflowId: run.root_workflow_id || (run.parent?.run_id ? `topology:${run.parent.run_id}` : workflowId) },
    recordPath: resolve(recordPath), recordFormat: 'topology.run.v1',
    ...(options.durableRecordPath ? { durableRecordPath: options.durableRecordPath } : {}),
    ...(options.legacySourcePath ? { legacySourcePath: options.legacySourcePath } : {}),
    workloadCwd: run.workload_cwd || run.cwd || run.consumer,
    writeAuthority: run.write_authority || { mode: 'native-provider-permissions', checkoutRoot: run.consumer },
    state: run.state, createdAt: run.created || null, updatedAt: run.updated || run.created || null,
    journalRevision: journal ? `${journal.size}:${journal.mtimeMs}` : null,
    nativeRevision: String(run.revision || 0), revision: '0',
  }, options);
}

export async function publishACPWorkflow({ snapshot, recordPath, ...options }) {
  // Old test/partial records without an admitted common Git identity cannot enter discovery.
  if (!snapshot?.consumer?.commonGitDir || !snapshot.runId) return null;
  const common = snapshot.consumer.commonGitDir;
  const repository = { id: common, key: repoKey(common), root: basename(common) === '.git' ? dirname(common) : await repositoryConsumer(snapshot.consumer.checkoutRoot) };
  const workflowId = `acp:${snapshot.runId}`;
  return publish(repository, {
    workflowId, runtime: 'acp', nativeRunId: snapshot.runId, repositoryId: repository.id, repositoryRoot: repository.root,
    workflowName: snapshot.input?.workflowName || snapshot.plan?.protocolId || snapshot.input?.protocolId || snapshot.input?.intent || 'ACP workflow',
    taskId: snapshot.input?.taskId || null,
    lineage: { parentWorkflowId: snapshot.parentRunId ? `acp:${snapshot.parentRunId}` : null, retryOfWorkflowId: null,
      rootWorkflowId: snapshot.parentRunId ? `acp:${snapshot.parentRunId}` : workflowId },
    recordPath: resolve(recordPath), recordFormat: 'acp.snapshot.v1', workloadCwd: snapshot.consumer.requestedCwd || snapshot.consumer.checkoutRoot,
    writeAuthority: { mode: snapshot.input?.permissionProfile || snapshot.plan?.permissionProfile || 'read', checkoutRoot: snapshot.consumer.checkoutRoot },
    state: snapshot.state, createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt, nativeRevision: String(snapshot.revision || 0), revision: '0',
  }, options);
}

export async function registeredWorktrees(consumer) {
  const repository = await workflowRepository(consumer);
  const result = await command('git', ['-C', consumer, 'worktree', 'list', '--porcelain', '-z'], { allowFailure: true, timeoutMs: 10_000 });
  if (result.code !== 0) return [repository.root];
  const paths = result.stdout.split('\0').filter(part => part.startsWith('worktree ')).map(part => part.slice(9));
  const accepted = [];
  for (const path of paths) {
    if ((await canonicalRepoId(path)).id === repository.id) accepted.push(await realpath(path));
  }
  return [...new Set(accepted)];
}

async function nativeFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name, 'run.json'));
}

async function manifest(root) {
  const files = [];
  async function walk(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      invariant(!item.isSymbolicLink(), 'TOPOLOGY_PRESERVATION_SYMLINK', `Evidence contains a symlink: ${path}. Preserve and inspect it before cleanup.`);
      if (item.isDirectory()) await walk(path);
      else {
        invariant(item.isFile(), 'TOPOLOGY_PRESERVATION_FILE', `Evidence contains a non-regular file: ${path}.`);
        const info = await lstat(path);
        files.push({ path: path.slice(root.length + 1), bytes: info.size, sha256: digest(await readFile(path)) });
      }
    }
  }
  await walk(root);
  return files;
}

async function preservation(run, sourcePath, repository, options) {
  const source = dirname(sourcePath), target = join(durableTopologyRoot(repository, options), run.run_id);
  if (resolve(source) === resolve(target)) return { nativeRunId: run.run_id, recordPath: sourcePath, sourcePath, preserved: true, verified: true };
  const before = await manifest(source);
  const temporary = `${target}.import-${randomUUID()}`;
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await cp(source, temporary, { recursive: true, dereference: false, errorOnExist: true, force: false });
    const copied = await manifest(temporary), after = await manifest(source);
    invariant(JSON.stringify(before) === JSON.stringify(copied) && JSON.stringify(before) === JSON.stringify(after),
      'TOPOLOGY_PRESERVATION_CHANGED', 'Workflow evidence changed while being copied; cleanup must wait.');
    const existing = await manifest(join(target, 'legacy-evidence')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) invariant(JSON.stringify(existing) === JSON.stringify(copied), 'TOPOLOGY_PRESERVATION_CONFLICT', 'Durable history differs from legacy evidence; preserve both and resolve the conflict before cleanup.');
    else {
      invariant(!(await stat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; })), 'TOPOLOGY_PRESERVATION_CONFLICT', 'A different native run already occupies the durable destination.');
      // Retain an exact byte copy of every original file. The working native projection can then
      // acquire canonical storage metadata without depending on a soon-to-be-deleted worktree.
      await cp(source, join(temporary, 'legacy-evidence'), { recursive: true, dereference: false, errorOnExist: true, force: false });
      invariant(JSON.stringify(await manifest(join(temporary, 'legacy-evidence'))) === JSON.stringify(before) && JSON.stringify(await manifest(source)) === JSON.stringify(before),
        'TOPOLOGY_PRESERVATION_CHANGED', 'Workflow evidence changed during preservation.');
      await writeJson(join(temporary, 'preservation.json'), { schemaVersion: 1, repository, sourcePath, files: before, preservedAt: nowIso() });
      const archived = { ...run, repository, state_home: homeOf(options), run_dir: target,
        workload_cwd: run.workload_cwd || run.cwd || run.consumer,
        write_authority: run.write_authority || { mode: 'native-provider-permissions', checkoutRoot: run.consumer },
        artifacts_dir: run.artifacts_dir && isInside(source, run.artifacts_dir) ? join(target, run.artifacts_dir.slice(source.length + 1)) : run.artifacts_dir,
        legacy_import: { sourcePath, originalRecordPath: join(target, 'legacy-evidence', 'run.json') } };
      await writeJson(join(temporary, 'run.json'), archived);
      await rename(temporary, target);
    }
    return { nativeRunId: run.run_id, recordPath: join(target, 'run.json'), sourcePath, preserved: true, verified: true };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function belongs(run, sourcePath, repository) {
  topologyShape(run);
  invariant(run.run_id === basename(dirname(sourcePath)), 'TOPOLOGY_INVALID_RUN_RECORD', 'Run ID differs from its native directory name.');
  const identity = run.repository || await workflowRepository(run.consumer);
  invariant(identity.id === repository.id, 'TOPOLOGY_DISCOVERY_REPOSITORY', 'Native record belongs to another repository.');
}

async function assertPreservationStopped(run, tmuxApi) {
  const members = run.agents.filter(agent => agent.pane);
  invariant(members.length > 0 || !run.session_creation_attempted, 'TOPOLOGY_PRESERVATION_UNCERTAIN', 'Session creation was attempted without an exact binding; preserve its worktree for inspection.');
  for (const member of members) {
    const binding = incarnationOf(member.binding);
    invariant(binding && binding.paneId === member.pane, 'TOPOLOGY_PRESERVATION_UNCERTAIN', 'Workflow has no exact member binding; preserve its worktree for inspection.');
    const panes = await tmuxApi.listServerPanes({ tmuxServer: binding.serverKey, session: run.session });
    invariant(!panes.some(pane => pane.sessionId === binding.sessionId && pane.sessionCreated === binding.sessionCreated && pane.serverPid === binding.serverPid),
      'TOPOLOGY_PRESERVATION_ACTIVE', 'A recorded workflow session still exists; cleanup must wait.');
  }
}

export async function preserveWorktreeWorkflows({ consumer, worktree, tmuxApi = tmux, ...options }) {
  const repository = await workflowRepository(consumer), roots = await registeredWorktrees(consumer);
  const target = await realpath(worktree);
  invariant(roots.includes(target), 'TOPOLOGY_WORKTREE_NOT_REGISTERED', 'Cleanup target is not a registered worktree of this repository.');
  const records = [], rejected = [];
  for (const path of await nativeFiles(durableTopologyRoot(repository, options))) {
    try {
      const run = await cachedJson(path);
      if (!isInside(target, run.workload_cwd || run.consumer || '')) continue;
      await belongs(run, path, repository);
      invariant(TERMINAL.has(run.state), 'TOPOLOGY_PRESERVATION_ACTIVE', 'A durable workflow still uses this worktree; stop it before cleanup.');
      await assertPreservationStopped(run, tmuxApi);
      records.push({ nativeRunId: run.run_id, recordPath: path, sourcePath: path, preserved: true, verified: true });
    } catch (error) { rejected.push({ path, code: error.code || 'TOPOLOGY_PRESERVATION_FAILED', message: error.message }); }
  }
  for (const root of [join(target, '.bytedesk', 'agent-orchestration', 'runs'), join(target, '.orchestration', 'runs')]) {
    for (const path of await nativeFiles(root)) {
      try {
        const run = await cachedJson(path); await belongs(run, path, repository);
        invariant(TERMINAL.has(run.state), 'TOPOLOGY_PRESERVATION_ACTIVE', 'Legacy workflow is live or uncertain; stop it with exact ownership checks before removing its worktree.');
        await assertPreservationStopped(run, tmuxApi);
        const record = await preservation(run, path, repository, options); records.push(record);
        await publishTopologyWorkflow({ run: await readJson(record.recordPath), recordPath: record.recordPath, legacySourcePath: path, ...options });
      } catch (error) { rejected.push({ path, code: error.code || 'TOPOLOGY_PRESERVATION_FAILED', message: error.message }); }
    }
  }
  return { ok: rejected.length === 0, repository, records, rejected };
}

export async function reconcileWorkflows({ consumer, ...options }) {
  const repository = await workflowRepository(consumer), rejected = [];
  const root = durableTopologyRoot(repository, options);
  const locations = [root];
  for (const worktree of await registeredWorktrees(consumer)) locations.push(join(worktree, '.bytedesk', 'agent-orchestration', 'runs'), join(worktree, '.orchestration', 'runs'));
  const seen = new Map(), valid = new Set();
  for (const location of locations) {
    for (const path of await nativeFiles(location)) {
      try {
        const real = await realpath(path);
        invariant(isInside(await realpath(location), real), 'TOPOLOGY_DISCOVERY_BOUNDARY', 'Native record escapes its repository state directory.');
        const run = await cachedJson(path); await belongs(run, path, repository);
        const duplicate = seen.get(run.run_id);
        if (duplicate) {
          invariant(duplicate.path === path || duplicate.legacySourcePath === path, 'TOPOLOGY_DISCOVERY_DUPLICATE', 'Another native record already owns this run ID; preserve both records for inspection.');
          continue;
        }
        seen.set(run.run_id, { path, legacySourcePath: run.legacy_import?.sourcePath });
        let recordPath = path;
        if (location !== root && TERMINAL.has(run.state)) recordPath = (await preservation(run, path, repository, options)).recordPath;
        await publishTopologyWorkflow({ run: recordPath === path ? run : await readJson(recordPath), recordPath,
          ...(location !== root || run.legacy_import ? { legacySourcePath: run.legacy_import?.sourcePath || path } : {}), ...options });
        valid.add(`topology:${run.run_id}`);
      } catch (error) { rejected.push({ path, code: error.code || 'TOPOLOGY_DISCOVERY_FAILED', message: error.message }); }
    }
  }
  // ACP lives in its own store. Import valid snapshots without changing that native format.
  for (const directory of await readdir(join(homeOf(options), 'runs'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!directory.isDirectory() || !directory.name.startsWith('run_')) continue;
    const path = join(homeOf(options), 'runs', directory.name, 'snapshot.json');
    try {
      const snapshot = await cachedJson(path);
      if (snapshot.consumer?.commonGitDir !== repository.id) continue;
      invariant(snapshot.runId === directory.name && snapshot.schemaVersion === 1, 'TOPOLOGY_INVALID_ACP_RECORD', 'ACP snapshot identity differs from its directory.');
      await publishACPWorkflow({ snapshot, recordPath: path, ...options });
      valid.add(`acp:${snapshot.runId}`);
    } catch (error) { if (error.code !== 'ENOENT') rejected.push({ path, code: error.code || 'TOPOLOGY_DISCOVERY_FAILED', message: error.message }); }
  }
  const indexPath = workflowIndexPath(repository, options);
  await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
  return withLock(`${indexPath}.lock`, async () => {
    const index = await readWorkflowIndex({ consumer, ...options });
    // A concurrent launch can publish after scanning began. Recheck its actual native record;
    // never erase that publication merely because it was absent from an earlier directory list.
    const workflows = [];
    for (const entry of index.workflows) {
      if (valid.has(entry.workflowId)) { workflows.push(entry); continue; }
      try {
        const native = await cachedJson(entry.recordPath);
        if (entry.runtime === 'topology') await belongs(native, entry.recordPath, repository);
        else invariant(native.runId === entry.nativeRunId && native.consumer?.commonGitDir === repository.id, 'TOPOLOGY_DISCOVERY_REPOSITORY', 'ACP identity mismatch.');
        workflows.push(entry);
      } catch (error) { if (!rejected.some(item => item.path === entry.recordPath)) rejected.push({ path: entry.recordPath, code: error.code || 'TOPOLOGY_DISCOVERY_FAILED', message: error.message }); }
    }
    if (JSON.stringify(index.workflows) !== JSON.stringify(workflows) || JSON.stringify(index.rejected || []) !== JSON.stringify(rejected)) {
      index.workflows = workflows; index.rejected = rejected; index.revision = String(BigInt(index.revision) + 1n); index.updatedAt = nowIso();
      await writeJson(indexPath, index);
    }
    return { ...index, rejected };
  });
}
