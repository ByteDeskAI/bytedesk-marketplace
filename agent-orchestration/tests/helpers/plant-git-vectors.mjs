// TM-443: plant every config-driven execution vector a worker could write into a repository's
// SHARED .git/config, each pointing at one script that appends to a marker file. A host-side git that
// honours any of them leaves a line in the marker; `fired()` returns those lines.
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function plantGitVectors(repo, dir) {
  const marker = join(dir, 'PLANTED-RAN'), script = join(dir, 'planted.sh'), hooks = join(dir, 'planted-hooks');
  await writeFile(script, `#!/bin/sh\necho "planted $0 $*" >> '${marker}'\ncat\n`); await chmod(script, 0o755);
  await mkdir(hooks, { recursive: true });
  for (const hook of ['pre-commit', 'post-merge', 'post-checkout', 'reference-transaction', 'pre-auto-gc', 'post-rewrite']) {
    await writeFile(join(hooks, hook), `#!/bin/sh\necho "hook ${hook}" >> '${marker}'\n`); await chmod(join(hooks, hook), 0o755);
  }
  const set = (key, value) => execFileSync('git', ['-C', repo, 'config', key, value]);
  set('core.fsmonitor', script); set('core.hooksPath', hooks); set('diff.external', script); set('core.pager', script);
  set('core.askPass', script); set('core.sshCommand', script);
  set('filter.planted.clean', script); set('filter.planted.smudge', script); set('filter.planted.required', 'true');
  set('merge.planted.driver', `${script} %O %A %B`); set('diff.planted.textconv', script); set('diff.planted.command', script);
  set('credential.helper', `!${script}`);
  if (execFileSync('git', ['-C', repo, 'remote'], { encoding: 'utf8' }).split('\n').includes('origin')) set('remote.origin.uploadpack', `${script}; git-upload-pack`);
  const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  await mkdir(join(common, 'info'), { recursive: true });
  await writeFile(join(common, 'info', 'attributes'), '* filter=planted merge=planted diff=planted\n');
  return { marker, script, fired: async () => (await readFile(marker, 'utf8').catch(() => '')).split('\n').filter(Boolean) };
}
