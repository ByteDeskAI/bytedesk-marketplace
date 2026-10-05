// TM-209: `lead status --cached` is a non-blocking read.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadRegistryDir, leadState } from '../../topology/lib/lead.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { exists, run, writeJson } from '../../topology/lib/util.mjs';
import { isolatedTmux } from '../helpers/isolated-tmux.mjs';

const pluginRoot = fileURLToPath(new URL('../..', import.meta.url));

async function fixture(t, binding) {
  const root = await mkdtemp(join(tmpdir(), 'ao-lead-live-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', consumer]);
  const env = { XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const identity = await canonicalRepoId(consumer);
  const registryDir = leadRegistryDir(env, home);
  const record = { repo_id: identity.id, agent_id: 'lead0001', session: 'lead', pane: binding.paneId, consumer, provider: 'claude', binding };
  await writeJson(join(registryDir, `${repoKey(identity.id)}.json`), record);
  return { root, consumer, home, env, record, probes: join(registryDir, 'probes') };
}

function node(args, { env, input = '' }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { env, input, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  return { ...result, ms: Date.now() - started };
}

test('lead status --cached answers in under a second, names its source and writes no probe', async (t) => {
  const iso = isolatedTmux(t);
  await iso.tmux(['new-session', '-d', '-s', 'lead', 'sleep', '120']);
  const shown = (await iso.tmux(['display-message', '-p', '-t', 'lead', '#{socket_path}\t#{pid}\t#{session_id}\t#{session_created}\t#{pane_id}\t#{pane_pid}'])).stdout.trim().split('\t');
  const binding = { serverKey: shown[0], serverPid: Number(shown[1]), sessionId: shown[2], sessionCreated: Number(shown[3]), paneId: shown[4], panePid: Number(shown[5]) };
  const f = await fixture(t, binding);
  // A short default wait, so the blocking path is measurable without costing the suite 30s.
  const env = { ...iso.env, ...f.env, HOME: f.home, AO_TRANSPORT: 'file', AO_LEAD_ACK_TIMEOUT_MS: '1500' };
  const status = (extra) => node([join(pluginRoot, 'topology/cli.mjs'), 'lead', 'status', ...extra, '--consumer', f.consumer], { env });

  const cached = status(['--cached']);
  const out = JSON.parse(cached.stdout);
  assert.equal(out.status, 'unresponsive');
  assert.equal(out.verdict_source, 'none');
  assert.equal(out.proof_age_ms, null);
  assert.ok(cached.ms < 1000, `--cached took ${cached.ms}ms`);
  assert.equal(await exists(f.probes), false, '--cached mints no probe');

  // With proof on disk, --cached reports it with its age, still without a probe.
  await writeJson(join(f.probes, 'lead0001.answered.json'), { at: Date.now() - 5000, agent_id: 'lead0001', repo_id: f.record.repo_id, session: 'lead', binding });
  const proven = JSON.parse(status(['--cached']).stdout);
  assert.equal(proven.status, 'responsive');
  assert.equal(proven.verdict_source, 'cached');
  assert.ok(proven.proof_age_ms >= 5000, `proof_age_ms ${proven.proof_age_ms}`);
  assert.deepEqual(await readdir(f.probes), ['lead0001.answered.json']);

  // Control: the default path still blocks and mints a probe, so the assertions above can fail.
  await rm(f.probes, { recursive: true, force: true });
  const blocking = status([]);
  assert.ok(blocking.ms >= 1500, `default status waited ${blocking.ms}ms`);
  assert.ok((await readdir(f.probes)).some((name) => name.endsWith('.json') && !name.includes('answered')), 'the default path mints a probe');
});
