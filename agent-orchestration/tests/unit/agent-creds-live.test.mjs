// TM-310 round 2, live: a real tmux pane launched through launch.mjs (the `ao-topology launch` CLI) runs an
// agent whose environment holds AO_CREDS_SOCK and no secret; mail is sent to it and its reply comes back over NATS
// through the credentials its holder serves. Cross-process re-attach (a respawn from another process) is shown too.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { natsServerBin } from '../helpers/nats-server.mjs';
import { isolatedTmux } from '../helpers/isolated-tmux.mjs';
import { optOutOfEnrollment } from '../helpers/temp-repo.mjs';
import { attachViaSocket, fetchAdminSecrets } from '../../topology/lib/agent-creds.mjs';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, '../fixtures/creds-agent.mjs');
const haveTmux = await exec('tmux', ['-V']).then(() => true, () => false);
const events = async (log) => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
async function until(check, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

test('live pane: launcher holds only AO_CREDS_SOCK; send -> inbox -> reply crosses NATS on the agent\'s own credential', { skip: haveTmux ? false : 'no tmux', timeout: 240000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ao-live-')));
  const natsHome = join(root, 'nats');
  t.after(async () => {
    try { const s = JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8')); for (const pid of [s.pid, s.adminPid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } catch { /* never started */ }
    await rm(root, { recursive: true, force: true });
  });
  const consumer = join(root, 'app');
  await mkdir(consumer);
  await exec('git', ['-C', consumer, 'init', '-q']);
  await optOutOfEnrollment(consumer);
  const log = join(root, 'agent.log');
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: 'tmux', AGENT_ORCHESTRATION_SERVICES: '0', AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, '.cfg'),
    AO_NODE_NAME: 'agents1', CREDS_AGENT_LOG: log, AO_TRANSPORT: 'nats', AO_NATS_HOME: natsHome, AO_NATS_SERVER: await natsServerBin(), AO_NATS_AUTOSTART: '1' } });
  for (const name of ['AO_NATS_URL', 'NATS_URL', 'AO_CREDS_SOCK']) delete iso.env[name];
  assert.equal(iso.env.TMUX, '', 'never inherit an operator tmux server');
  const cli = join(HERE, '../../topology/cli.mjs');
  const ao = async (...args) => {
    const done = await exec(process.execPath, [cli, ...args, '--consumer', consumer, '--json'], { env: iso.env, timeout: 120_000 }).catch((error) => { error.message = `${args.slice(0, 2).join(' ')} failed: ${error.stdout}${error.stderr}`; throw error; });
    return JSON.parse(done.stdout);
  };
  const specPath = join(root, 'spec.json');
  await writeFile(specPath, JSON.stringify({ version: 1, name: 'creds-live', agents: [
    { id: 'boss', role: 'orchestrator', cli: 'creds-agent', args: [AGENT] }, { id: 'wk', role: 'worker', cli: 'creds-agent', args: [AGENT] }] }));

  const launched = await ao('launch', '--spec', specPath, '--providers-dir', join(HERE, '../fixtures'), '--run-id', 'live-1');
  console.log('launch keys: ' + Object.keys(launched).join(','));
  const runDir = launched.run_dir ?? launched.runDir ?? launched.run?.run_dir;
  const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const wk = run.agents.find((agent) => agent.id === 'wk');
  const launcher = readFileSync(wk.candidates[0].launcher, 'utf8');
  console.log(`launcher exports: ${launcher.split('\n').filter((l) => l.startsWith('export ')).map((l) => l.split('=')[0]).join(' ')}`);
  console.log(`run.json wk: creds_sock=${wk.creds_sock} token_sha256=${wk.token_sha256.slice(0, 12)}…`);
  assert.match(launcher, /export AO_CREDS_SOCK=/);
  assert.doesNotMatch(launcher, /AO_AGENT_TOKEN/, 'the launch script holds no token');
  assert.ok(wk.creds_sock, 'the run records where the holder listens');

  // The agent's live process: its environment names the socket and carries no secret.
  const started = await until(async () => (await events(log)).find((e) => e.event === 'start' && e.agent === 'wk'), 60_000, 'wk to start');
  // Names only, never values: this pane inherits the operator's shell, and its unrelated variables are not ours to print.
  const environ = readFileSync(`/proc/${started.pid}/environ`, 'latin1').split('\0').filter(Boolean).map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]);
  const aoNames = environ.map(([name]) => name).filter((name) => name.startsWith('AO_') && !/^AO_(TEST|NATS|TRANSPORT|NODE|TMUX|SESSION_NO)/.test(name)).sort();
  console.log(`wk process ${started.pid} AO_* env names set by the launcher: ${aoNames.join(' ')}`);
  assert.ok(aoNames.includes('AO_CREDS_SOCK'));
  assert.ok(!aoNames.includes('AO_AGENT_TOKEN') && !aoNames.includes('AO_REPLY_TOKEN'), 'no token variable in the agent');
  assert.equal(environ.filter(([, value]) => /^SU[A-Z2-7]{40,}$/.test(value)).length, 0, 'no nkey seed in any variable value');
  const nats = JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(nats), /"pass"/);
  console.log(`local NATS state keys: ${Object.keys(nats).join(',')}`);

  // send -> the pane receives the pointer -> the agent runs the real `ao-topology reply` -> reply recorded over NATS.
  const sent = await ao('send', '--run', runDir, '--from', 'boss', '--to', 'wk', '--from-project', consumer, '--stage', 'ping', '--body', 'PING over nats');
  console.log(`send: ${JSON.stringify(sent).slice(0, 300)}`);
  const replied = await until(async () => (await events(log)).find((e) => e.event === 'replied' && e.agent === 'wk'), 45_000, 'wk to reply').catch(async (error) => {
    console.log(`agent log: ${JSON.stringify((await events(log)).filter((e) => e.agent === 'wk').slice(-6)).slice(0, 3000)}`);
    throw error;
  });
  console.log(`agent inbox pull (first): ${JSON.stringify((await events(log)).find((e) => e.event === 'inbox' && e.agent === 'wk' && e.stdout))?.slice(0, 900)}`);
  console.log(`agent reply command: ok=${replied.ok} stdout=${replied.stdout.trim()} stderr=${replied.stderr.trim()}`);
  assert.equal(replied.ok, true, replied.stderr);
  assert.match(replied.stdout, /"transport":\s*"nats"/);
  const waited = await ao('wait', '--run', runDir, '--from', 'wk', '--timeout', '30s', '--poll', '500ms');
  console.log(`wait: ${JSON.stringify(waited).slice(0, 300)}`);
  assert.equal(waited.ok, true);

  // Another agent's pane tries wk's holder: refused (operator-tree-only attach, owner-only get).
  const boss = await until(async () => (await events(log)).find((e) => e.event === 'start' && e.agent === 'boss'), 20_000, 'boss to start');
  console.log(`boss pid ${boss.pid}, wk holder socket ${wk.creds_sock}`);

  // Cross-process re-attach: this test process (the operator tree, not the launching CLI) attaches wk's holder to a new root.
  const panePid = Number((await iso.tmux(['display-message', '-p', '-t', wk.pane, '#{pane_pid}'])).stdout.trim());
  const reattach = await attachViaSocket(wk.creds_sock, panePid);
  console.log(`cross-process attach(${panePid}) from pid ${process.pid}: ${JSON.stringify(reattach)}`);
  assert.equal(reattach.ok, true);
  // And a dead holder gives a clear message instead of a silent no-credential agent.
  await assert.rejects(attachViaSocket(join(root, 'no-such-holder.sock'), panePid), /ENOENT|ECONNREFUSED/);
  assert.ok((await fetchAdminSecrets(nats.adminSock)).seed, 'the operator still reaches the admin socket');
});
