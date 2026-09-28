// TM-243: operator-installed Claude Code allow rules for the repository lead's governed verbs.
//
// A rule only removes the per-command permission prompt. It grants no authority: record-landing and
// integrate still need a TM-234 delegation proven for the calling pane, and every other verb keeps
// its own ownership checks. The rule list is fixed (Ryan, 2026-09-25) plus MCP server names the
// operator opts into; raw `gh pr merge`, `git push` and deploy commands are never written.
//
// WHERE: `<lead launch cwd>/.claude/settings.local.json`. Claude Code reads project settings from the
// directory a session starts in, and a standing lead starts in its own agent directory, so the file
// is read by that lead alone: dispatched workers start in task worktrees and never read it. If the
// lead's recorded launch directory is NOT its agent directory (TM-242 moves it to the repository
// root), a settings.local.json there is read by every session started at the root, so install refuses
// rather than widening the rules to them. See docs/repository-leads.md.
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agentDirs, findLead } from './agents.mjs';
import { requireNoAgentSession } from './delegation.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { invariant, fail, readJson, writeJson } from './util.mjs';

export const GOVERNED_VERBS = Object.freeze(['record-landing', 'integrate', 'start-worker', 'stop-worker', 'admit', 'report']);
export const BASE_RULES = Object.freeze([...GOVERNED_VERBS.map(verb => `Bash(ao-topology manage ${verb} *)`), 'Bash(tm *)']);
const MCP_NAME = /^mcp__[A-Za-z0-9_-]+$/;
export const RESTART_NOTE = 'Restart the lead\'s Claude Code session: permission rules and MCP tools load at startup. An allow rule for an MCP server does not load it; a standing lead runs with --strict-mcp-config, so the server must also be in the lead\'s agent.json "mcp" field.';

/** The exact rules for an operator-chosen list of MCP server/tool names. */
export function permissionRules(mcp = []) {
  const names = [...new Set(mcp.map(s => String(s).trim()).filter(Boolean))];
  for (const name of names) invariant(MCP_NAME.test(name), 'TOPOLOGY_PERMISSIONS_MCP', `--mcp ${name} is not an MCP server or tool name (mcp__<server> or mcp__<server>__<tool>, no wildcards).`);
  return [...BASE_RULES, ...names];
}

/** Claude Code's `Bash(<prefix> *)` match for ONE simple command. Shell operators split a command
 * into several, each needing its own rule, which is why governed verbs offer --summary instead of a
 * pipe to jq. An env-var prefix (`AO_AGENT_ID=x ao-topology ...`) matches nothing here. */
export function ruleMatches(rule, command) {
  const m = /^Bash\((.+) \*\)$/.exec(rule);
  if (!m || /[|;&<>`$()\n]/.test(command)) return false;
  return command === m[1] || command.startsWith(`${m[1]} `);
}

/** Where the lead's Claude Code session reads machine-local settings, proven from its launch record. */
export async function leadSettingsTarget({ consumer }) {
  const lead = await findLead(agentDirs({ consumer }));
  invariant(lead, 'TOPOLOGY_PERMISSIONS_LEAD', 'This repository has no registered lead (role "lead" in .bytedesk/agent-orchestration/agents/*/agent.json).');
  const session = await readJson(join(lead._dir, 'session.json')).catch(() => null);
  invariant(typeof session?.cwd === 'string' && session.cwd, 'TOPOLOGY_PERMISSIONS_LEAD', `Lead ${lead.id} has no launch record (${join(lead._dir, 'session.json')}); start it once with \`ao-topology lead ensure\` so its launch directory is known, then rerun.`);
  const [cwd, own] = await Promise.all([realpath(session.cwd).catch(() => session.cwd), realpath(lead._dir)]);
  invariant(cwd === own, 'TOPOLOGY_PERMISSIONS_TARGET_SHARED', `Lead ${lead.id} launches in ${session.cwd}, not its own agent directory ${lead._dir}. A .claude/settings.local.json there is read by every session started in that directory (other standing agents, the operator), so it is not per-lead; refusing. See "Permission rules for the lead" in docs/repository-leads.md.`);
  return { lead: lead.id, path: join(session.cwd, '.claude', 'settings.local.json') };
}

async function ledgerPath(consumer, env, home) {
  return join(stateRoot(env, home), 'permissions', `${repoKey((await canonicalRepoId(consumer)).id)}.json`);
}

async function readSettings(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { text: null, doc: {} }; throw error; }
  let doc;
  try { doc = JSON.parse(text); } catch (error) { fail('TOPOLOGY_PERMISSIONS_SETTINGS', `${path} is not valid JSON (${error.message}); fix it by hand, nothing was changed.`); }
  invariant(doc && typeof doc === 'object' && !Array.isArray(doc), 'TOPOLOGY_PERMISSIONS_SETTINGS', `${path} is not a JSON object; nothing was changed.`);
  invariant(doc.permissions === undefined || (doc.permissions && typeof doc.permissions === 'object' && !Array.isArray(doc.permissions)), 'TOPOLOGY_PERMISSIONS_SETTINGS', `${path} has a non-object "permissions"; nothing was changed.`);
  invariant(doc.permissions?.allow === undefined || Array.isArray(doc.permissions.allow), 'TOPOLOGY_PERMISSIONS_SETTINGS', `${path} has a non-array "permissions.allow"; nothing was changed.`);
  return { text, doc };
}

const render = doc => `${JSON.stringify(doc, null, 2)}\n`;

/** A minimal unified-style line diff (LCS). Settings files are a few dozen lines. */
export function lineDiff(before, after, path) {
  const a = before == null ? [] : before.replace(/\n$/, '').split('\n'), b = after.replace(/\n$/, '').split('\n');
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const lines = [`--- ${before == null ? '/dev/null' : path}`, `+++ ${path}`];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(`  ${a[i]}`); i++; j++; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) lines.push(`+ ${b[j++]}`);
    else lines.push(`- ${a[i++]}`);
  }
  return lines.join('\n');
}

async function apply({ consumer, env, home, ancestors, verb, dryRun, change }) {
  await requireNoAgentSession(env, home, verb, ancestors, 'lead permission rules', 'TOPOLOGY_PERMISSIONS_OPERATOR_ONLY');
  const ledgerFile = await ledgerPath(consumer, env, home);
  const ledger = await readJson(ledgerFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  // Uninstall goes where install wrote, even if the lead has since moved; install needs the proven target.
  const target = verb === 'uninstall' && ledger ? { lead: ledger.lead, path: ledger.path } : await leadSettingsTarget({ consumer });
  invariant(!ledger?.rules?.length || ledger.path === target.path, 'TOPOLOGY_PERMISSIONS_LEDGER', `Rules are installed at ${ledger?.path}, not ${target.path}; run permissions uninstall first (the lead's launch directory changed).`);
  const { text, doc } = await readSettings(target.path);
  const allow = doc.permissions?.allow || [];
  const { next, owned, added, removed } = change(allow, ledger?.rules || []);
  const changed = added.length > 0 || removed.length > 0;
  const afterDoc = changed ? { ...doc, permissions: { ...(doc.permissions || {}), allow: next } } : doc;
  if (changed && !dryRun) await writeJson(target.path, afterDoc);
  if (!dryRun) await writeJson(ledgerFile, { path: target.path, lead: target.lead, rules: owned, updated_at: new Date().toISOString() });
  return { ok: true, lead: target.lead, path: target.path, changed, dry_run: dryRun === true, added, removed, owned,
    diff: changed ? lineDiff(text, render(afterDoc), target.path) : '(no change)' };
}

/** Operator-only. Adds the missing rules, records exactly which ones it added, never rewrites others. */
export async function installPermissions({ consumer, mcp = [], dryRun = false, env = process.env, home = homedir(), ancestors }) {
  const rules = permissionRules(mcp);
  const result = await apply({ consumer, env, home, ancestors, verb: 'install', dryRun, change: (allow, owned) => {
    const added = rules.filter(rule => !allow.includes(rule));
    return { next: [...allow, ...added], owned: [...new Set([...owned, ...added])], added, removed: [] };
  } });
  return { ...result, rules, restart: RESTART_NOTE };
}

/** Operator-only. Removes only the rules install recorded as its own; a rule the operator already
 * had before install is not in that record and is left in place, as is every other key. */
export async function uninstallPermissions({ consumer, dryRun = false, env = process.env, home = homedir(), ancestors }) {
  return apply({ consumer, env, home, ancestors, verb: 'uninstall', dryRun, change: (allow, owned) => ({
    next: allow.filter(rule => !owned.includes(rule)), owned: [], added: [], removed: allow.filter(rule => owned.includes(rule)) }) });
}
