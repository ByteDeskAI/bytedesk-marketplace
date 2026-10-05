// TM-379: one doctor answers for AO, task-management and the managed services. tm is reached through
// its CLI on a real temp store (never imported); services status is injected, so nothing real is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { combinedHealth } from '../../src/diagnostics.mjs';

const exec = promisify(execFile);
const TM = fileURLToPath(new URL('../../../task-management/bin/tm', import.meta.url));
const healthy = { processCompose: { alive: true }, processes: [{ name: 'session-host', state: 'Running', ready: 'Ready' }] };
const down = { processCompose: { alive: false }, processes: [] };

async function store(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ao-combined-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  await mkdir(join(root, 'home'), { recursive: true });
  await exec('git', ['init', '-q', repo]);
  const env = { ...process.env, HOME: join(root, 'home'), TM_ROOT: repo, TM_NTFY_OFF: '1', CLAUDE_CODE_SESSION_ID: 'combined-doctor' };
  delete env.CLAUDE_PROJECT_DIR; delete env.TM_ENFORCE;
  const tm = (...args) => exec(process.execPath, [TM, ...args], { cwd: repo, env });
  await tm('init');
  return { repo, env, tm };
}

const check = (repo, env, { aoOk = true, services = healthy, servicesOn = true } = {}) => combinedHealth({
  aoOk, consumerCwd: repo, stateRoot: '/nonexistent', pluginFreshness: { status: 'unknown' },
  env: { ...env, AGENT_ORCHESTRATION_SERVICES: servicesOn ? '1' : '0' },
  deps: { tmLauncher: async () => TM, servicesStatus: async () => services },
});

test('TM-379: healthy AO, store and services is ok; each unhealthy part alone fails the whole', async (t) => {
  const { repo, env } = await store(t);
  const all = await check(repo, env);
  assert.equal(all.ok, true);
  assert.deepEqual([all.agentOrchestration.ok, all.services.ok, all.taskManagement.ok], [true, true, true]);
  assert.equal(all.taskManagement.errors, 0);
  assert.equal(all.pluginFreshness, 'unknown');

  assert.equal((await check(repo, env, { aoOk: false })).ok, false, 'AO unhealthy');
  const servicesDown = await check(repo, env, { services: down });
  assert.equal(servicesDown.ok, false, 'services down');
  assert.equal(servicesDown.services.alive, false);
  const off = await check(repo, env, { services: down, servicesOn: false });
  assert.equal(off.ok, true, 'services that are switched off are not a failure');
  assert.equal(off.services.ok, null);
});

test('TM-379: an error in the task store fails the combined doctor and is named', async (t) => {
  const { repo, env, tm } = await store(t);
  await tm('epic', 'new', 'work');
  await tm('task', 'new', 'a task', '--body', 'context', '--ac', 'it works');
  const dir = join(repo, '.bytedesk', 'task-management', 'tasks');
  const file = join(dir, (await readdir(dir)).find((name) => name.startsWith('TM-001')));
  await writeFile(file, (await readFile(file, 'utf8')).replace('blockedBy: []', 'blockedBy: ["TM-999"]'));
  const result = await check(repo, env);
  assert.equal(result.ok, false);
  assert.equal(result.taskManagement.ok, false);
  assert.ok(result.taskManagement.errors >= 1);
  assert.match(result.taskManagement.problems.join('\n'), /TM-999/);
});

test('TM-379: without task-management the store is not checked and does not fail the doctor', async (t) => {
  const { repo, env } = await store(t);
  const result = await combinedHealth({ aoOk: true, consumerCwd: repo, stateRoot: '/nonexistent', env: { ...env, AGENT_ORCHESTRATION_SERVICES: '0' },
    deps: { tmLauncher: async () => null } });
  assert.equal(result.ok, true);
  assert.equal(result.taskManagement.present, false);
  assert.equal(result.taskManagement.ok, null);
});
