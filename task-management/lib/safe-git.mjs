// TM-443: the one way host-side code runs git. A worker agent runs as the same OS user as the lead
// and can write the repository's SHARED .git/config (and .git/info/attributes) from its worktree, so
// every config key that makes git execute a program is a way to run code as the lead. Each call
// therefore pins those keys on the command line, where they outrank every config file:
//
//   - fixed keys (SAFE_GIT_CONFIG): fsmonitor, hooks, pager, external diff, ssh, askpass, editors,
//     signing programs, alternate-refs command, pack-objects hook, ext:: transport, submodules, gc;
//   - named drivers, which no single key can disable: every filter.<name>.{clean,smudge,process}
//     and merge.<name>.driver set in a repository-writable scope (local, worktree) is listed first
//     and overridden to a no-op (a merge driver becomes `false`: a conflict, so the merge fails closed);
//   - credential helpers are reset and only the global (operator's ~/.gitconfig) ones are re-added;
//   - remote.<name>.uploadpack/receivepack are first-value-wins, so -c cannot override them: fetch,
//     pull and ls-remote get --upload-pack=git-upload-pack and push gets --receive-pack=git-receive-pack;
//   - diff-family commands get --no-ext-diff --no-textconv; env drops GIT_EXTERNAL_DIFF and the
//     system config (GIT_CONFIG_NOSYSTEM) and never prompts (GIT_TERMINAL_PROMPT=0).
//
// Scope limit, deliberately: the global ~/.gitconfig is the operator's own file and its drivers and
// helpers are honoured. A worker that can rewrite it already owns every git the operator types, and
// nothing here can take that back. Listing and then running is two spawns: a driver added between
// them is a race we accept (the worker must win that window on the exact call).
//
// task-management/lib/safe-git.mjs is a BYTE-IDENTICAL copy (the plugins never import each other); a
// conformance test fails when they differ. Edit both together.
import { execFile, spawnSync } from 'node:child_process';

export const SAFE_GIT_CONFIG = Object.freeze([
  'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat', 'diff.external=',
  'core.sshCommand=ssh', 'core.askPass=', 'core.editor=true', 'sequence.editor=true',
  'core.alternateRefsCommand=true', 'uploadpack.packObjectsHook=env', 'protocol.ext.allow=never',
  'gpg.program=gpg', 'gpg.ssh.program=ssh-keygen', 'gpg.x509.program=gpgsm', 'commit.gpgSign=false', 'tag.gpgSign=false',
  'merge.verifySignatures=false', 'log.showSignature=false', 'submodule.recurse=false', 'fetch.recurseSubmodules=false',
  'gc.auto=0', 'maintenance.auto=false', 'credential.helper=',
]);
const DIFF_FAMILY = ['diff', 'diff-tree', 'diff-index', 'diff-files', 'log', 'show', 'format-patch', 'whatchanged'];
const SUBCOMMAND_FLAGS = Object.freeze({
  fetch: ['--upload-pack=git-upload-pack'], pull: ['--upload-pack=git-upload-pack'], 'ls-remote': ['--upload-pack=git-upload-pack'],
  push: ['--receive-pack=git-receive-pack'],
  ...Object.fromEntries(DIFF_FAMILY.map(name => [name, ['--no-ext-diff', '--no-textconv']])),
});
const DRIVER_KEYS = '^(filter\\..+\\.(clean|smudge|process)|merge\\..+\\.driver|credential\\..*helper)$';
const UNTRUSTED_SCOPES = new Set(['local', 'worktree', 'command', 'unknown']);

/** The environment every host git runs in. */
export function safeGitEnv(base = process.env) {
  const env = { ...base, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  for (const name of ['GIT_EXTERNAL_DIFF', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[name];
  return env;
}

const pairs = flags => flags.flatMap(entry => ['-c', entry]);
/** `-c` overrides for drivers named in config (`git config --null --show-scope --get-regexp` output). */
export function driverOverrides(listing) {
  const out = [], helpers = [];
  const fields = String(listing || '').split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i], nl = fields[i + 1].indexOf('\n');
    const key = nl < 0 ? fields[i + 1] : fields[i + 1].slice(0, nl), value = nl < 0 ? '' : fields[i + 1].slice(nl + 1);
    if (key.includes('=')) continue; // not expressible as -c; a helper so named is simply not re-added
    if (key.startsWith('credential.')) { if (scope === 'global') helpers.push(`${key}=${value}`); continue; }
    if (!UNTRUSTED_SCOPES.has(scope)) continue;
    const name = key.slice(key.indexOf('.') + 1, key.lastIndexOf('.'));
    if (key.startsWith('filter.')) out.push(`filter.${name}.clean=`, `filter.${name}.smudge=`, `filter.${name}.process=`, `filter.${name}.required=false`);
    else out.push(`${key}=false`);
  }
  return [...new Set(out), ...helpers];
}

/** Insert the subcommand's hardening flags right after it (global options come first). */
export function hardenArgs(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i]) ? 2 : 1;
  const extra = Object.hasOwn(SUBCOMMAND_FLAGS, args[i] ?? '') ? SUBCOMMAND_FLAGS[args[i]] : [];
  return [...args.slice(0, i + 1), ...extra, ...args.slice(i + 1)];
}

const at = cwd => (cwd ? ['-C', cwd] : []);
const LIST = cwd => [...pairs(SAFE_GIT_CONFIG), ...at(cwd), 'config', '--null', '--show-scope', '--get-regexp', DRIVER_KEYS];
/** The full argv a host git call runs with, given the driver listing for its repository. */
export const safeGitArgv = (cwd, args, listing = '') => [...pairs(SAFE_GIT_CONFIG), ...pairs(driverOverrides(listing)), ...at(cwd), ...hardenArgs(args)];
// git from the caller's PATH: the lead's own environment, which a worker does not control.
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function execAsync(argv, options) {
  return new Promise(resolve => {
    const child = execFile(GIT, argv, { cwd: options.cwd, env: safeGitEnv(options.env), encoding: 'utf8', maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024, timeout: options.timeoutMs ?? 30_000, windowsHide: true },
      (error, stdout, stderr) => resolve({ code: error ? (error.killed ? 124 : typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout ?? '', stderr: stderr || (error ? String(error.message) : '') }));
    child.stdin.end(options.input ?? undefined);
  });
}

/** Async git: { code, stdout, stderr }. Throws on a non-zero exit unless options.allowFailure. */
export async function safeGit(cwd, args, options = {}) {
  const listing = await execAsync(LIST(cwd), { cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs });
  const result = await execAsync(safeGitArgv(cwd, args, listing.stdout), options);
  if (result.code !== 0 && !options.allowFailure) {
    throw Object.assign(new Error(`git ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`), result);
  }
  return result;
}

/** Sync git, spawnSync-shaped: { status, stdout, stderr, error }. Never throws. */
export function safeGitSync(cwd, args, options = {}) {
  const base = { cwd: options.cwd, env: safeGitEnv(options.env), encoding: 'utf8', windowsHide: true, timeout: options.timeout, maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024 };
  const listing = spawnSync(GIT, LIST(cwd), { ...base, stdio: ['ignore', 'pipe', 'ignore'] });
  return spawnSync(GIT, safeGitArgv(cwd, args, listing.stdout), { ...base, input: options.input, stdio: [options.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
}

/** Sync git returning trimmed stdout (raw with options.raw); throws like execFileSync on failure. */
export function safeGitText(cwd, args, options = {}) {
  const result = safeGitSync(cwd, args, options);
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error(`git ${args.join(' ')} exited ${result.status}: ${String(result.stderr || result.error?.message || '').trim()}`), { status: result.status, stderr: result.stderr, stdout: result.stdout });
  }
  return options.raw ? result.stdout : result.stdout.trim();
}
