#!/usr/bin/env node
// PreToolUse(Bash): approve, without a permission prompt or an auto-mode classifier round, the routine
// orchestration commands a lead or worker runs: read-and-report ao-topology / agent-orchestration verbs,
// read-only `tm`, and read-only tmux. Ships with the plugin because a plugin cannot ship permission allow
// rules (TM-369; README "Lead and worker autonomy").
//
// The hook only ever says "allow" or nothing. Anything it does not recognise falls through to the normal
// permission flow, and Claude Code still applies the user's deny and ask rules after an "allow". Any internal
// error also falls through: this hook never blocks and never widens on failure.
//
// TM-432/433/434: an ALLOWLIST, not a denylist. A verb is approved only after it was read and confirmed to
// read state or record the caller's own report; every other verb, every new verb, and every argv the hook
// cannot parse exactly as the CLI does falls through. A missed approval costs a prompt, nothing more.
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The CLI's own parser (zero-dependency, side-effect-free module), so `manage --task TM-1 land` is read
// as `manage land` here exactly as ao-topology reads it (TM-432).
import { parseArgs } from '../topology/lib/util.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Shell syntax that could run a second command, substitute one, or redirect output. A command containing any
// of these is never approved here, even inside quotes: missing an approval costs a prompt, not safety.
const SHELL_SYNTAX = /[;&|<>`$\\\n\r]/;
// A trailing quoted-delimiter heredoc is data, not code (`tm task new "x" --body - <<'EOF'`), provided the
// delimiter line appears exactly once, last: an earlier one would end the heredoc and run what follows.
const HEREDOC = /^([^\n]*?)\s*<<-?\s*'([A-Za-z_][A-Za-z0-9_]*)'\n([\s\S]*)\n\2[ \t]*\n?$/;
const heredocHead = (command) => {
  const m = HEREDOC.exec(command);
  if (!m) return command;
  return m[3].split('\n').some((line) => line.trim() === m[2]) ? null : m[1];
};

// The argv the shell will pass, or null when the hook cannot be sure of it. Each word is whole: a fully
// quoted string, or unquoted characters that the shell passes through unchanged. Glob, brace, tilde and
// comment characters (`* ? [ { ~ #`) and quote concatenation (`"sta"tus`) would let the shell build a
// different argv than the one checked here, so they fall through.
const WORD = /^(?:'[^']*'|"[^"]*"|[A-Za-z0-9_@%+=:,./-]+)$/;
function shellWords(head) {
  const out = [];
  let rest = head.trim();
  while (rest) {
    const m = /^('[^']*'|"[^"]*"|[^\s'"]+)(?:\s+|$)/.exec(rest);
    if (!m || !WORD.test(m[1])) return null;
    out.push(m[1].replace(/^(['"])([\s\S]*)\1$/, '$2'));
    rest = rest.slice(m[0].length);
  }
  return out;
}

// ── which program would run ──────────────────────────────────────────────────────────────────────────
// A bare name resolves through PATH, and PATH usually holds user-writable directories (~/bin,
// ~/.local/bin) ahead of the plugin's. So the hook resolves the program the way the shell would, first
// executable on PATH, and judges its realpath, never its name. A relative path, or a PATH with an empty or
// relative entry before the match (the shell would search the cwd), falls through.
// ponytail: the hook sees Claude Code's PATH, not the Bash tool's shell profile. A profile that prepends a
// directory changes what runs without changing what is judged here; a deny rule is the fix if that matters.
const realpathOr = (path) => { try { return realpathSync(path); } catch { return null; } };
function resolveProgram(word, env) {
  if (isAbsolute(word)) return realpathOr(word);
  if (word.includes('/')) return null;
  for (const dir of String(env.PATH ?? '').split(':')) {
    if (!isAbsolute(dir)) return null;
    const file = join(dir, word);
    try { accessSync(file, constants.X_OK); if (statSync(file).isFile()) return realpathOr(file); } catch { /* next entry */ }
  }
  return null;
}
/** realpath → program name, for the launchers this plugin ships and its sibling task-management's. */
function trustedLaunchers(pluginRoot) {
  const map = new Map();
  for (const [name, path] of [['ao-topology', join(pluginRoot, 'bin', 'ao-topology')],
    ['agent-orchestration', join(pluginRoot, 'bin', 'agent-orchestration')],
    ['tm', join(pluginRoot, '..', 'task-management', 'bin', 'tm')]]) {
    const real = realpathOr(path);
    if (real) map.set(real, name);
  }
  return map;
}
/** A tmux only root can have written: its realpath is one of the system locations below, and the file and
 * EVERY directory up to `/` are owned by root and not group- or world-writable. Ownership alone is not
 * enough: a FUSE mount (fusermount3 is setuid) can present root-owned files anywhere the user can mount.
 * A user-owned tmux (a look-alike planted on PATH, or Homebrew's) falls through. */
export const TMUX_PATHS = ['/usr/bin/tmux', '/bin/tmux', '/usr/local/bin/tmux'];
export function trustedTmux(real, stat = statSync) {
  if (!TMUX_PATHS.includes(real)) return false;
  try {
    for (let p = real; ; p = dirname(p)) {
      const s = stat(p);
      if (s.uid !== 0 || (s.mode & 0o022) !== 0) return false;
      if (p === '/') return true;
    }
  } catch { return false; }
}

// ── ao-topology ──────────────────────────────────────────────────────────────────────────────────────
// NEVER approved, whatever AO_ALLOW says: a second line of defence against a future allowlist edit.
// These type into panes, launch, write config or hooks, self-approve review, land, integrate, release,
// delegate, or move a task's ownership.
const AO_DENY = {
  review: ['submit'], config: ['set'], startup: ['install-hooks'], 'git-hook': ['install'], send: null, nudge: null, launch: null,
  manage: ['land', 'integrate', 'close', 'transfer', 'assign', 'rework', 'rebind', 'record-landing', 'cleanup', 'cutover', 'cut-release'],
  delegate: null, permissions: null,
};
// Approved verbs, by ADR-0001 class (fleet/docs/adr/0001-hierarchical-authorization.md). Each was read in
// topology/cli.mjs and its library: Local-blast at most, no pane input, no launch, no exec beyond read-only
// git/tmux/`which`. An explicit subcommand is required: a bare `ao-topology mailbox` falls through.
//   read:   status (run state), capture (tmux capture-pane), wait (reply files), doctor (`which`/version
//           probes), repos list, manage status|assignment|eligible (management record, read-only git),
//           mailbox outbox|receipts|wait, lead status --cached (pure read; WITHOUT --cached it rings the
//           lead's pane, so it falls through).
//   report: ack (journal line), reply (this agent's reply file), prompt ack (this agent's prompt receipt),
//           mailbox inbox (records receipts for this agent's own mail). ack, reply and mailbox inbox act as
//           an agent, so they are approved only as the caller's own identity (see ownAgent).
//   mailbox send: writes one durable envelope from THIS session's identity (TM-356: --from cannot name
//           another agent). Delivery runs the recipient's normal admission, and the arrival ring is the
//           supervisor's pointer-only ring (TM-351), never this command typing into a pane. Standing mail
//           is how leads talk; prompting on every send would defeat the channel without adding a gate.
// Not approved (Local-blast but they launch or start a process): census and every repo-scoped verb that
// self-starts the supervisor; presence (publishes files); manage report (a finish queues a review run).
export const AO_ALLOW = {
  status: true, capture: true, wait: true, doctor: true,
  ack: (flags, env) => ownAgent(flags, env), reply: (flags, env) => ownAgent(flags, env),
  repos: ['list'],
  manage: ['status', 'assignment', 'eligible'],
  mailbox: { inbox: (flags, env) => ownAgent(flags, env), outbox: true, receipts: true, wait: true, send: true },
  // The CLI takes the agent from `prompt ack <agent>`, else --agent.
  prompt: { ack: (flags, env, positional) => ownAgent({ agent: positional[2] ?? flags.agent }, env) },
  lead: { status: (flags) => flags.cached === true },
};
/** No --agent (the CLI then uses the caller's own), or --agent naming the caller's identity. */
function ownAgent(flags, env) {
  if (flags.agent === undefined) return true;
  const me = env.AO_AGENT_ID || env.AO_SESSION_AGENT_ID;
  return Boolean(me) && flags.agent === me;
}

function aoTopology(args, env) {
  const { flags, positional } = parseArgs(args);
  const [verb, sub] = positional;
  if (!verb) return null;
  const deny = Object.hasOwn(AO_DENY, verb) ? AO_DENY[verb] : undefined;
  if (deny === null || deny?.includes(sub)) return null;
  const rule = Object.hasOwn(AO_ALLOW, verb) ? AO_ALLOW[verb] : undefined;
  const check = (r) => r === true || (typeof r === 'function' && r(flags, env, positional) === true);
  let ok;
  if (Array.isArray(rule)) ok = rule.includes(sub);
  else if (rule && typeof rule === 'object') ok = Object.hasOwn(rule, sub) && check(rule[sub]);
  else ok = check(rule);
  return ok ? `agent-orchestration: ao-topology ${verb}${Array.isArray(rule) || (rule && typeof rule === 'object') ? ` ${sub}` : ''} only reads state or reports` : null;
}

// ── agent-orchestration CLI: read-only verbs, at fixed positions (src/cli.mjs takes argv[0] as the verb) ──
const AO_CLI_VERBS = { doctor: null, status: null, services: ['status', 'probe', 'wait'] };

// ── tm: read-only verbs only ─────────────────────────────────────────────────────────────────────────
// Each read in task-management/bin/tm. board rewrites only index.json, the disposable derived cache.
// doctor writes only under --fix (repairs) and runs another CLI under --all, so both fall through. caps is
// NOT here: it runs `<cli> -V` for every agent CLI it finds on PATH. pool: only `status`.
const TM_READ = new Set(['board', 'show', 'find', 'next', 'why', 'graph', 'log', 'events', 'standup', 'stale', 'where', 'doctor']);
function tmVerb(args) {
  const argv = args.filter((a) => a !== '--json'); // bin/tm strips --json anywhere, then takes argv[0]
  const [verb, sub] = argv;
  if (verb === 'pool') return sub === 'status' && argv.length === 2 ? 'pool status' : null;
  if (!TM_READ.has(verb)) return null;
  if (verb === 'doctor' && argv.some((a) => /^--(fix|all)/.test(a))) return null;
  return verb;
}

// ── tmux: read-only subcommands only ─────────────────────────────────────────────────────────────────
const TMUX_READ = new Set(['capture-pane', 'capturep', 'list-panes', 'lsp', 'list-sessions', 'ls', 'list-windows', 'lsw', 'display-message', 'display', 'has-session', 'has']);
// tmux takes clustered single-letter flags (`-pI`), so a flag is looked for inside every cluster.
const hasFlag = (words, letter) => words.some((w) => /^-[A-Za-z]+$/.test(w) && w.includes(letter));
function tmuxReadOnly(words) {
  let i = 1;
  while (words[i] === '-L' || words[i] === '-S') i += 2; // only server selection; -f would load a config
  const sub = words[i];
  const rest = words.slice(i + 1);
  if (!TMUX_READ.has(sub) || words.some((w) => w.includes('#('))) return false; // #(...) runs a shell command
  if ((sub === 'capture-pane' || sub === 'capturep') && hasFlag(rest, 'b')) return false; // -b writes a paste buffer
  if (sub === 'display-message' || sub === 'display') return hasFlag(rest, 'p') && !hasFlag(rest, 'I'); // -I writes to a pane
  return true;
}

function judge(word, args, words, real, { pluginRoot, env, tmuxTrusted }) {
  const prog = trustedLaunchers(pluginRoot).get(real);
  if (prog === 'ao-topology') return aoTopology(args, env);
  if (prog === 'agent-orchestration' && Object.hasOwn(AO_CLI_VERBS, args[0])) {
    return AO_CLI_VERBS[args[0]] === null || AO_CLI_VERBS[args[0]].includes(args[1]) ? `agent-orchestration: ${args[0]}` : null;
  }
  if (prog === 'tm') {
    const verb = tmVerb(args);
    return verb ? `agent-orchestration: tm ${verb} (read-only task-management board)` : null;
  }
  if (basename(word) === 'tmux' && tmuxTrusted(real) && tmuxReadOnly(words)) return 'agent-orchestration: read-only tmux';
  return null;
}

// The first word as written in the command, so it can be swapped for the path that was judged.
const FIRST_WORD = /^(\s*)('[^']*'|"[^"]*"|[^\s'"]+)/;
const SAFE_PATH = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * `{ reason, command }` to approve, or null to leave it to the normal permission flow. `command` is the
 * input with its program pinned to the realpath that was judged (TOCTOU): the shell would otherwise resolve
 * the name again at run time, through a PATH a profile can prepend to, a directory that can change in
 * between, or an alias or function of the same name. A bare name also gets `command ` in front, which
 * skips aliases and functions. Everything after the first word is unchanged.
 */
export function autonomyDecision(command, { pluginRoot = PLUGIN_ROOT, env = process.env, tmuxTrusted = trustedTmux } = {}) {
  const head = (heredocHead(command) ?? '').trim();
  if (!head || SHELL_SYNTAX.test(head)) return null;
  const words = shellWords(head);
  if (!words?.length) return null;
  const [word, ...args] = words;
  const real = resolveProgram(word, env);
  if (!real) return null;
  const reason = judge(word, args, words, real, { pluginRoot, env, tmuxTrusted });
  if (!reason) return null;
  const pinned = SAFE_PATH.test(real) ? real : real.includes("'") ? null : `'${real}'`;
  if (!pinned) return null;
  const rewritten = command.replace(FIRST_WORD, (_, space, first) => `${space}${first.includes('/') ? '' : 'command '}${pinned}`);
  return { reason, command: rewritten };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const decision = input?.tool_name === 'Bash' || input?.tool_name === undefined ? autonomyDecision(String(input?.tool_input?.command ?? '')) : null;
    // updatedInput replaces every argument (docs: PreToolUse decision control), so keep the others.
    if (decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
      permissionDecisionReason: decision.reason, updatedInput: { ...input.tool_input, command: decision.command } } }));
  } catch { /* fall through to the normal permission flow */ }
  process.exit(0);
}
