// TM-317: platform layer for the credential holder's caller check. The darwin fixtures are SYNTHESIZED
// (see their headers): nothing here was run on a Mac. What is proven is the parser, the fail-closed paths,
// and the plumbing (exec -> parse -> pids) against a fake `lsof`/`ps` on PATH and a real unix socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { darwinPeerPids, isAlive, parentOf, parseLsofFields, parsePsList, parsePsPpid, parseSsPeerInode, peerPids } from '../../topology/lib/peer-process.mjs';

const fixture = (name) => readFileSync(new URL(`../fixtures/peer-process/${name}`, import.meta.url), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');

test('linux: ss parser pairs our inode with the peer inode', () => {
  const text = fixture('ss-xnH.synthesized.txt');
  assert.equal(parseSsPeerInode(text, '51234'), '51235');
  assert.equal(parseSsPeerInode(text, '99999'), null);
  assert.equal(parseSsPeerInode('', '51234'), null);
});

test('darwin: lsof parser reads one row per descriptor', () => {
  const rows = parseLsofFields(fixture('lsof-U-F.synthesized.txt'));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[1], { pid: 501, fd: '4', type: 'unix', device: '0xaaaa000000000002', name: '->0xbbbb000000000009' });
});

test('darwin: the peer is the other process holding the paired pcb, and nothing else', () => {
  const rows = parseLsofFields(fixture('lsof-U-F.synthesized.txt'));
  assert.deepEqual(darwinPeerPids(rows, 501, 4), [612]);
  // Fail closed: our row absent, wrong fd, the listener row (no peer), garbage.
  assert.deepEqual(darwinPeerPids(rows, 501, 99), []);
  assert.deepEqual(darwinPeerPids(rows, 501, 3), []);
  assert.deepEqual(darwinPeerPids(rows, 9999, 4), []);
  assert.deepEqual(darwinPeerPids(parseLsofFields('garbage\n\n???'), 501, 4), []);
  assert.deepEqual(darwinPeerPids(parseLsofFields(''), 501, 4), []);
  assert.deepEqual(parseLsofFields(undefined), []);
});

test('ps parsers: ppid and process list; junk yields 0 / []', () => {
  assert.equal(parsePsPpid('  4242\n'), 4242);
  assert.equal(parsePsPpid(''), 0);
  assert.equal(parsePsPpid('ps: no such process'), 0);
  assert.deepEqual(parsePsList(' 10 /usr/bin/nats-server -c /x/nats.conf\nnot a row\n'), [{ pid: 10, argv: ['/usr/bin/nats-server', '-c', '/x/nats.conf'] }]);
});

test('platform dispatch: unknown platform and throwing exec both fail closed', () => {
  const socket = { _handle: { fd: 4 } };
  assert.deepEqual(peerPids(socket, '/x', { platform: 'win32' }), []);
  assert.deepEqual(peerPids(socket, '/x', { platform: 'darwin', exec: () => { throw new Error('lsof missing'); } }), []);
  assert.deepEqual(peerPids({}, '/x', { platform: 'darwin', exec: () => '' }), []);
  assert.equal(parentOf(1, { platform: 'darwin', exec: () => 'junk' }), 0);
  assert.equal(parentOf(1, { platform: 'win32' }), 0);
});

test('isAlive: kill(pid,0) semantics off Linux (EPERM means alive)', () => {
  const kill = (code) => () => { if (code) throw Object.assign(new Error(code), { code }); };
  assert.equal(isAlive(5, { platform: 'darwin', kill: kill() }), true);
  assert.equal(isAlive(5, { platform: 'darwin', kill: kill('EPERM') }), true);
  assert.equal(isAlive(5, { platform: 'darwin', kill: kill('ESRCH') }), false);
  assert.equal(isAlive(0, { platform: 'darwin', kill: kill() }), false);
  assert.equal(isAlive(process.pid, { platform: 'linux' }), true);
});

test('darwin code path on Linux: fake lsof/ps on PATH + a real unix socket name the real client pid', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-pp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sock = join(dir, 's.sock');
  const lsofOut = join(dir, 'lsof.out');
  // The shims print what the test writes; the test builds it from the REAL pids and descriptor.
  writeFileSync(join(dir, 'lsof'), `#!/bin/sh\ncat "${lsofOut}"\n`); chmodSync(join(dir, 'lsof'), 0o755);
  writeFileSync(join(dir, 'ps'), '#!/bin/sh\necho 4242\n'); chmodSync(join(dir, 'ps'), 0o755);
  const origPath = process.env.PATH;
  process.env.PATH = `${dir}:${origPath}`;
  t.after(() => { process.env.PATH = origPath; });

  const client = spawn(process.execPath, ['-e', `const s=require('net').connect(${JSON.stringify(sock)});setTimeout(()=>process.exit(0),20000)`], { stdio: 'ignore' });
  t.after(() => client.kill('SIGKILL'));
  const server = net.createServer();
  t.after(() => server.close());
  const accepted = new Promise((resolve) => server.once('connection', resolve));
  await new Promise((resolve) => server.listen(sock, resolve));
  const socket = await accepted;
  const fd = socket._handle.fd;
  const rows = (text) => writeFileSync(lsofOut, text);

  rows(`p${process.pid}\nf${fd}\ntunix\nd0xa1\nn->0xb1\np${client.pid}\nf9\ntunix\nd0xb1\nn->0xa1\np1\nf2\ntunix\nd0xc1\nn->0xd1\n`);
  assert.deepEqual(peerPids(socket, sock, { platform: 'darwin' }), [client.pid]);
  assert.equal(parentOf(client.pid, { platform: 'darwin' }), 4242);

  // Absent peer / empty / garbage output: never a guess.
  rows(`p${process.pid}\nf${fd}\ntunix\nd0xa1\nn->0xb1\n`);
  assert.deepEqual(peerPids(socket, sock, { platform: 'darwin' }), []);
  rows('');
  assert.deepEqual(peerPids(socket, sock, { platform: 'darwin' }), []);
  rows('lsof: WARNING: something\n');
  assert.deepEqual(peerPids(socket, sock, { platform: 'darwin' }), []);

  // Linux real path still names the same client.
  assert.deepEqual(peerPids(socket, sock, { platform: 'linux' }), [client.pid]);
});
