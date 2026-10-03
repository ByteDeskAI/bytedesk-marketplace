// TM-310 round 5: a CLI verb that provisions a credential holder must exit when it is done; the holder outlives it.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { natsServerBin } from '../helpers/nats-server.mjs';
import { isolatedTmux } from '../helpers/isolated-tmux.mjs';
import { optOutOfEnrollment } from '../helpers/temp-repo.mjs';
import { holderAlive } from '../../topology/lib/agent-creds.mjs';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const haveTmux = await exec('tmux', ['-V']).then(() => true, () => false);

for (const mode of ['file', 'nats']) test(`\`launch\` (${mode} transport) exits promptly after printing its result while its credential holders keep serving`, { skip: haveTmux ? false : 'no tmux', timeout: 120000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ao-exit-')));
  t.after(async () => {
    try { const st = JSON.parse(readFileSync(join(root, 'nats', 'state.json'), 'utf8')); for (const pid of [st.pid, st.adminPid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } catch { /* none */ }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const consumer = join(root, 'app');
  await mkdir(consumer);
  await exec('git', ['-C', consumer, 'init', '-q']);
  await optOutOfEnrollment(consumer);
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: 'tmux', AO_TRANSPORT: mode, AGENT_ORCHESTRATION_SERVICES: '0', ...(mode === 'nats' ? { AO_NATS_HOME: join(root, 'nats'), AO_NATS_SERVER: await natsServerBin(), AO_NATS_AUTOSTART: '1' } : {}), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'),
    XDG_CONFIG_HOME: join(root, '.cfg'), AO_NODE_NAME: 'agents1' } });
  const spec = join(root, 'spec.json');
  await writeFile(spec, JSON.stringify({ version: 1, name: 'exit-check', agents: [
    { id: 'a', role: 'orchestrator', cli: 'fake-agent', args: [join(HERE, '../fixtures/fake-agent.mjs')] }, { id: 'b', role: 'worker', cli: 'fake-agent', args: [join(HERE, '../fixtures/fake-agent.mjs')] }] }));
  const started = Date.now();
  const child = spawn(process.execPath, [join(HERE, '../../topology/cli.mjs'), 'launch', '--spec', spec, '--providers-dir', join(HERE, '../fixtures'), '--run-id', 'exit-1', '--consumer', consumer, '--json'],
    { env: iso.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let printedAt = null;
  child.stdout.on('data', (c) => { stdout += c; if (printedAt === null && /"state"/.test(stdout)) printedAt = Date.now() - started; });
  const exited = await Promise.race([new Promise((resolve) => child.on('exit', () => resolve(Date.now() - started))), new Promise((resolve) => setTimeout(() => resolve('HUNG'), 45_000))]);
  const run = JSON.parse(stdout);
  console.log(`launch (${mode}): result printed at ${printedAt}ms, process exited at ${exited === 'HUNG' ? 'HUNG (>45s)' : `${exited}ms`}`);
  const socks = JSON.parse(readFileSync(join(run.runDir, 'run.json'), 'utf8')).agents.map((agent) => agent.creds_sock).filter(Boolean);
  console.log(`holder sockets alive after launch exit: ${(await Promise.all(socks.map(holderAlive))).join(',')} of ${socks.length}`);
  if (exited === 'HUNG') child.kill('SIGKILL');
  assert.notEqual(exited, 'HUNG', 'launch never exited: its holder children keep its event loop alive');
  assert.ok(exited - printedAt < 8000, `exit followed the result by ${exited - printedAt}ms`);
  assert.equal(socks.length, 2);
  assert.ok((await Promise.all(socks.map(holderAlive))).every(Boolean), 'the holders must survive the launcher');
});
