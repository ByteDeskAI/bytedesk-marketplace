#!/usr/bin/env node
// PreToolUse(Bash): block `git commit` in a repository whose .claude/settings.json enables agent-orchestration or
// task-management at project scope. Both are user-scope installs; a project entry makes a per-project install record.
// Per-repo data (.bytedesk/task-management/tasks, plans, ...) is not settings and is never checked.
// Hygiene gate, not a safety gate: any internal error allows the commit (exit 0) rather than blocking work.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const command = String(input?.tool_input?.command ?? '');
  // Cheap exit first: this hook runs on every Bash call in every repository.
  if (!/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) process.exit(0);
  const cwd = input.cwd || process.cwd();
  const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const repo = top.status === 0 ? top.stdout.trim() : cwd;
  const check = join(dirname(fileURLToPath(import.meta.url)), 'check-no-project-plugin-installs.mjs');
  const result = spawnSync(process.execPath, [check, repo], { encoding: 'utf8' });
  if (result.status === 1) {
    process.stderr.write(`${result.stderr}\nCommit blocked: remove the entry named above from ${join(repo, '.claude', 'settings.json')}.\nThese plugins are enabled in ~/.claude/settings.json; a project-level entry creates a per-project install.\n`);
    process.exit(2);
  }
} catch { /* fail open */ }
process.exit(0);
