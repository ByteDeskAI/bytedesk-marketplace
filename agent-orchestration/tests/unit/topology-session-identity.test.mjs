// TM-353 (EP-028): every session gets an AO identity; unregistered recipients resolve via presence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { callerIdentity, mintSessionIdentity, resolvePresentRecipient, sessionAgentId } from '../../topology/lib/session-identity.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { run, writeJson } from '../../topology/lib/util.mjs';

const pluginRoot = fileURLToPath(new URL('../..', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-session-id-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', repo]);
  await writeJson(join(agentsRoot(repo), 'work0001', 'agent.json'), { id: 'work0001', role: 'worker', full_name: 'Worker' });
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  return { root, repo, home, env };
}

// A child env with no inherited agent identity, so the test measures the minted one.
function cleanEnv(extra) {
  const env = { ...process.env, AO_TRANSPORT: 'file', TMUX: '', TMUX_PANE: '', ...extra };
  for (const key of ['AO_AGENT_ID', 'AO_CONSUMER', 'AO_SESSION_AGENT_ID', 'AO_SESSION_CONSUMER', 'AO_LEAD_ID']) delete env[key];
  return env;
}

function node(args, { env, input = '' }) {
  const result = spawnSync(process.execPath, args, { env, input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function exportsOf(text) {
  return Object.fromEntries([...text.matchAll(/^export ([A-Z_]+)='([^']*)'$/gm)].map((m) => [m[1], m[2]]));
}

test('SessionStart mints an identity that a bare mailbox send uses as its sender', async (t) => {
  const f = await fixture(t);
  const envFile = join(f.root, 'claude-env');
  await writeFile(envFile, '');
  const env = cleanEnv({ ...f.env, HOME: f.home, CLAUDE_ENV_FILE: envFile });
  const hook = node([join(pluginRoot, 'topology/session-hook.mjs')], {
    env, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session-one', cwd: f.repo }) });
  const minted = sessionAgentId('session-one');
  assert.match(hook.stdout, new RegExp(minted));
  const exported = exportsOf(await readFile(envFile, 'utf8'));
  assert.deepEqual(exported, { AO_SESSION_AGENT_ID: minted, AO_SESSION_CONSUMER: f.repo });

  // No --from and no AO_AGENT_ID: the sender is the minted identity, not a borrowed lead's.
  const sent = node([join(pluginRoot, 'topology/cli.mjs'), 'mailbox', 'send', '--consumer', f.repo,
    '--to', 'work0001', '--id', 'bare-send', '--body', 'hello'], { env: { ...env, ...exported } });
  const record = JSON.parse(sent.stdout);
  assert.equal(record.reason, null, `held as ${record.reason}`);
  assert.equal(record.status, 'delivered');
  assert.equal(record.envelope.from, minted);
  assert.equal(record.envelope.fromProject, f.repo);
});

test('a launcher session keeps its own identity and is not re-minted', async (t) => {
  const f = await fixture(t);
  const envFile = join(f.root, 'claude-env');
  await writeFile(envFile, '');
  const result = await mintSessionIdentity({ sessionId: 's', cwd: f.repo, env: { ...f.env, AO_AGENT_ID: 'lead0001', CLAUDE_ENV_FILE: envFile }, home: f.home });
  assert.equal(result.minted, false);
  assert.equal(await readFile(envFile, 'utf8'), '');
  assert.deepEqual(callerIdentity({ AO_AGENT_ID: 'lead0001', AO_CONSUMER: f.repo, AO_SESSION_AGENT_ID: 'b0000000' }), { agentId: 'lead0001', consumer: f.repo, source: 'launcher' });
  assert.deepEqual(callerIdentity({ AO_SESSION_AGENT_ID: 'b0000000', AO_SESSION_CONSUMER: f.repo }), { agentId: 'b0000000', consumer: f.repo, source: 'session' });
  assert.equal(callerIdentity({}), null);
});

test('a recipient present in presence or minted at SessionStart resolves instead of holding unknown_recipient', async (t) => {
  const f = await fixture(t);
  const base = { consumer: f.repo, fromProject: f.repo, from: 'send0001', body: 'hi' };
  const opts = { env: f.env, home: f.home };
  const codexPane = [{ agentId: 'c0de0001', session: { sessionName: 'host-repo-worker-codex' } }];

  const absent = await sendStandingMessage({ ...base, id: 'absent', to: 'c0de0001' }, { ...opts, presence: async () => [] });
  assert.equal(absent.reason, 'unknown_recipient');

  const present = await sendStandingMessage({ ...base, id: 'present', to: 'c0de0001' }, { ...opts, presence: async () => codexPane });
  assert.equal(present.status, 'delivered');
  assert.equal(present.delivered_to, 'c0de0001');
  assert.equal(present.decision.resolved_via, 'presence');

  const byName = await sendStandingMessage({ ...base, id: 'by-name', to: 'host-repo-worker-codex' }, { ...opts, presence: async () => codexPane });
  assert.equal(byName.delivered_to, 'c0de0001');

  const other = await mintSessionIdentity({ sessionId: 'other-session', cwd: f.repo, env: f.env, home: f.home, envFile: null });
  const toSession = await sendStandingMessage({ ...base, id: 'to-session', to: other.agentId }, { ...opts, presence: async () => [] });
  assert.equal(toSession.delivered_to, other.agentId);
  assert.equal(toSession.decision.resolved_via, 'session-identity');

  // The library still wins: a library agent is never re-resolved through presence.
  const library = await sendStandingMessage({ ...base, id: 'library', to: 'work0001' }, { ...opts, presence: async () => assert.fail('library hit must not consult presence') });
  assert.equal(library.delivered_to, 'work0001');

  // The production presence path runs (no tmux binding here, so it finds nothing) rather than throwing.
  assert.equal(await resolvePresentRecipient({ consumer: f.repo, to: 'c0de0001', env: f.env, home: f.home }), null);
});
