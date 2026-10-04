// TM-316: what an agent pane inherits and what the secret-bearing paths look like on disk. Modes keep OTHER users out; they do
// not stop a same-uid process (docs/adr/0003). This test proves the modes and that no secret or secret path is in an agent
// process's environ or cmdline; it does not claim isolation from a same-uid reader.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { REPO, startServer } from '../helpers/agent-creds-fixture.mjs';
import { isDescendant } from '../../topology/lib/agent-creds.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = (path) => (statSync(path).mode & 0o777).toString(8).padStart(3, '0');

/** Every process under `root` (itself included): { pid, environ, cmdline } as text. */
function treeProcesses(root) {
  const found = [];
  for (const name of readdirSync('/proc').filter((n) => /^[0-9]+$/.test(n))) {
    const pid = Number(name);
    if (pid !== root && !isDescendant(pid, root)) continue;
    try { found.push({ pid, environ: readFileSync(`/proc/${pid}/environ`, 'latin1'), cmdline: readFileSync(`/proc/${pid}/cmdline`, 'latin1').replaceAll('\0', ' ') }); } catch { /* exited */ }
  }
  return found;
}
const scan = (processes, needles) => processes.flatMap((p) => needles.filter((n) => p.environ.includes(n) || p.cmdline.includes(n)).map((n) => `${p.pid}:${n.slice(0, 24)}`));

test('secret-bearing paths are 0700/0600 and no agent process carries a secret or a secret path', { timeout: 120000 }, async () => {
  const server = await startServer();
  const { holder, issued } = await server.store.provision({ repo: REPO, agent: 'agentB', role: 'worker', mailTo: ['boss'], extra: { token: 'tok-pane-B' } });
  const agentHome = mkdtempSync(join(tmpdir(), 'ao-pane-home-'));
  // The pane env as launch.mjs builds it: the agent's own holder socket and nothing else from AO_*.
  const pane = spawn('sh', ['-c', 'sleep 30 & wait'], { env: { PATH: process.env.PATH, HOME: agentHome, AO_CREDS_SOCK: holder.sock }, stdio: 'ignore' });
  try {
    await holder.attach(pane.pid);
    await sleep(600);
    const { seed: adminSeed } = await (await import('../../topology/lib/agent-creds.mjs')).fetchAdminSecrets(server.state.adminSock);
    const modes = {
      natsHome: mode(server.home), conf: mode(server.conf), state: mode(join(server.home, 'state.json')), registry: mode(join(server.home, 'agent-users.json')),
      roots: mode(join(server.home, 'roots.json')), adminSock: mode(server.state.adminSock), agentSock: mode(holder.sock),
      agentSockDir: mode(join(holder.sock, '..')),
    };
    console.log(`modes: ${JSON.stringify(modes)}`);
    assert.deepEqual(modes, { natsHome: '700', conf: '600', state: '600', registry: '600', roots: '600', adminSock: '600', agentSock: '600', agentSockDir: '700' });

    const processes = treeProcesses(pane.pid);
    console.log(`pane tree: ${processes.map((p) => `${p.pid} ${p.cmdline.slice(0, 40)}`).join(' | ')}`);
    assert.ok(processes.length >= 2, 'the scan must cover the pane shell and its child, or it cannot find anything');
    const needles = [adminSeed, issued.seed, 'tok-pane-B', server.home, server.conf, join(server.home, 'agent-users.json'), server.state.adminSock, join(server.home, 'state.json')];
    const leaks = scan(processes, needles);
    const aoVars = processes[0].environ.split('\0').filter((v) => v.startsWith('AO_')).map((v) => v.split('=')[0]);
    console.log(`leaks in pane tree environ+cmdline: ${JSON.stringify(leaks)}; AO_* vars in pane env: ${JSON.stringify(aoVars)}`);
    assert.deepEqual(leaks, []);
    assert.deepEqual(aoVars, ['AO_CREDS_SOCK'], 'the pane carries its own holder socket path and nothing else');
    // Control: plant a secret in a process's environment and the scan must find it.
    const planted = spawn('sleep', ['5'], { env: { PATH: process.env.PATH, PLANTED: adminSeed }, stdio: 'ignore' });
    await sleep(100);
    assert.equal(scan(treeProcesses(planted.pid), [adminSeed]).length, 1, 'control: the scan must flag a planted seed');
    planted.kill();
  } finally { pane.kill(); await holder.revoke().catch(() => {}); await server.stop(); }
});
