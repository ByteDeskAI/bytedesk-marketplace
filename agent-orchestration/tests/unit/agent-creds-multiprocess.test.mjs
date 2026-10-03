// TM-310 round 3: the helper processes (admin holder, agent holders, server reload) are started by whichever
// process needs them first, and several processes share one AO_NATS_HOME. These tests use real child processes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { natsServerBin } from '../helpers/nats-server.mjs';
import { fetchAdminSecrets, holderAlive } from '../../topology/lib/agent-creds.mjs';

const exec = promisify(execFile);
const lib = (name) => JSON.stringify(new URL(`../../topology/lib/${name}`, import.meta.url).href);
for (const name of ['AO_NATS_URL', 'NATS_URL', 'AO_CREDS_SOCK']) delete process.env[name];

async function fixture(t, { deep = false } = {}) {
  const root = await mkdtemp(join(os.tmpdir(), 'ao-mp-'));
  // A sandbox lives under a long path; a socket path over 107 bytes is silently truncated by node.
  const home = deep ? join(root, 'a-deliberately-long-directory-name-'.repeat(3), 'nats-home') : root;
  if (deep) await mkdir(home, { recursive: true, mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: home, AO_NATS_HOME: home, AO_NATS_SERVER: await natsServerBin(), AO_NATS_AUTOSTART: '1', AGENT_ORCHESTRATION_SERVICES: '0' };
  const state = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'));
  t.after(async () => {
    try { const s = state(); for (const pid of [s.pid, s.adminPid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } catch { /* none */ }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  /** One real process: bring local NATS up (the path every `ao` command takes), connect as the host, report. */
  const proc = (extra = '') => exec(process.execPath, ['--input-type=module', '-e', `
    import { ensureLocalNats } from ${lib('nats-local.mjs')};
    import { openNatsTransport } from ${lib('orch-transport.mjs')};
    const local = await ensureLocalNats({ env: process.env });
    const t = await openNatsTransport({ env: process.env, name: 'mp' });
    await t.ensure({ repo: 'mp', agents: ['a'] });
    console.log('RESULT ' + JSON.stringify({ pid: process.pid, sock: local.adminSock, started: local.started, kind: t.kind }));
    await t.close(); process.exit(0);${extra}`], { env, timeout: 60_000 })
    .then(({ stdout, stderr }) => ({ ...JSON.parse(stdout.split('\n').find((l) => l.startsWith('RESULT ')).slice(7)), stderr }),
      (error) => { throw new Error(`process failed: ${String(error.stderr).split('\n').filter((l) => /Error|EADDR/.test(l)).slice(0, 3).join(' | ')}`); });
  return { home, env, state, proc };
}

test('sequential processes share one live admin holder', { timeout: 120000 }, async (t) => {
  const { state, proc } = await fixture(t);
  const first = await proc();
  const holderPid = state().adminPid;
  const second = await proc();
  console.log(`sequential: first=${JSON.stringify(first)} second=${JSON.stringify(second)} adminPid before=${holderPid} after=${state().adminPid}`);
  assert.equal(second.started, false);
  assert.equal(state().adminPid, holderPid, 'the second process reused the live holder');
});

test('state that lost the admin fields while a live holder owns admin.sock does not EADDRINUSE', { timeout: 120000 }, async (t) => {
  const { home, state, proc } = await fixture(t);
  await proc();
  const live = state();
  const { ensureAdminIdentity } = await import('../../topology/lib/nats-local.mjs');
  const result = await ensureAdminIdentity(home, {}); // a caller whose state.json no longer names the holder
  console.log(`ensureAdminIdentity with no admin in state: adminPid=${result.state.adminPid} (live holder ${live.adminPid}) changed=${result.changed} pub same=${result.state.adminPub === live.adminPub}`);
  assert.equal(result.state.adminPid, live.adminPid);
  assert.equal(result.state.adminPub, live.adminPub);
});

test('concurrent processes: one server, one admin holder, every process connects', { timeout: 180000 }, async (t) => {
  const { state, proc } = await fixture(t);
  const results = await Promise.all([proc(), proc(), proc(), proc()]);
  console.log(`concurrent: ${JSON.stringify(results.map((r) => ({ started: r.started, sock: r.sock })))} state adminPid=${state().adminPid}`);
  assert.equal(new Set(results.map((r) => r.sock)).size, 1);
  assert.equal(results.filter((r) => r.started).length, 1, 'exactly one process started the server');
  assert.ok(await holderAlive(state().adminSock));
});

test('stale admin socket (holder SIGKILLed, socket file left) is replaced and the server trusts the new key', { timeout: 180000 }, async (t) => {
  const { state, proc } = await fixture(t);
  await proc();
  const before = state();
  process.kill(before.adminPid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(existsSync(before.adminSock), 'precondition: the socket file is left behind');
  assert.equal(await holderAlive(before.adminSock), false, 'precondition: nobody answers');
  const after = await proc();
  const now = state();
  console.log(`stale: old adminPid=${before.adminPid} new adminPid=${now.adminPid} pub changed=${before.adminPub !== now.adminPub} recovered=${JSON.stringify(after)}`);
  assert.notEqual(now.adminPid, before.adminPid);
  assert.ok(await holderAlive(now.adminSock));
  assert.ok((await fetchAdminSecrets(now.adminSock)).seed);
});

test('re-provisioning an agent retires its previous holder', { timeout: 120000 }, async (t) => {
  const { home, proc } = await fixture(t);
  await proc();
  const { CredStore } = await import('../../topology/lib/agent-creds.mjs');
  const store = new CredStore({ home });
  const one = await store.provision({ repo: 'mp', agent: 'a', role: 'worker', extra: { token: 't1' } });
  const two = await store.provision({ repo: 'mp', agent: 'a', role: 'worker', extra: { token: 't2' } });
  await new Promise((r) => setTimeout(r, 500));
  console.log(`agent holders: first alive=${await holderAlive(one.holder.sock)} second alive=${await holderAlive(two.holder.sock)}`);
  assert.equal(await holderAlive(one.holder.sock), false, 'the superseded holder is gone');
  assert.equal(await holderAlive(two.holder.sock), true);
  await two.holder.revoke();
});

test('a home whose admin.sock path would exceed the socket limit still works and leaves no truncated socket behind', { timeout: 120000 }, async (t) => {
  const { home, state, proc } = await fixture(t, { deep: true });
  assert.ok(Buffer.byteLength(join(home, 'admin.sock')) > 107, 'precondition: the naive path is too long');
  const first = await proc();
  const second = await proc();
  const s = state();
  console.log(`long home (${Buffer.byteLength(join(home, 'admin.sock'))} bytes naive): adminSock=${s.adminSock} (${Buffer.byteLength(s.adminSock)} bytes) first.started=${first.started} second.started=${second.started}`);
  assert.ok(Buffer.byteLength(s.adminSock) <= 107);
  assert.equal(second.started, false);
  const strays = (await readdir(join(home, '..', '..'), { withFileTypes: true })).filter((e) => e.isSocket());
  assert.deepEqual(strays.map((e) => e.name), [], 'no truncated socket file in a parent directory');
  assert.ok(await holderAlive(s.adminSock));
  await rm(s.adminSock, { force: true });
});

test('upgrade: a state written by the password version is migrated, with a printed note', { timeout: 180000 }, async (t) => {
  const { home, state, proc } = await fixture(t);
  await proc();
  const modern = state();
  // Recreate what the previous version left behind: password in state.json and in the config, no admin identity.
  process.kill(modern.adminPid, 'SIGKILL');
  const { serverConfig } = await import('../../topology/lib/nats-local.mjs');
  await writeFile(join(home, 'nats-server.conf'), serverConfig({ port: modern.port, user: 'ao-orch', password: 'legacy-password', storeDir: join(home, 'jetstream') }), { mode: 0o600 });
  process.kill(modern.pid, 'SIGHUP');
  await writeFile(join(home, 'state.json'), JSON.stringify({ pid: modern.pid, port: modern.port, bin: modern.bin, user: 'ao-orch', pass: 'legacy-password' }), { mode: 0o600 });
  await new Promise((r) => setTimeout(r, 400));
  const after = await proc();
  const s = state();
  console.log(`upgrade: state keys now ${Object.keys(s).join(',')}; note printed: ${JSON.stringify(after.stderr.trim())}`);
  assert.ok(!('pass' in s) && !('user' in s), 'the password is gone from state.json');
  assert.ok(s.adminPub && await holderAlive(s.adminSock));
  assert.match(after.stderr, /replaced the stored admin password/);
});

test('state.json is stamped schema 2; a newer schema is refused; an old version rewriting it is detected loudly', { timeout: 180000 }, async (t) => {
  const { home, state, proc } = await fixture(t);
  await proc();
  const modern = state();
  assert.equal(modern.schema, 2, 'the new version stamps what it writes');
  // An older ao-topology rewrote the file in the password format while the nkey holder is still alive.
  const { serverConfig } = await import('../../topology/lib/nats-local.mjs');
  await writeFile(join(home, 'nats-server.conf'), serverConfig({ port: modern.port, user: 'ao-orch', password: 'old-version-password', storeDir: join(home, 'jetstream') }), { mode: 0o600 });
  process.kill(modern.pid, 'SIGHUP');
  await writeFile(join(home, 'state.json'), JSON.stringify({ pid: modern.pid, port: modern.port, bin: modern.bin, user: 'ao-orch', pass: 'old-version-password' }), { mode: 0o600 });
  await new Promise((r) => setTimeout(r, 400));
  const repaired = await proc();
  console.log(`old-format rewrite found: ${JSON.stringify(repaired.stderr.trim().slice(0, 260))}; schema now ${state().schema}`);
  assert.match(repaired.stderr, /WARNING.*old password format.*older agent-orchestration/);
  assert.equal(state().schema, 2);
  assert.ok(!('pass' in state()));
  // A state from the future is refused, not rewritten.
  await writeFile(join(home, 'state.json'), JSON.stringify({ ...state(), schema: 3 }), { mode: 0o600 });
  const before = readFileSync(join(home, 'state.json'), 'utf8');
  await assert.rejects(proc(), /schema 3.*Upgrade this installation/);
  assert.equal(readFileSync(join(home, 'state.json'), 'utf8'), before, 'a newer state file is left untouched');
});
