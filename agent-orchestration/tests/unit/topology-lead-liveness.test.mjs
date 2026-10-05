// TM-209: `lead status --cached` is a non-blocking read. TM-222: a lead mid-turn is alive and busy,
// not unresponsive, when a harness heartbeat from its exact pane says so.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadRegistryDir, leadState } from '../../topology/lib/lead.mjs';
import { HEARTBEAT_TTL_MS } from '../../topology/lib/heartbeat.mjs';
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
  return { root, consumer, home, env, record, probes: join(registryDir, 'probes'), heartbeats: join(registryDir, '..', 'heartbeats') };
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

const BINDING = { serverKey: '/isolated/live-test', serverPid: 100, sessionId: '$1', sessionCreated: 200, paneId: '%2', panePid: process.pid };

function beat(f, event, { pane = BINDING.paneId, serverPid = BINDING.serverPid } = {}) {
  // The real hook, as Claude Code runs it: this test process is its ancestor, so panePid matches.
  node([join(pluginRoot, 'topology/session-hook.mjs'), event], { env: { ...process.env, ...f.env, HOME: f.home,
    TMUX: `${BINDING.serverKey},${serverPid},0`, TMUX_PANE: pane }, input: JSON.stringify({ hook_event_name: event }) });
}

test('a lead mid-turn with a harness heartbeat from its exact pane is responsive and busy, not unresponsive', async (t) => {
  const f = await fixture(t, BINDING);
  const opts = { consumer: f.consumer, home: f.home, env: f.env, pluginRoot, ackTimeoutMs: 0, probes: { alive: async () => true } };
  assert.equal((await leadState(opts)).status, 'unresponsive', 'control: mid-turn with no heartbeat and no ack');

  beat(f, 'PostToolUse');
  const busy = await leadState({ ...opts, ackTimeoutMs: 1000, probes: { alive: async () => true } });
  assert.equal(busy.status, 'responsive');
  assert.equal(busy.verdict_source, 'heartbeat');
  assert.equal(busy.busy, true);
  assert.equal(await exists(f.probes), false, 'a heartbeat answers without ringing the lead');

  beat(f, 'Stop');
  assert.equal((await leadState(opts)).busy, false, 'Stop means between turns');
});

test('a dead, rebound or silent lead is still detected despite heartbeats', async (t) => {
  const f = await fixture(t, BINDING);
  const opts = { consumer: f.consumer, home: f.home, env: f.env, pluginRoot, ackTimeoutMs: 0, probes: { alive: async () => true } };
  beat(f, 'PostToolUse');
  assert.equal((await leadState({ ...opts, probes: { alive: async () => false } })).status, 'registered', 'a dead pane is dead whatever its last heartbeat said');

  const { writeJson: write } = await import('../../topology/lib/util.mjs');
  const { heartbeatPath } = await import('../../topology/lib/heartbeat.mjs');
  const path = heartbeatPath(f.heartbeats, BINDING.serverKey, BINDING.paneId);
  const fresh = { serverKey: BINDING.serverKey, serverPid: BINDING.serverPid, paneId: BINDING.paneId, pids: [BINDING.panePid], event: 'PostToolUse', at: Date.now() };
  for (const [why, value] of [
    ['a respawned pane: the heartbeat came from another process', { ...fresh, pids: [1, 2, 3] }],
    ['another tmux server incarnation', { ...fresh, serverPid: 999 }],
    ['a heartbeat older than the window', { ...fresh, at: Date.now() - HEARTBEAT_TTL_MS - 1 }],
  ]) {
    await write(path, value);
    assert.equal((await leadState(opts)).status, 'unresponsive', why);
  }
  await rm(path);
  beat(f, 'PostToolUse', { pane: '%9' });
  assert.equal((await leadState(opts)).status, 'unresponsive', 'another pane cannot vouch for the lead');
});
