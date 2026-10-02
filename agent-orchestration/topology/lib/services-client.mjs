// TM-272: the topology layer's view of the managed services (src/services). The topology layer runs
// unbundled from the installed plugin and the implementation source tree is not shipped, so it
// cannot import src/services; it reaches `services ensure` through the committed bundle instead.
// This file owns the one piece of state both sides write: the registered-repository list.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { readJson, writeJson } from './util.mjs';

/**
 * Services are the default. `AGENT_ORCHESTRATION_SERVICES=0` keeps the pre-TM-272 launchers.
 * A caller-supplied env that does not mention the variable falls back to this process's, so a test
 * preload that turns services off cannot be bypassed by a test that builds its env from scratch.
 */
export function servicesEnabled(env = process.env) {
  const value = env.AGENT_ORCHESTRATION_SERVICES ?? process.env.AGENT_ORCHESTRATION_SERVICES;
  return value !== '0';
}

export function servicesDir(env = process.env, home = homedir()) {
  return join(stateRoot(env, home), 'services');
}

export function reposPath(env = process.env, home = homedir()) {
  return join(servicesDir(env, home), 'repos.json');
}

export async function readServiceRepos(env = process.env, home = homedir()) {
  const value = await readJson(reposPath(env, home)).catch(() => null);
  return Array.isArray(value?.repos) ? value.repos : [];
}

/** Adds one repository to the supervise list. Returns true when the list changed. */
export async function addServiceRepo(consumer, { env = process.env, home = homedir() } = {}) {
  const key = repoKey((await canonicalRepoId(consumer)).id);
  return withLock(`${reposPath(env, home)}.lock`, async () => {
    const repos = await readServiceRepos(env, home);
    if (repos.some((repo) => repo.key === key)) return false;
    await writeJson(reposPath(env, home), { repos: [...repos, { key, consumer }] });
    return true;
  });
}

/**
 * TM-289: drops one repository from the supervise list, matched by key OR by the consumer path it
 * was registered with — a deleted checkout no longer resolves to the canonical id it had, so its key
 * cannot be recomputed. Returns true when the list changed.
 */
export async function removeServiceRepo({ key, consumer }, { env = process.env, home = homedir() } = {}) {
  return withLock(`${reposPath(env, home)}.lock`, async () => {
    const repos = await readServiceRepos(env, home);
    const kept = repos.filter((repo) => repo.key !== key && repo.consumer !== consumer);
    if (kept.length === repos.length) return false;
    await writeJson(reposPath(env, home), { repos: kept });
    return true;
  });
}

/** Runs `agent-orchestration services ensure` from the bundle next to this tree. */
export function runServicesEnsure({ env = process.env, timeoutMs = 120_000 } = {}) {
  const cli = fileURLToPath(new URL('../../dist/cli.cjs', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'services', 'ensure', '--json'], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      let report = null;
      try { report = JSON.parse(stdout); } catch { /* reported below */ }
      resolve(code === 0 && report?.ok ? report : { ok: false, code, error: report?.message ?? stderr.trim().slice(-2000) });
    });
  });
}
