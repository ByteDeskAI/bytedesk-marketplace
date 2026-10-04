// TM-332: a same-uid process that double-forks out of an agent pane used to be judged "the operator" (not a descendant of any
// pane root) and could ask the admin holder for the host seed. Real processes, a real admin holder, no mocks of the kernel.
// Each variant escapes differently; each marker has a mutation (`lineageOff`, passed to startHolder) that makes its escape succeed.
// NOT STOPPED (asserted, so a future change shows): scrub the environment + new session + the node binary (variant C).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startHolder } from '../../topology/lib/agent-creds.mjs';

const NODE = process.execPath;
const PY = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim();
const home = mkdtempSync(join(tmpdir(), 'aot-esc-'));
const lib = JSON.stringify(new URL('../../topology/lib/agent-creds.mjs', import.meta.url).href);
const probe = join(home, 'probe.mjs');
writeFileSync(probe, `import { attachViaSocket, fetchAdminSecrets } from ${lib};
import { writeFileSync } from 'node:fs';
const [sock, out, op, pid] = process.argv.slice(2);
await new Promise((r) => setTimeout(r, 800)); // let the intermediate process of a double fork exit and be reparented
try {
  if (op === 'attach') { await attachViaSocket(sock, Number(pid)); writeFileSync(out, 'OK attach'); }
  else writeFileSync(out, 'GOT ' + Object.keys(await fetchAdminSecrets(sock)).join(','));
} catch (e) { writeFileSync(out, 'REFUSED ' + e.message); }
`);
const pyProbe = join(home, 'probe.py');
writeFileSync(pyProbe, `import socket,sys,time
time.sleep(0.8)
s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.sendall(b'{"op":"get"}')
d=b''
while True:
    c=s.recv(4096)
    if not c: break
    d+=c
open(sys.argv[2],'w').write('GOT' if b'seed' in d else 'REFUSED '+d.decode())
`);

const DESCENDANT_ONLY = ['env', 'session', 'pgrp', 'exe']; // markers off = the pre-TM-332 behaviour
let n = 0;
const live = { holders: [], pids: [] };
const answer = async (file) => { for (let i = 0; i < 150; i += 1) { if (existsSync(file)) { const t = readFileSync(file, 'utf8'); if (t) return t; } await new Promise((r) => setTimeout(r, 100)); } return 'NO ANSWER'; };
const admin = async (lineageOff = []) => { const h = await startHolder({}, { home, admin: true, sock: join(home, `admin-${n += 1}.sock`), lineageOff }); live.holders.push(h); return h; };

const VARIANTS = {
  A: { why: 'naive double fork, environment kept, same session', cmd: (o, s) => `(${NODE} ${probe} ${s} ${o} get &)` },
  B: { why: 'environment scrubbed, same session, own process group (set -m)', cmd: (o, s) => `(set -m; env -i ${NODE} ${probe} ${s} ${o} get &)` },
  C: { why: 'environment scrubbed + setsid + node binary (NOT STOPPED)', cmd: (o, s) => `setsid -f env -i ${NODE} ${probe} ${s} ${o} get` },
  D: { why: 'setsid, environment kept', cmd: (o, s) => `setsid -f ${NODE} ${probe} ${s} ${o} get` },
  E: { why: 'environment scrubbed + setsid, but not the node binary (python3)', cmd: (o, s) => `setsid -f env -i ${PY} ${pyProbe} ${s} ${o}` },
  F: { why: 'environment scrubbed, same process group, root is NOT a session leader', pgrpRoot: true, cmd: (o, s) => `(env -i ${NODE} ${probe} ${s} ${o} get &)` },
};

/** A pane-like root (own session, or own process group only) registered with an agent holder; runs the variant; returns the admin socket's answer. */
async function escape(adminHolder, key) {
  const v = VARIANTS[key];
  const out = join(home, `out-${n += 1}`);
  const agent = await startHolder({ token: 't' }, { home, sock: join(home, `agent-${n}.sock`) });
  live.holders.push(agent);
  const env = { PATH: process.env.PATH, AO_AGENT_ID: 'agentX', AO_CREDS_SOCK: agent.sock };
  const script = 'IFS= read -r c; eval "$c"; sleep 30';
  const root = v.pgrpRoot
    ? spawn(PY, ['-c', `import os;os.setpgid(0,0);os.execvp("sh",["sh","-c",${JSON.stringify(script)}])`], { env, stdio: ['pipe', 'ignore', 'ignore'] })
    : spawn('sh', ['-c', script], { env, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  live.pids.push(root.pid);
  await agent.attach(root.pid);
  await new Promise((r) => setTimeout(r, 300)); // roots.json is written asynchronously
  root.stdin.write(`${v.cmd(out, adminHolder.sock)}\n`);
  const text = await answer(out);
  console.log(`  [${key}] ${v.why} -> ${text.slice(0, 110)}`);
  return text;
}

test.after(() => {
  for (const pid of live.pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return Promise.allSettled(live.holders.map((h) => h.revoke())).then(() => rmSync(home, { recursive: true, force: true }));
});

test('before: with only the descendant check every double-fork variant is treated as the operator', { timeout: 180000 }, async () => {
  const before = await admin(DESCENDANT_ONLY);
  console.log('BEFORE (descendant check only):');
  for (const key of ['A', 'B', 'D', 'F', 'E']) assert.match(await escape(before, key), /^GOT/, `variant ${key} should have received the seed before the change`);
});

test('after: the naive and the lazy escapes are refused with a printed message', { timeout: 180000 }, async () => {
  const after = await admin();
  console.log('AFTER (all markers):');
  for (const key of ['A', 'B', 'D', 'F']) assert.match(await escape(after, key), /^REFUSED credential holder refused: not an operator process/, `variant ${key} must be refused`);
  assert.match(await escape(after, 'E'), /^REFUSED/, 'E: a non-node executable is refused by the positive operator signal');
});

test('NOT STOPPED: scrubbed environment + new session + the node binary still gets the seed (asserted so a change shows)', { timeout: 120000 }, async () => {
  const after = await admin();
  assert.match(await escape(after, 'C'), /^GOT seed/, 'variant C is the documented residual (ADR-0003, TM-332 mitigation)');
});

test('mutation: disabling one marker lets exactly its escape through', { timeout: 300000 }, async () => {
  const cases = [['env', 'D'], ['session', 'B'], ['pgrp', 'F'], ['exe', 'E']];
  for (const [marker, key] of cases) {
    const mutated = await admin([marker]);
    const text = await escape(mutated, key);
    console.log(`MUTATED (${marker} off) variant ${key} -> ${text.slice(0, 40)}`);
    assert.match(text, /^GOT/, `with the ${marker} marker off, variant ${key} must succeed, so the refusal depends on it`);
  }
});

test('the operator still works: this process, a separate shell, and a non-agent tmux pane', { timeout: 180000 }, async () => {
  const adminHolder = await admin();
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME };
  const fromShell = join(home, 'out-shell');
  spawn('sh', ['-c', `${NODE} ${probe} ${adminHolder.sock} ${fromShell} get`], { detached: true, env: clean, stdio: 'ignore' });
  const shell = await answer(fromShell);
  // An agent holder and a root registered, then the operator re-attaches it from inside a human tmux pane (no AO_* in its env).
  const agent = await startHolder({ token: 't' }, { home, sock: join(home, `agent-${n += 1}.sock`) });
  live.holders.push(agent);
  const idle = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  live.pids.push(idle.pid);
  await agent.attach(idle.pid);
  await new Promise((r) => setTimeout(r, 300));
  const socket = `aot-esc-${process.pid}`;
  const tmuxEnv = { ...clean, TMUX: '', TMUX_TMPDIR: mkdtempSync(join(tmpdir(), 'aot-esc-tmux-')) };
  const inPane = join(home, 'out-pane');
  const attachPane = join(home, 'out-pane-attach');
  try {
    execFileSync('tmux', ['-L', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'human', `${NODE} ${probe} ${adminHolder.sock} ${inPane} get; ${NODE} ${probe} ${agent.sock} ${attachPane} attach ${idle.pid}; sleep 5`], { env: tmuxEnv });
    const pane = await answer(inPane);
    const attached = await answer(attachPane);
    console.log(`operator: this process via shell -> ${shell}; human tmux pane seed fetch -> ${pane}; human tmux pane attach -> ${attached}`);
    assert.match(shell, /^GOT seed/);
    assert.match(pane, /^GOT seed/);
    assert.equal(attached, 'OK attach');
  } finally { try { execFileSync('tmux', ['-L', socket, 'kill-server'], { env: tmuxEnv, stdio: 'ignore' }); } catch { /* none */ } }
});
