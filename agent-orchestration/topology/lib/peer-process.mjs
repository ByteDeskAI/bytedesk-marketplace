// TM-317: who is on the other end of an accepted unix socket, and the process-tree questions the
// credential holder asks about them. Linux reads /proc and `ss`; darwin has no /proc, so it asks
// `lsof -U -F` and `ps`. Every external tool's output goes through a pure parser so it can be tested
// against recorded text. Anything unparseable yields [] / 0 / false: the holder then fails CLOSED.
//
// NOT VERIFIED ON REAL macOS: the darwin branch was written from lsof's documented -F format and tested
// against synthesized fixtures plus a fake `lsof` on Linux. Run scripts/verify-macos-holder.sh on a Mac.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';

const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });

// ---- pure parsers ----------------------------------------------------------------------------------

/** `ss -xnH src <path>` output + our socket's inode -> the peer's inode, or null. */
export function parseSsPeerInode(text, inode) {
  const row = String(text ?? '').split('\n').map((line) => line.trim().split(/\s+/)).find((fields) => fields.includes(inode));
  return row ? (row[row.indexOf(inode) + 2] ?? null) : null;
}

/**
 * `lsof -nP -U -F pfdtn` output -> [{pid, fd, type, device, name}] one per file descriptor.
 * -F emits one field per line, the first character names the field; `p` starts a process, `f` a descriptor.
 */
export function parseLsofFields(text) {
  const rows = [];
  let pid = null;
  let row = null;
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue;
    const value = line.slice(1);
    switch (line[0]) {
      case 'p': pid = /^\d+$/.test(value) ? Number(value) : null; row = null; break;
      case 'f': row = pid === null ? null : { pid, fd: value, type: '', device: '', name: '' }; if (row) rows.push(row); break;
      case 't': if (row) row.type = value; break;
      case 'd': if (row) row.device = value.toLowerCase(); break;
      case 'n': if (row) row.name = value; break;
      default: break;
    }
  }
  return rows;
}

const PEER_ADDR = /->\s*(0x[0-9a-f]+)/i;

/**
 * Darwin: lsof shows each connected unix socket as DEVICE=<its kernel pcb address>, NAME=...->0x<peer pcb>.
 * Our accepted socket (pid `self`, descriptor `fd`) names the peer's pcb; every other process holding a
 * socket whose pcb is that address (or whose peer is ours) is the peer. [] unless our own row is found.
 */
export function darwinPeerPids(rows, self, fd) {
  const mine = rows.find((r) => r.pid === self && r.fd === String(fd) && r.type.toUpperCase() === 'UNIX');
  const peer = mine && PEER_ADDR.exec(mine.name)?.[1].toLowerCase();
  if (!mine || !peer || !mine.device) return [];
  const found = new Set();
  for (const r of rows) {
    if (r.pid === self || r.type.toUpperCase() !== 'UNIX') continue;
    if (r.device === peer || PEER_ADDR.exec(r.name)?.[1].toLowerCase() === mine.device) found.add(r.pid);
  }
  return [...found];
}

/** `ps -o ppid= -p <pid>` output -> pid, 0 when unparseable. */
export function parsePsPpid(text) {
  const value = String(text ?? '').trim();
  return /^\d+$/.test(value) ? Number(value) : 0;
}

// ---- platform dispatch -----------------------------------------------------------------------------

function linuxPeerPids(socket, sockPath, { exec, fd }) {
  const inode = readlinkSync(`/proc/self/fd/${fd}`).slice('socket:['.length, -1);
  const peer = parseSsPeerInode(exec('ss', ['-xnH', 'src', sockPath]), inode);
  if (!peer) return [];
  const found = [];
  for (const dir of readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue;
    try { for (const f of readdirSync(`/proc/${dir}/fd`)) if (readlinkSync(`/proc/${dir}/fd/${f}`) === `socket:[${peer}]`) found.push(Number(dir)); } catch { /* not ours */ }
  }
  return found;
}

/** Pids holding the other end of this accepted unix socket. [] when it cannot be proven (fail closed). */
export function peerPids(socket, sockPath, { platform = process.platform, exec = defaultExec, pid = process.pid } = {}) {
  try {
    const fd = socket._handle.fd;
    if (platform === 'linux') return linuxPeerPids(socket, sockPath, { exec, fd });
    if (platform === 'darwin') return darwinPeerPids(parseLsofFields(exec('lsof', ['-nP', '-U', '-F', 'pfdtn'])), pid, fd);
    return []; // ponytail: other platforms have no peer discovery; the holder refuses.
  } catch { return []; }
}

export function parentOf(pid, { platform = process.platform, exec = defaultExec } = {}) {
  try {
    if (platform === 'linux') return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]) || 0;
    if (platform === 'darwin') return parsePsPpid(exec('ps', ['-o', 'ppid=', '-p', String(pid)]));
  } catch { /* gone */ }
  return 0;
}

export function isAlive(pid, { platform = process.platform, kill = process.kill.bind(process) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === 'linux') return existsSync(`/proc/${pid}`);
  try { kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/** `ps -axo pid=,args=` output -> [{pid, argv}] (argv split on whitespace: enough to match a binary and a config path). */
export function parsePsList(text) {
  return String(text ?? '').split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    return m ? [{ pid: Number(m[1]), argv: m[2].split(/\s+/) }] : [];
  });
}

/** argv of a process, or null. Linux /proc; darwin ps. */
export function argvOf(pid, { platform = process.platform, exec = defaultExec } = {}) {
  try {
    if (platform === 'linux') return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (platform === 'darwin') return parsePsList(exec('ps', ['-o', 'pid=,args=', '-p', String(pid)]))[0]?.argv ?? null;
  } catch { /* gone */ }
  return null;
}

/** Every process's argv. [] when it cannot be listed. */
export function listArgv({ platform = process.platform, exec = defaultExec } = {}) {
  try {
    if (platform === 'linux') return readdirSync('/proc').filter((d) => /^\d+$/.test(d)).flatMap((d) => { const argv = argvOf(Number(d), { platform }); return argv ? [{ pid: Number(d), argv }] : []; });
    if (platform === 'darwin') return parsePsList(exec('ps', ['-axo', 'pid=,args=']));
  } catch { /* unlistable */ }
  return [];
}

// ---- TM-332: lineage markers and a positive operator proof (Linux; elsewhere they say "no evidence") -----------
// "Not a descendant of an agent root" is NOT proof of being the operator: a same-uid process that double-forks out of a pane
// reparents to pid 1. These helpers add evidence that survives reparenting. They raise the cost of an escape; they do not
// stop a same-uid process that scrubs its environment, changes session and execs node (docs/adr/0003, "TM-332 mitigation").

/** Fields of /proc/<pid>/stat that survive reparenting: {pgrp, sid, tty}. null when unreadable (not Linux, gone). */
export function procStat(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ');
    return { pgrp: Number(f[1]), sid: Number(f[2]), tty: Number(f[3]) };
  } catch { return null; }
}

/** Which of `names` are set in the process's initial environment. undefined when it cannot be read (callers fail closed). */
export function environNames(pid, names) {
  try {
    const have = new Set(readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0').map((kv) => kv.slice(0, kv.indexOf('='))));
    return names.filter((n) => have.has(n));
  } catch { return undefined; }
}

/** True when the process's executable is the node binary (the kernel's /proc/<pid>/exe, not the forgeable argv[0]). */
export function exeIsNode(pid) {
  try { return /^node(js)?( \(deleted\))?$/.test(readlinkSync(`/proc/${pid}/exe`).split('/').pop()); } catch { return false; }
}

/**
 * Why this peer is agent lineage (a string), or null when no marker catches it. `roots` are live pane-root pids; `isDesc(pid, root)`
 * is the ancestry test. `off` names markers to skip (a test-only mutation switch passed at holder start, never read from the environment).
 * Markers, with the false positive each avoids:
 *  descendant  kernel parent chain reaches a root (the original check).
 *  env         initial environment has AO_AGENT_ID or AO_CREDS_SOCK: set only in a pane; daemonizing keeps it unless scrubbed.
 *  session     same Linux session as a root that is its own session leader (a tmux pane process is). A root that merely lives in a
 *              human's session is not used, or the operator who started it would be flagged.
 *  pgrp        same process group as a root that leads its group (same guard).
 * Rejected after evaluation: tty (equal tty_nr implies the same session, so it adds nothing over `session`); cwd under the agent
 * directory (an operator legitimately sits there); start time after the root (every later process qualifies).
 */
export function lineageReason(pid, roots, { isDesc, off = [] } = {}) {
  const skip = new Set(off);
  if (!skip.has('descendant') && roots.some((root) => isDesc(pid, root))) return 'descendant';
  if (process.platform !== 'linux') return null; // ponytail: markers read /proc; darwin has descendant only (ADR-0003)
  if (!skip.has('env')) {
    const names = environNames(pid, ['AO_AGENT_ID', 'AO_CREDS_SOCK']);
    if (names === undefined) return 'environ-unreadable'; // fail closed
    if (names.length) return `env:${names.join(',')}`;
  }
  const me = procStat(pid);
  if (!me) return 'stat-unreadable';
  for (const root of roots) {
    const r = procStat(root);
    if (!r) continue;
    if (!skip.has('session') && r.sid === root && me.sid === r.sid) return `session:${r.sid}`;
    if (!skip.has('pgrp') && r.pgrp === root && me.pgrp === r.pgrp) return `pgrp:${r.pgrp}`;
  }
  return null;
}

/** Positive operator evidence for operator-only verbs: the peer runs the node binary. A forged cmdline is not consulted. */
export function operatorProof(pid, { off = [] } = {}) {
  return off.includes('exe') || process.platform !== 'linux' ? true : exeIsNode(pid);
}
