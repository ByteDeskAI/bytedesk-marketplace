// PR #226 review: the server side of `gh` for tests. A real repository stands in for the pinned GitHub
// repository o/r (default branch main): compare answers the way GitHub answers
// `repos/o/r/compare/<base>...<branch>` (ahead / identical / diverged), from that repository's refs only,
// so a ref the worker forges in the task's checkout never reaches it.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const COMPARE = /^repos\/o\/r\/compare\/([0-9a-f]+)\.\.\.(.+)$/;

export function serverCompare(serverRepo, base, branch, tip = null) {
  let target;
  try { target = tip || execFileSync('git', ['-C', serverRepo, 'rev-parse', `refs/heads/${decodeURIComponent(branch)}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'not-found'; }
  if (base === target) return 'identical';
  try { execFileSync('git', ['-C', serverRepo, 'merge-base', '--is-ancestor', base, target], { stdio: 'ignore' }); return 'ahead'; }
  catch { return 'diverged'; }
}

const ok = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
/** An in-process gh for agent-orchestration: repo view and compare; anything else goes to `fallback`. */
export const fakeGh = (serverRepo, { tip = () => null, fallback = null } = {}) => async args => {
  if (args[0] === 'repo' && args[1] === 'view') return ok({ nameWithOwner: 'o/r', defaultBranchRef: { name: 'main' } });
  const m = args[0] === 'api' && COMPARE.exec(args[1]);
  if (m) return ok({ status: serverCompare(serverRepo, m[1], m[2], tip()) });
  return fallback ? fallback(args) : { code: 1, stdout: '', stderr: `fake server: ${args.join(' ')}` };
};

/** A `gh` executable (for task-management, which spawns gh) answering the same two calls from serverRepo. */
export async function ghShim(dir, serverRepo) {
  const path = join(dir, 'gh');
  await writeFile(path, `#!/bin/sh
# TM-475: safe-git asks gh config get http_unix_socket / api_host first; this gh sets neither.
if [ "$1" = config ]; then exit 0; fi
if [ "$1" = repo ]; then echo '{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"}}'; exit 0; fi
spec="\${2#repos/o/r/compare/}"; base="\${spec%%...*}"; branch="\${spec#*...}"
tip=$(git -C '${serverRepo}' rev-parse "refs/heads/$branch" 2>/dev/null) || { echo '{"message":"Not Found"}'; exit 1; }
if [ "$base" = "$tip" ]; then echo '{"status":"identical"}'
elif git -C '${serverRepo}' merge-base --is-ancestor "$base" "$tip" 2>/dev/null; then echo '{"status":"ahead"}'
else echo '{"status":"diverged"}'; fi
`, { mode: 0o755 });
  return dir;
}

/** TM-472: a local bare origin stands in for GitHub, so the fixture's operator pins it as the fetch URL
 * (`<state>/repositories/<key>.origin.json`); without that, a repository pinned to o/r refuses it. */
export async function pinOrigin(consumer, { env, home }, url) {
  const { canonicalRepoId, repoKey, stateRoot } = await import('../../topology/lib/repoid.mjs');
  const { writeJson } = await import('../../topology/lib/util.mjs');
  const { id } = await canonicalRepoId(consumer);
  await writeJson(join(stateRoot(env, home), 'repositories', `${repoKey(id)}.origin.json`), { repo_id: id, url });
}
