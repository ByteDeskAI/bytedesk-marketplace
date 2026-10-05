#!/usr/bin/env node
// PreToolUse(Bash): approve, without a permission prompt or an auto-mode classifier round, the routine
// orchestration commands a lead or worker runs: ao-topology / agent-orchestration verbs, `tm`, and read-only
// tmux. Ships with the plugin because a plugin cannot ship permission allow rules (TM-369; README "Lead and worker autonomy").
//
// The hook only ever says "allow" or nothing. Anything it does not recognise falls through to the normal
// permission flow, and Claude Code still applies the user's deny and ask rules after an "allow". Any internal
// error also falls through: this hook never blocks and never widens on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const TM = /^(?:tm|(?:\.\/|\/(?:[^\s/]+\/)*)?\.bytedesk\/task-management\/bin\/tm)$/;
// Gated verbs stay with the normal permission flow: landing and merging (PR-level, ADR-0001 in fleet/docs),
// worktree/branch cleanup, standing delegations and permission rules (operator-only by design).
const AO_GATED = { manage: ['integrate', 'record-landing', 'cleanup', 'cutover', 'cut-release', 'land'], delegate: ['grant', 'revoke'], permissions: null };
const AO_CLI_VERBS = { doctor: null, status: null, 'session-open': null, services: ['status', 'ensure', 'probe', 'wait'] };
const TMUX_READ = new Set(['capture-pane', 'capturep', 'list-panes', 'lsp', 'list-sessions', 'ls', 'list-windows', 'lsw', 'display-message', 'display', 'has-session', 'has']);

const unquote = (word) => word.replace(/^(['"])(.*)\1$/, '$2');

function tmuxReadOnly(words) {
  let i = 1;
  while (words[i] === '-L' || words[i] === '-S') i += 2; // only server selection; -f would load a config
  const sub = words[i];
  if (!TMUX_READ.has(sub) || words.some((w) => w.includes('#('))) return false; // #(...) runs a shell command
  if (sub === 'display-message' || sub === 'display') return words.includes('-p') && !words.includes('-I'); // -I writes to a pane
  return true;
}

/** The reason to approve `command`, or null to leave it to the normal permission flow. */
export function autonomyDecision(command) {
  const head = (heredocHead(command) ?? '').trim();
  if (!head || SHELL_SYNTAX.test(head)) return null;
  const words = (head.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(unquote);
  const [prog, verb, sub] = words;
  if (prog === 'ao-topology' && verb) {
    if (verb in AO_GATED && (AO_GATED[verb] === null || AO_GATED[verb].includes(sub))) return null;
    return `agent-orchestration: ao-topology ${verb} is a routine orchestration verb`;
  }
  if (prog === 'agent-orchestration' && verb in AO_CLI_VERBS) {
    return AO_CLI_VERBS[verb] === null || AO_CLI_VERBS[verb].includes(sub) ? `agent-orchestration: ${verb}` : null;
  }
  // `tm override` mints a one-shot bypass of the board's own gates: the operator's call, never auto-approved.
  if (TM.test(prog) && verb && verb !== 'override') return `agent-orchestration: tm ${verb} (task-management board)`;
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
