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
//     lfs.customtransfer.* (programs git-lfs runs), any http.* key or remote.<name>.proxy (a proxy, a
//     CA, sslVerify=false or a per-URL http.<url>.* form, which outranks any generic override; TM-475)
//     makes every call refuse with exit 128; none of them can be neutralised by an override;
//   - remote.<name>.uploadpack/receivepack are first-value-wins, so no override reaches them: fetch,
//     pull and ls-remote get --upload-pack=git-upload-pack and push gets --receive-pack=git-receive-pack;
//   - diff-family commands get --no-ext-diff --no-textconv;
//   - the environment keeps only an allowlist of GIT_* names (author and committer identity): GIT_DIR,
//     GIT_SSH_COMMAND, GIT_EXEC_PATH, GIT_ASKPASS, GIT_EXTERNAL_DIFF, GIT_CONFIG_* and every other
//     caller-supplied GIT_* is dropped. The global config is pinned to the operator's own
//     ~/.gitconfig (GIT_CONFIG_GLOBAL), where ~ is the passwd entry's home, never $HOME (TM-475), the
//     system config is off (GIT_CONFIG_NOSYSTEM), git never prompts (GIT_TERMINAL_PROMPT=0) and never
//     smudges LFS objects (GIT_LFS_SKIP_SMUDGE=1); core.attributesFile is empty, so
//     $XDG_CONFIG_HOME/git/attributes is never read.
//
// `trustedBinary()` resolves every program the host runs here the same way the autonomy allowlist
// resolves tmux (TM-432): a pinned system path whose file and every directory up to `/` are root-owned
// and not group- or world-writable, never whatever comes first on PATH. That is gh (`trustedGh()`),
// git itself and ssh (core.sshCommand names the pinned ssh) (TM-475).
//
// `safeGh` / `safeGhSync` run that gh with GH_HOST pinned to github.com (otherwise gh takes the only
// host in its same-uid-writable hosts.yml as the default) and GH_REPO, GH_CONFIG_DIR, proxies and CA
// bundles removed, and refuse outright when gh's own config sets http_unix_socket, so a compare cannot
// be answered by a worker-served socket (TM-475).
//
// Which repository a host fetch reads is decided by its caller: agent-orchestration fetches the
// origin URL pinned in host state (TM-472), and trust decisions compare against the server through gh
// (TM-441, TM-442).
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
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';

/** The pinned system locations of the programs the host runs (TM-475). Homebrew-on-Linux and ~/bin are user-owned and refused. */
export const GH_PATHS = Object.freeze(['/usr/bin/gh', '/bin/gh', '/usr/local/bin/gh']);
export const GIT_PATHS = Object.freeze(['/usr/bin/git', '/bin/git', '/usr/local/bin/git']);
export const SSH_PATHS = Object.freeze(['/usr/bin/ssh', '/bin/ssh', '/usr/local/bin/ssh']);
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
/** The first pinned path whose realpath passes rootOwnedChain, else null. PATH is never consulted. */
export function trustedBinary({ paths, stat = statSync, realpath = realpathSync }) {
  for (const candidate of paths) {
    let real;
    try { real = realpath(candidate); } catch { continue; }
    if (rootOwnedChain(real, paths, stat) && rootOwnedChain(candidate, paths, stat)) return candidate;
  }
  return null;
}
/** The gh the host runs. */
export function trustedGh(options = {}) { return trustedBinary({ paths: GH_PATHS, ...options }); }
// Resolved once: git spawns core.sshCommand through the shell, so a bare `ssh` would be a PATH lookup.
// No trusted ssh means ssh transports fail (`false`), never fall back to PATH.
// Windows has no root-owned chain to check: there git and ssh still come from the lead's PATH.
const SSH = process.platform === 'win32' ? 'ssh' : trustedBinary({ paths: SSH_PATHS }) ?? 'false';
const GIT = process.platform === 'win32' ? 'git.exe' : trustedBinary({ paths: GIT_PATHS });
const NO_GIT = `no root-owned git at ${GIT_PATHS.join(', ')}`;
// The passwd entry's home, which a worker-derived $HOME cannot move; none means no global config at all.
const PASSWD_HOME = (() => { try { return userInfo().homedir || null; } catch { return null; } })();

export const SAFE_GIT_CONFIG = Object.freeze([
  'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat', 'diff.external=',
  `core.sshCommand=${SSH}`, 'core.askPass=', 'core.attributesFile=', 'core.editor=true', 'sequence.editor=true',
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
const DRIVER_KEYS = '^(filter\\..+\\.(clean|smudge|process)|merge\\..+\\.driver|credential\\..*helper|url\\..+\\.(insteadof|pushinsteadof)|remote\\..+\\.vcs|lfs\\.standalonetransferagent|lfs\\.customtransfer\\..+|http\\..+|remote\\..+\\.proxy)$';
const REFUSED_KEYS = /^(url\..+\.(insteadof|pushinsteadof)|remote\..+\.vcs|lfs\.standalonetransferagent|lfs\.customtransfer\..+|http\..+|remote\..+\.proxy)$/;
const UNTRUSTED_SCOPES = new Set(['local', 'worktree', 'command', 'unknown']);
const pair = entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)]; };

/** The only GIT_* names a caller's environment passes through: commit identity, nothing that runs or redirects. */
export const GIT_ENV_ALLOWLIST = Object.freeze(['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE']);

/** The environment every host git runs in; `config` is the ordered [key, value] list it pins. */
export function safeGitEnv(base = process.env, config = SAFE_GIT_CONFIG.map(pair)) {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !name.startsWith('GIT_') || GIT_ENV_ALLOWLIST.includes(name)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: PASSWD_HOME ? join(PASSWD_HOME, '.gitconfig') : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_LFS_SKIP_SMUDGE: '1' });
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

/** TM-475: the environment names that point gh at another host, repository, config directory, proxy or CA.
 * GH_HOST is not removed but set: with none, gh's default host is the only one in hosts.yml. */
export const GH_REDIRECT_ENV = Object.freeze(['GH_HOST', 'GH_REPO', 'GH_CONFIG_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
export const safeGhEnv = (base = process.env) => ({ ...Object.fromEntries(Object.entries(base).filter(([name]) => !GH_REDIRECT_ENV.includes(name))), GH_HOST: 'github.com' });
/** TM-475: a refusal when gh's own config (same-uid writable) sends its requests through a unix socket,
 * else null. A key gh cannot read counts as set. (gh has no api_host key; the host is GH_HOST, pinned.) */
export function ghRedirectRefusal(bin, { cwd, env = process.env, spawn = spawnSync } = {}) {
  for (const key of ['http_unix_socket']) {
    const r = spawn(bin, ['config', 'get', key], { cwd, env: safeGhEnv(env), encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error || r.status !== 0) return `gh config get ${key} failed (exit ${r.status}): ${String(r.stderr || r.error?.message || '').trim()}; refusing to trust gh`;
    const value = String(r.stdout).trim();
    if (value) return `gh config sets ${key} to ${value}, so its answers may not come from GitHub; refusing (gh config set ${key} "")`;
  }
  return null;
}
/** Sync gh, spawnSync-shaped: `bin` (a trustedGh() path) with GH_REDIRECT_ENV removed, refused (status 1)
 * when its config redirects it. */
export function safeGhSync(bin, args, { cwd, env = process.env, timeout = 60_000 } = {}) {
  const refusal = ghRedirectRefusal(bin, { cwd, env });
  if (refusal) return { status: 1, stdout: '', stderr: refusal };
  return spawnSync(bin, args, { cwd, env: safeGhEnv(env), encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}
/** Async gh, { code, stdout, stderr }, under the same rules as safeGhSync. Never throws. */
export function safeGh(bin, args, { cwd, env = process.env, timeoutMs = 60_000 } = {}) {
  const refusal = ghRedirectRefusal(bin, { cwd, env });
  if (refusal) return Promise.resolve({ code: 1, stdout: '', stderr: refusal });
  return new Promise(resolve => execFile(bin, args, { cwd, env: safeGhEnv(env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    (error, stdout, stderr) => resolve({ code: error ? (error.killed ? 124 : typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout ?? '', stderr: stderr || (error ? String(error.message) : '') })));
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
const refused = (args, refusal) => `safe-git refused git ${args.join(' ')}: ${refusal}`;

function execAsync(argv, config, options) {
  if (!GIT) return Promise.resolve({ code: 127, stdout: '', stderr: NO_GIT });
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
  if (!GIT) return { status: 127, stdout: '', stderr: NO_GIT, error: undefined };
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
