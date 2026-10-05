// TM-443: the one way host-side code runs git. A worker agent runs as the same OS user as the lead
// and can write the repository's SHARED .git/config (and .git/info/attributes) from its worktree, so
// every config key that makes git execute a program is a way to run code as the lead. Each call
// therefore pins those keys through GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n, which
// outrank every config file and, unlike `-c key=value`, carry a key containing `=` exactly
// (`filter.a=b.smudge` is a real driver name; `-c` cannot express it, so it escaped):
//
//   - fixed keys (SAFE_GIT_CONFIG): fsmonitor, hooks, pager, external diff, ssh, askpass, editors,
//     signing programs, alternate-refs command, pack-objects hook, submodules, gc, and transports:
//     only https, ssh and file are allowed, so ext::, git:// and any `<helper>::` remote helper
//     (git-remote-<helper> from PATH) never run;
//   - named drivers, which no single key can disable: every filter.<name>.{clean,smudge,process}
//     and merge.<name>.driver set in a repository-writable scope (local, worktree) is listed first
//     and overridden to a no-op (a merge driver becomes `false`: a conflict, so the merge fails closed);
//   - credential helpers are reset (every key a repository scope sets, and the base key) and only the
//     global (operator's ~/.gitconfig) ones are re-added;
//   - FAIL CLOSED: a repository scope that sets url.<base>.insteadOf / pushInsteadOf (rewrites the
//     URL a host fetch reads), remote.<name>.vcs (a remote helper), lfs.standalonetransferagent or
//     lfs.customtransfer.* (programs git-lfs runs) makes every call refuse with exit 128; none of
//     them can be neutralised by an override, since each is multi-valued or read by git-lfs itself;
//   - remote.<name>.uploadpack/receivepack are first-value-wins, so no override reaches them: fetch,
//     pull and ls-remote get --upload-pack=git-upload-pack and push gets --receive-pack=git-receive-pack;
//   - diff-family commands get --no-ext-diff --no-textconv;
//   - the environment keeps only an allowlist of GIT_* names (author and committer identity): GIT_DIR,
//     GIT_SSH_COMMAND, GIT_EXEC_PATH, GIT_ASKPASS, GIT_EXTERNAL_DIFF, GIT_CONFIG_* and every other
//     caller-supplied GIT_* is dropped. The global config is pinned to the operator's own
//     ~/.gitconfig (GIT_CONFIG_GLOBAL), the system config is off (GIT_CONFIG_NOSYSTEM), git never
//     prompts (GIT_TERMINAL_PROMPT=0) and never smudges LFS objects (GIT_LFS_SKIP_SMUDGE=1).
//
// `trustedGh()` resolves the gh the host calls the same way the autonomy allowlist resolves tmux
// (TM-432): a pinned system path whose file and every directory up to `/` are root-owned and not
// group- or world-writable, never whatever `gh` comes first on PATH.
//
// Which repository a fetch reads is still the worker's `remote.origin.url`; nothing here makes its
// answer trustworthy. Trust decisions compare against the server through gh (TM-441, TM-442).
//
// Scope limit, deliberately: the global ~/.gitconfig is the operator's own file and its drivers and
// helpers are honoured. A worker that can rewrite it already owns every git the operator types, and
// nothing here can take that back. Listing and then running is two spawns: a driver added between
// them is a race we accept (the worker must win that window on the exact call).
//
// task-management/lib/safe-git.mjs is a BYTE-IDENTICAL copy (the plugins never import each other); a
// conformance test fails when they differ. Edit both together.
import { execFile, spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SAFE_GIT_CONFIG = Object.freeze([
  'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat', 'diff.external=',
  'core.sshCommand=ssh', 'core.askPass=', 'core.editor=true', 'sequence.editor=true',
  'core.alternateRefsCommand=true', 'uploadpack.packObjectsHook=env',
  'protocol.allow=never', 'protocol.https.allow=always', 'protocol.ssh.allow=always', 'protocol.file.allow=always', 'protocol.ext.allow=never',
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
const DRIVER_KEYS = '^(filter\\..+\\.(clean|smudge|process)|merge\\..+\\.driver|credential\\..*helper|url\\..+\\.(insteadof|pushinsteadof)|remote\\..+\\.vcs|lfs\\.standalonetransferagent|lfs\\.customtransfer\\..+)$';
const REFUSED_KEYS = /^(url\..+\.(insteadof|pushinsteadof)|remote\..+\.vcs|lfs\.standalonetransferagent|lfs\.customtransfer\..+)$/;
const UNTRUSTED_SCOPES = new Set(['local', 'worktree', 'command', 'unknown']);
const pair = entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)]; };

/** The only GIT_* names a caller's environment passes through: commit identity, nothing that runs or redirects. */
export const GIT_ENV_ALLOWLIST = Object.freeze(['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE']);

/** The environment every host git runs in; `config` is the ordered [key, value] list it pins. */
export function safeGitEnv(base = process.env, config = SAFE_GIT_CONFIG.map(pair)) {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !name.startsWith('GIT_') || GIT_ENV_ALLOWLIST.includes(name)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(homedir(), '.gitconfig'), GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_LFS_SKIP_SMUDGE: '1' });
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  return env;
}

/** What a driver listing (`git config --null --show-scope --get-regexp`) requires: the ordered
 * [key, value] overrides that follow SAFE_GIT_CONFIG, or a refusal naming the key that cannot be
 * neutralised. Keys may contain `=`; they travel as GIT_CONFIG_KEY_n, never as `-c`. */
export function driverOverrides(listing) {
  const out = [], resets = [], helpers = [], seen = new Set();
  const fields = String(listing || '').split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i], nl = fields[i + 1].indexOf('\n');
    const key = nl < 0 ? fields[i + 1] : fields[i + 1].slice(0, nl), value = nl < 0 ? '' : fields[i + 1].slice(nl + 1);
    if (key.startsWith('credential.')) {
      if (scope === 'global') helpers.push([key, value]);
      else if (UNTRUSTED_SCOPES.has(scope)) resets.push([key, '']);
      continue;
    }
    if (!UNTRUSTED_SCOPES.has(scope)) continue;
    if (REFUSED_KEYS.test(key)) return { overrides: [], refusal: `the repository's ${scope} config sets ${key}, which host git cannot neutralise; remove it (git config --${scope === 'worktree' ? 'worktree' : 'local'} --unset-all '${key}')` };
    const name = key.slice(key.indexOf('.') + 1, key.lastIndexOf('.'));
    const add = (k, v) => { if (!seen.has(k)) { seen.add(k); out.push([k, v]); } };
    if (key.startsWith('filter.')) { add(`filter.${name}.clean`, ''); add(`filter.${name}.smudge`, ''); add(`filter.${name}.process`, ''); add(`filter.${name}.required`, 'false'); }
    else add(key, 'false');
  }
  // Resets precede the global helpers re-added for the same keys: a helper list is cleared by an empty value.
  return { overrides: [...out, ...resets, ...helpers], refusal: null };
}

/** The pinned system locations a trusted gh may live at (Debian/Ubuntu, Fedora, Homebrew-on-Linux is user-owned and refused). */
export const GH_PATHS = Object.freeze(['/usr/bin/gh', '/bin/gh', '/usr/local/bin/gh']);
/** True when `real` is a pinned path whose file and every directory up to `/` are root-owned and not
 * group- or world-writable; the rule autonomy-allow applies to tmux (TM-432). */
export function rootOwnedChain(real, paths = GH_PATHS, stat = statSync) {
  if (!paths.includes(real)) return false;
  try {
    for (let p = real; ; p = dirname(p)) {
      const s = stat(p);
      if (s.uid !== 0 || (s.mode & 0o022) !== 0) return false;
      if (p === '/') return true;
    }
  } catch { return false; }
}
/** The gh the host runs: the first pinned path whose realpath passes rootOwnedChain, else null. PATH is never consulted. */
export function trustedGh({ paths = GH_PATHS, stat = statSync, realpath = realpathSync } = {}) {
  for (const candidate of paths) {
    let real;
    try { real = realpath(candidate); } catch { continue; }
    if (rootOwnedChain(real, paths, stat) && rootOwnedChain(candidate, paths, stat)) return candidate;
  }
  return null;
}

/** Insert the subcommand's hardening flags right after it (global options come first). */
export function hardenArgs(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i]) ? 2 : 1;
  const extra = Object.hasOwn(SUBCOMMAND_FLAGS, args[i] ?? '') ? SUBCOMMAND_FLAGS[args[i]] : [];
  return [...args.slice(0, i + 1), ...extra, ...args.slice(i + 1)];
}

const at = cwd => (cwd ? ['-C', cwd] : []);
const LIST = cwd => [...at(cwd), 'config', '--null', '--show-scope', '--get-regexp', DRIVER_KEYS];
/** The argv and pinned config a host git call runs with, given the driver listing for its repository. */
export function safeGitPlan(cwd, args, listing = '') {
  const { overrides, refusal } = driverOverrides(listing);
  return { argv: [...at(cwd), ...hardenArgs(args)], config: [...SAFE_GIT_CONFIG.map(pair), ...overrides], refusal };
}
// git from the caller's PATH: the lead's own environment, which a worker does not control.
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';
const refused = (args, refusal) => `safe-git refused git ${args.join(' ')}: ${refusal}`;

function execAsync(argv, config, options) {
  return new Promise(resolve => {
    const child = execFile(GIT, argv, { cwd: options.cwd, env: safeGitEnv(options.env, config), encoding: 'utf8', maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024, timeout: options.timeoutMs ?? 30_000, windowsHide: true },
      (error, stdout, stderr) => resolve({ code: error ? (error.killed ? 124 : typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout ?? '', stderr: stderr || (error ? String(error.message) : '') }));
    child.stdin.end(options.input ?? undefined);
  });
}

/** Async git: { code, stdout, stderr }. Throws on a non-zero exit unless options.allowFailure. */
export async function safeGit(cwd, args, options = {}) {
  const listing = await execAsync(LIST(cwd), SAFE_GIT_CONFIG.map(pair), { cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs });
  const plan = safeGitPlan(cwd, args, listing.stdout);
  const result = plan.refusal ? { code: 128, stdout: '', stderr: refused(args, plan.refusal) } : await execAsync(plan.argv, plan.config, options);
  if (result.code !== 0 && !options.allowFailure) {
    throw Object.assign(new Error(`git ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`), result);
  }
  return result;
}

/** Sync git, spawnSync-shaped: { status, stdout, stderr, error }. Never throws. */
export function safeGitSync(cwd, args, options = {}) {
  const base = { cwd: options.cwd, encoding: 'utf8', windowsHide: true, timeout: options.timeout, maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024 };
  const listing = spawnSync(GIT, LIST(cwd), { ...base, env: safeGitEnv(options.env), stdio: ['ignore', 'pipe', 'ignore'] });
  const plan = safeGitPlan(cwd, args, listing.stdout);
  if (plan.refusal) return { status: 128, stdout: '', stderr: refused(args, plan.refusal), error: undefined };
  return spawnSync(GIT, plan.argv, { ...base, env: safeGitEnv(options.env, plan.config), input: options.input, stdio: [options.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
}

/** Sync git returning trimmed stdout (raw with options.raw); throws like execFileSync on failure. */
export function safeGitText(cwd, args, options = {}) {
  const result = safeGitSync(cwd, args, options);
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error(`git ${args.join(' ')} exited ${result.status}: ${String(result.stderr || result.error?.message || '').trim()}`), { status: result.status, stderr: result.stderr, stdout: result.stdout });
  }
  return options.raw ? result.stdout : result.stdout.trim();
}
