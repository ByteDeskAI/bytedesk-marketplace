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

test('a process manager and CLI processes sharing one home never replace the server or move its port', { timeout: 120000 }, async (t) => {
  const { home, env, state } = await fixture(t);
  const windowMs = 25_000;
  const header = `import { ensureLocalNats, prepareLocalNats } from ${lib('nats-local.mjs')};
    import { spawn } from 'node:child_process'; import net from 'node:net';
    const until = Date.now() + ${windowMs};
    const up = (port) => new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
    const seen = new Set(); const starts = [];`;
  // The service manager: re-runs `services ensure` (prepareLocalNats) on a tick and keeps its server running, as process-compose does.
  const manager = `${header}
    let child = null;
    while (Date.now() < until) {
      const p = await prepareLocalNats({ env: process.env });
      seen.add(p.port);
      if (!(await up(p.port))) { child = spawn(p.bin, p.args, { detached: true, stdio: 'ignore' }); child.unref(); starts.push(child.pid); await new Promise((r) => setTimeout(r, 800)); }
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log('RESULT ' + JSON.stringify({ ports: [...seen], starts })); process.exit(0);`;
  // CLI commands: every one asks for the local NATS (services disabled in this test process, as in the suite).
  const cli = `${header}
    while (Date.now() < until) {
      try { const l = await ensureLocalNats({ env: process.env }); seen.add(l.port); if (l.started) starts.push(l.port); } catch (e) { /* the manager may be restarting it */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log('RESULT ' + JSON.stringify({ ports: [...seen], starts })); process.exit(0);`;
  const run = (source) => exec(process.execPath, ['--input-type=module', '-e', source], { env, timeout: 90_000 }).then(({ stdout }) => JSON.parse(stdout.split('\n').find((l) => l.startsWith('RESULT ')).slice(7)));
  const livePids = async () => (await exec('ps', ['-eo', 'pid,args', '-ww'])).stdout.split('\n').filter((l) => l.includes('nats-server') && l.includes(home)).map((l) => Number(l.trim().split(/\s+/)[0]));
  // A first start may be a handover (a CLI's detached server taken over by the manager once). After the first ten seconds nothing may change.
  const settled = new Promise((resolve) => setTimeout(async () => resolve(await livePids()), 10_000));
  const [m, a, b] = await Promise.all([run(manager), run(cli), run(cli)]);
  const pidsAt10s = await settled;
  const ports = [...new Set([...m.ports, ...a.ports, ...b.ports])];
  const servers = (await exec('ps', ['-eo', 'pid,args', '-ww'])).stdout.split('\n').filter((l) => l.includes('nats-server') && l.includes(home));
  console.log(`window ${windowMs}ms: ports seen=${JSON.stringify(ports)} manager starts=${JSON.stringify(m.starts)} cli detached starts=${JSON.stringify([...a.starts, ...b.starts])} live servers for this home=${servers.length}`);
  assert.equal(ports.length, 1, `the port moved: ${ports}`);
  console.log(`server pid at 10s=${JSON.stringify(pidsAt10s)} at the end=${JSON.stringify(await livePids())}`);
  assert.equal(m.starts.length + a.starts.length + b.starts.length <= 2, true, `more than one handover: manager ${m.starts}, cli ${a.starts} ${b.starts}`);
  assert.deepEqual(await livePids(), pidsAt10s, 'the server was replaced after it had settled');
  assert.equal(servers.length, 1);
  for (const pid of [state().pid, ...servers.map((l) => Number(l.trim().split(/\s+/)[0]))]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
});

test('the services path (a BUNDLED nats-local, as dist/cli.cjs runs it) and topology source share one home: one server, schema 2', { timeout: 180000 }, async (t) => {
  const { home, env, state } = await fixture(t);
  const esbuild = await import('esbuild');
  const { build } = esbuild;
  const out = await mkdtemp(join(os.tmpdir(), 'ao-bundle-'));
  t.after(() => rm(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const topologyLib = new URL('../../topology/lib/', import.meta.url).pathname;
  await writeFile(join(out, 'writer.mjs'), `import { prepareLocalNats, ensureLocalNats } from ${JSON.stringify(topologyLib + 'nats-local.mjs')};
    import { spawn } from 'node:child_process'; import net from 'node:net';
    const until = Date.now() + 30000;
    const up = (port) => new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
    (async () => {
    while (Date.now() < until) {
      const p = await prepareLocalNats({ env: process.env });          // what \`services ensure\` calls
      if (!(await up(p.port))) { spawn(p.bin, p.args, { detached: true, stdio: 'ignore' }).unref(); await new Promise((r) => setTimeout(r, 800)); }
      await new Promise((r) => setTimeout(r, 1500));
    }
    process.exit(0);
    })();`);
  const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'error', preserveSymlinks: true, absWorkingDir: new URL('../../', import.meta.url).pathname,
    define: { 'import.meta.url': '__aoImportMetaUrl' }, banner: { js: "const __aoImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" } };
  // Same shape as scripts/build.mjs: the application bundle and the holder's own entry beside it.
  await build({ ...common, entryPoints: [join(out, 'writer.mjs')], outfile: join(out, 'writer.cjs') });
  await build({ ...common, entryPoints: [join(topologyLib, 'credential-holder.mjs')], outfile: join(out, 'credential-holder.cjs') });
  await esbuild.stop(); // its service process would otherwise outlive the test
  const bundleRun = exec(process.execPath, [join(out, 'writer.cjs')], { env, timeout: 90_000 });
  const topologyRun = exec(process.execPath, ['--input-type=module', '-e', `
    import { ensureLocalNats } from ${lib('nats-local.mjs')};
    const until = Date.now() + 30000; const ports = new Set();
    while (Date.now() < until) { try { ports.add((await ensureLocalNats({ env: process.env })).port); } catch { /* manager mid-start */ } await new Promise((r) => setTimeout(r, 500)); }
    console.log('RESULT ' + JSON.stringify([...ports])); process.exit(0);`], { env, timeout: 90_000 });
  const livePids = async () => (await exec('ps', ['-eo', 'pid,args', '-ww'])).stdout.split('\n').filter((l) => l.includes('nats-server') && l.includes(home)).map((l) => Number(l.trim().split(/\s+/)[0]));
  const settled = new Promise((resolve) => setTimeout(async () => resolve(await livePids()), 8_000));
  const [, topo] = await Promise.all([bundleRun, topologyRun]);
  const pidsAt8s = await settled;
  const ports = JSON.parse(topo.stdout.split('\n').find((l) => l.startsWith('RESULT ')).slice(7));
  const finalState = state();
  const holders = (await exec('ps', ['-eo', 'args', '-ww'])).stdout.split('\n').filter((l) => /credential-holder\.(cjs|mjs)/.test(l) && !l.includes('grep'));
  console.log(`bundled writer + topology: ports=${JSON.stringify(ports)} server pids at 8s=${JSON.stringify(pidsAt8s)} end=${JSON.stringify(await livePids())} state.schema=${finalState.schema} keys=${Object.keys(finalState).join(',')} holder cmdlines=${holders.map((l) => l.split('/').slice(-1)[0]).join(',')}`);
  assert.equal(ports.length, 1, 'the port moved');
  assert.equal(pidsAt8s.length, 1);
  assert.deepEqual(await livePids(), pidsAt8s, 'the server was replaced after it settled');
  assert.equal(finalState.schema, 2);
  assert.ok(!('pass' in finalState) && finalState.adminPub);
  for (const pid of [...pidsAt8s, finalState.adminPid]) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
});
