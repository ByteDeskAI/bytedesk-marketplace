import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureLocalNats, findNatsServer, serverConfig } from '../../topology/lib/nats-local.mjs';
import { fetchAdminSecrets } from '../../topology/lib/agent-creds.mjs';

test('serverConfig exposes no system account and no anonymous user', () => {
  const conf = serverConfig({ port: 1, user: 'u', password: 'p', storeDir: '/x' });
  assert.match(conf, /listen: 127\.0\.0\.1:1/);
  assert.doesNotMatch(conf, /system_account|no_auth_user|\$SYS/);
});

test('ensureLocalNats starts once, reuses, and refuses bad credentials', async (t) => {
  const bin = await findNatsServer();
  if (!bin) return t.skip('no working nats-server on this machine');
  const home = await mkdtemp(join(os.tmpdir(), 'ao-nats-local-'));
  // TM-308: nats.port is written to the user config, so it must be a temp one.
  const env = { ...process.env, AO_NATS_HOME: home, HOME: home, XDG_CONFIG_HOME: join(home, 'config') };
  let pid;
  t.after(async () => {
    if (pid) try { process.kill(pid); } catch { /* already gone */ }
    try { process.kill(JSON.parse(await readFile(join(home, 'state.json'), 'utf8')).adminPid); } catch { /* none */ }
    await rm(home, { recursive: true, force: true });
  });
  const first = await ensureLocalNats({ env });
  pid = JSON.parse(await readFile(join(home, 'state.json'), 'utf8')).pid;
  assert.equal(first.started, true);
  const second = await ensureLocalNats({ env });
  assert.equal(second.started, false);
  assert.equal(second.port, first.port);
  assert.equal((await stat(join(home, 'state.json'))).mode & 0o077, 0, 'state file is owner-only');
  const { connect, nkeyAuthenticator } = await import('nats');
  // TM-310: no password is stored; the host identity is an nkey the admin holder hands to a non-agent process.
  const stateText = await readFile(join(home, 'state.json'), 'utf8');
  assert.doesNotMatch(stateText, /"pass"|"user"/, 'no password is persisted');
  const { seed } = await fetchAdminSecrets(first.adminSock);
  assert.doesNotMatch(stateText + await readFile(join(home, 'nats-server.conf'), 'utf8'), new RegExp(seed), 'the seed is on no disk');
  const good = await connect({ servers: first.servers, authenticator: nkeyAuthenticator(new TextEncoder().encode(seed)) });
  await good.close();
  await assert.rejects(connect({ servers: first.servers, reconnect: false, timeout: 2000 }), /authorization violation/i);
  await assert.rejects(connect({ servers: first.servers, user: 'ao-orch', pass: 'bad', reconnect: false, timeout: 2000 }), /authorization violation/i);
});

test('a managed process never starts a detached server beside the managed one (TM-277)', async (t) => {
  const home = await mkdtemp(join(os.tmpdir(), 'ao-nats-managed-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  // Port 1 never answers, so this is the window in which the service manager is restarting it.
  const state = JSON.stringify({ managed: true, pid: null, port: 1, user: 'ao-orch', pass: 'p' });
  await writeFile(join(home, 'state.json'), state, { mode: 0o600 });
  const env = { ...process.env, AO_NATS_HOME: home, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), AGENT_ORCHESTRATION_SERVICES: '1', AGENT_ORCHESTRATION_SERVICES_MANAGED: '1' };
  await assert.rejects(ensureLocalNats({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  assert.equal(await readFile(join(home, 'state.json'), 'utf8'), state, 'state.json still names the managed port');
});
