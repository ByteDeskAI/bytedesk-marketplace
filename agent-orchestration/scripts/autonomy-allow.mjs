#!/usr/bin/env node
// PreToolUse(Bash): approve, without a permission prompt or an auto-mode classifier round, the routine
// orchestration commands a lead or worker runs: read-and-report ao-topology / agent-orchestration verbs,
// `tm`, and read-only tmux. Ships with the plugin because a plugin cannot ship permission allow rules
// (TM-369; README "Lead and worker autonomy").
//
// The hook only ever says "allow" or nothing. Anything it does not recognise falls through to the normal
// permission flow, and Claude Code still applies the user's deny and ask rules after an "allow". Any internal
// error also falls through: this hook never blocks and never widens on failure.
//
// TM-432/433/434: an ALLOWLIST, not a denylist. A verb is approved only after it was read and confirmed to
// read state or record the caller's own report; every other verb, every new verb, and every argv the hook
// cannot parse exactly as the CLI does falls through. A missed approval costs a prompt, nothing more.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
//           mailbox inbox (records receipts for this agent's own mail).
//   mailbox send: writes one durable envelope from THIS session's identity (TM-356: --from cannot name
//           another agent). Delivery runs the recipient's normal admission, and the arrival ring is the
//           supervisor's pointer-only ring (TM-351), never this command typing into a pane. Standing mail
//           is how leads talk; prompting on every send would defeat the channel without adding a gate.
// Not approved (Local-blast but they launch or start a process): census and every repo-scoped verb that
// self-starts the supervisor; presence (publishes files); manage report (a finish queues a review run).
export const AO_ALLOW = {
  status: true, capture: true, wait: true, doctor: true, ack: true, reply: true,
  repos: ['list'],
  manage: ['status', 'assignment', 'eligible'],
  mailbox: ['inbox', 'outbox', 'receipts', 'wait', 'send'],
  prompt: ['ack'],
  lead: { status: (flags) => flags.cached === true },
};
function aoTopology(args) {
  const { flags, positional } = parseArgs(args);
  const [verb, sub] = positional;
  if (!verb) return null;
  const deny = Object.hasOwn(AO_DENY, verb) ? AO_DENY[verb] : undefined;
  if (deny === null || deny?.includes(sub)) return null;
  const rule = Object.hasOwn(AO_ALLOW, verb) ? AO_ALLOW[verb] : undefined;
  const ok = rule === true || (Array.isArray(rule) ? rule.includes(sub) : Boolean(rule && Object.hasOwn(rule, sub) && rule[sub](flags)));
  return ok ? `agent-orchestration: ao-topology ${verb}${rule === true ? '' : ` ${sub}`} only reads state or reports` : null;
}

// ── agent-orchestration CLI: read-only verbs, at fixed positions (src/cli.mjs takes argv[0] as the verb) ──
const AO_CLI_VERBS = { doctor: null, status: null, services: ['status', 'probe', 'wait'] };

// ── tm ───────────────────────────────────────────────────────────────────────────────────────────────
// Operator policy and gate bypass stay with the normal flow: config, override, init, and every pool action
// but status (bare `pool` dispatches, `start|run|ensure` start a loop, `stop|resume` change its state).
const TM_DENY = new Set(['config', 'override', 'init']);
/** The realpath of this plugin's sibling task-management launcher, or null when none is installed. */
function siblingTm(pluginRoot) {
  try { return realpathSync(join(pluginRoot, '..', 'task-management', 'bin', 'tm')); } catch { return null; }
}
// TM-434: bare `tm` (resolved on PATH, which a single command here cannot change), or an absolute path
// whose realpath IS the sibling launcher. Never a path that merely looks like one: a worker can write any
// script at .bytedesk/task-management/bin/tm in its own worktree.
function isTm(prog, pluginRoot) {
  if (prog === 'tm') return true;
  if (!isAbsolute(prog)) return false;
  const sibling = siblingTm(pluginRoot);
  if (!sibling) return false;
  try { return realpathSync(prog) === sibling; } catch { return false; }
}
function tmVerb(args) {
  const argv = args.filter((a) => a !== '--json'); // bin/tm strips --json anywhere, then takes argv[0]
  const [verb, sub] = argv;
  if (!verb || verb.startsWith('-') || TM_DENY.has(verb)) return null;
  if (verb === 'pool' && sub !== 'status') return null;
  return verb;
}

// ── tmux: read-only subcommands only ─────────────────────────────────────────────────────────────────
const TMUX_READ = new Set(['capture-pane', 'capturep', 'list-panes', 'lsp', 'list-sessions', 'ls', 'list-windows', 'lsw', 'display-message', 'display', 'has-session', 'has']);
function tmuxReadOnly(words) {
  let i = 1;
  while (words[i] === '-L' || words[i] === '-S') i += 2; // only server selection; -f would load a config
  const sub = words[i];
  if (!TMUX_READ.has(sub) || words.some((w) => w.includes('#('))) return false; // #(...) runs a shell command
  if (sub === 'display-message' || sub === 'display') return words.includes('-p') && !words.includes('-I'); // -I writes to a pane
  return true;
}

/** The reason to approve `command`, or null to leave it to the normal permission flow. */
export function autonomyDecision(command, { pluginRoot = PLUGIN_ROOT } = {}) {
  const head = (heredocHead(command) ?? '').trim();
  if (!head || SHELL_SYNTAX.test(head)) return null;
  const words = shellWords(head);
  if (!words) return null;
  const [prog, ...args] = words;
  if (prog === 'ao-topology') return aoTopology(args);
  if (prog === 'agent-orchestration' && Object.hasOwn(AO_CLI_VERBS, args[0])) {
    return AO_CLI_VERBS[args[0]] === null || AO_CLI_VERBS[args[0]].includes(args[1]) ? `agent-orchestration: ${args[0]}` : null;
  }
  if (isTm(prog, pluginRoot)) {
    const verb = tmVerb(args);
    return verb ? `agent-orchestration: tm ${verb} (task-management board)` : null;
  }
  if (prog === 'tmux' && tmuxReadOnly(words)) return 'agent-orchestration: read-only tmux';
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const reason = input?.tool_name === 'Bash' || input?.tool_name === undefined ? autonomyDecision(String(input?.tool_input?.command ?? '')) : null;
    if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason } }));
  } catch { /* fall through to the normal permission flow */ }
  process.exit(0);
}
