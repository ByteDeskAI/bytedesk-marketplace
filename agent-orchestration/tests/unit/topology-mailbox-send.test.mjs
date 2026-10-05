// EP-028 standing-mail SEND side, driven through the real CLI entries: TM-278 dry run, TM-271
// addressing a repository's lead, TM-356 the sender is the session's identity, TM-372 @all-leads.
//
// No tmux server is touched: the env blanks TMUX and points TMUX_TMPDIR at a scratch dir. Every
// repository opts out of enrollment, so a cross-repository hold can never start a supervisor or a lead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { readStandingInbox, standingMailboxRoot } from '../../topology/lib/standing-mailbox.mjs';
import { run, writeJson } from '../../topology/lib/util.mjs';

const aoTopology = fileURLToPath(new URL('../../bin/ao-topology', import.meta.url));

async function repo(root, name, agents) {
  const dir = join(root, name);
  await run('git', ['init', '-q', dir]);
  await mkdir(join(dir, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(dir, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  for (const [id, role] of agents) await writeJson(join(agentsRoot(dir), id, 'agent.json'), { id, role, full_name: id });
  return dir;
}

async function world(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-mailbox-send-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AO_')));
  Object.assign(env, { TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: join(root, 'home'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_TRANSPORT: 'file' });
  const alpha = await repo(root, 'alpha', [['lead-a', 'lead'], ['work-a', 'worker']]);
  return { root, env, alpha, as: (agent, consumer) => ({ ...env, AO_AGENT_ID: agent, AO_CONSUMER: consumer }) };
}

function ao(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [aoTopology, ...args, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out: ${args.join(' ')}`)); }, 60_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(stdout); } catch { /* reported by the caller's assertion */ }
      resolve({ code, json, stdout, stderr });
    });
  });
}

async function standingRecords(env) {
  return readdir(join(standingMailboxRoot({ env }), 'messages')).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
}

test('TM-278: mailbox send --dry-run reports the verdict and writes no envelope', async (t) => {
  const w = await world(t);
  const preview = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'dry-1', '--body', 'hello', '--dry-run'], w.as('work-a', w.alpha));
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.json.dry_run, true);
  assert.equal(preview.json.would, 'deliver');
  assert.equal(preview.json.delivered_to, 'lead-a');
  assert.equal(preview.json.envelope.from, 'work-a');
  assert.ok(preview.json.destination.repo_id, 'the destination repository is named');
  assert.deepEqual(await standingRecords(w.env), [], 'a dry run leaves no record in the standing mailbox');
  assert.deepEqual(await readStandingInbox({ consumer: w.alpha, agent: 'lead-a', env: w.env }), []);

  // A hold is reported with its reason, and still nothing is written.
  const held = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'nobody-here', '--id', 'dry-2', '--body', 'hello', '--dry-run'], w.as('work-a', w.alpha));
  assert.equal(held.code, 0, held.stderr);
  assert.deepEqual([held.json.would, held.json.reason], ['hold', 'unknown_recipient']);
  assert.deepEqual(await standingRecords(w.env), []);

  // The same send without the flag really writes: the check above can see a record when there is one.
  const real = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'dry-1', '--body', 'hello'], w.as('work-a', w.alpha));
  assert.equal(real.json.status, 'delivered', real.stderr);
  assert.equal((await standingRecords(w.env)).length, 1);
});

test('TM-278: every other send verb refuses --dry-run by name and does nothing', async (t) => {
  const w = await world(t);
  for (const args of [
    ['mailbox', 'forward', '--consumer', w.alpha, '--parent', 'x', '--to', 'lead-a', '--body', 'b'],
    ['mailbox', 'reply', '--consumer', w.alpha, '--message', 'x', '--body', 'b'],
    ['mailbox', 'dispose', '--consumer', w.alpha, '--message', 'x', '--disposition', 'handled'],
    ['send', '--run', w.root, '--to', 'lead-a', '--body', 'b'],
    ['reply', '--run', w.root, '--agent', 'lead-a', '--message', 'x', '--body', 'b'],
  ]) {
    const refused = await ao([...args, '--dry-run'], w.as('work-a', w.alpha));
    assert.equal(refused.code, 1, `${args.slice(0, 2).join(' ')}: ${refused.stdout}`);
    assert.equal(refused.json.code, 'TOPOLOGY_DRY_RUN_UNSUPPORTED', `${args.slice(0, 2).join(' ')}: ${refused.stdout}`);
  }
  assert.deepEqual(await standingRecords(w.env), []);
});
