#!/usr/bin/env node
// Guard: the named bytedesk plugins are installed at user scope only. Default: agent-orchestration and task-management.
// Add more with --plugin <name> (repeatable); `--plugin all` covers every @bytedesk plugin.
//   check-no-project-plugin-installs.mjs [repoDir ...]   fail if a repo's .claude/settings.json enables one
//   check-no-project-plugin-installs.mjs --installs      fail if ~/.claude/plugins/installed_plugins.json holds a non-user install of one
// Exit 0 clean, 1 violations, 2 unreadable input. Claude Code has no setting that forbids project scope, so this is a check, not a block.
// The repo predicate lives in src/services/project-scope.mjs, shared with the SessionStart warning (TM-285).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PLUGINS, isGuardedPlugin, projectPluginViolations } from '../src/services/project-scope.mjs';

const argv = process.argv.slice(2);
const names = [];
const args = argv.filter((arg, i) => (argv[i - 1] === '--plugin' ? (names.push(arg), false) : arg !== '--plugin'));
if (!names.length) names.push(...DEFAULT_PLUGINS);
const problems = [];

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { console.error(`cannot read ${path}: ${error.message}`); process.exit(2); }
}

if (args.includes('--installs')) {
  const file = process.env.AO_INSTALLED_PLUGINS || join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) { console.error(`cannot read ${file}: not found`); process.exit(2); }
  for (const [id, entries] of Object.entries(readJson(file).plugins ?? {})) {
    if (!isGuardedPlugin(id, names)) continue;
    for (const entry of entries) if (entry.scope !== 'user') problems.push(`${id}: ${entry.scope}-scope install${entry.projectPath ? ` for ${entry.projectPath}` : ''}`);
  }
} else {
  for (const dir of args.length ? args : ['.']) {
    let found;
    try { found = projectPluginViolations(dir, names); }
    catch (error) { console.error(`cannot read ${join(dir, '.claude', 'settings.json')}: ${error.message}`); process.exit(2); }
    for (const { file, id } of found) problems.push(`${file}: enables ${id}; enable it in ~/.claude/settings.json instead`);
  }
}

for (const problem of problems) console.error(`FAIL ${problem}`);
console.log(problems.length ? `${problems.length} violation(s)` : 'ok: no project-scope bytedesk plugin installs');
process.exit(problems.length ? 1 : 0);
