// Mutation evidence for the unchanged production planner and repaired unit test.
// Mutations happen only in a fresh temporary source copy, never the worktree.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const plugin = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./mutations/', import.meta.url));
const original = await readFile(join(plugin, 'src/provider-sandbox.mjs'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const directories = '    ...providerHome.protectedDirectories.flatMap((directory) => ["--bind", directory.source, directory.destination]),';
const auth = '    ...providerHome.bootstrapMounts.flatMap((mount) => ["--ro-bind", mount.source, mount.destination]),';
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'mutation anchor must occur exactly once');
  return source.replace(before, after);
}
const mutations = {
  'remove-provider-home-root': replaceOnce(original, directories, directories.replace('.flatMap', '.filter((directory) => directory.destination !== "/agent-orchestration-runtime/provider-home").flatMap')),
  'remove-provider-home': replaceOnce(original, directories, directories.replace('.flatMap', '.filter((directory) => directory.destination !== "/agent-orchestration-runtime/provider-home/codex").flatMap')),
  'remove-all-ancestors': replaceOnce(original, directories, ''),
  'remove-auth-mount': replaceOnce(original, auth, ''),
  'make-auth-writable': replaceOnce(original, auth, auth.replace('"--ro-bind"', '"--bind"')),
  'reverse-ancestor-order': replaceOnce(original, directories, directories.replace('.flatMap', '.toReversed().flatMap')),
  'auth-before-ancestors': replaceOnce(original, directories + '\n' + auth, auth + '\n' + directories),
};
const temp = await mkdtemp(join(os.tmpdir(), 'tm111-mutation-'));
const rows = [];
try {
  await cp(join(plugin, 'src'), join(temp, 'src'), { recursive: true });
  await mkdir(join(temp, 'tests/unit'), { recursive: true });
  await cp(join(plugin, 'tests/unit/provider-sandbox.test.mjs'), join(temp, 'tests/unit/provider-sandbox.test.mjs'));
  await mkdir(join(temp, 'empty-home'));
  await mkdir(evidence, { recursive: true });
  const env = { HOME: join(temp, 'empty-home'), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
  const run = async (name, source, expectedExit) => {
    await writeFile(join(temp, 'src/provider-sandbox.mjs'), source);
    const result = spawnSync(process.execPath, ['--test',
      '--test-name-pattern=^write provider sandboxes make only the worktree writable and remount Git metadata read-only$',
      join(temp, 'tests/unit/provider-sandbox.test.mjs')], { env, encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    await writeFile(join(evidence, name + '.txt'), result.stdout + result.stderr);
    assert.equal(result.status, expectedExit, name + ': ' + result.stdout + result.stderr);
    if (expectedExit === 1) assert.match(result.stdout,
      /error: 'every writable auth ancestor must be an unrenameable mountpoint before the exact read-only auth mount'/,
      name + ': must fail the security assertion, not setup or syntax');
    rows.push({ name, exitCode: result.status, sourceSha256: hash(source),
      intendedAssertionRejected: expectedExit === 1 });
  };
  await run('unmutated-before', original, 0);
  for (const [name, source] of Object.entries(mutations)) await run(name, source, 1);
  await run('restored-after', original, 0);
  assert.equal(await readFile(join(plugin, 'src/provider-sandbox.mjs'), 'utf8'), original);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ productionSourceUnchanged: true,
    productionSourceSha256: hash(original), rows }, null, 2) + '\n');
  console.log(JSON.stringify(rows, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
