import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sourceFingerprint } from '../../scripts/source-fingerprint.mjs';

test('source fingerprint survives local verification caches but changes with source', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-source-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, value) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, value);
  };
  for (const path of ['src/service.mjs', 'topology/lib/launch.mjs', 'providers/claude.json', 'package.json', 'package-lock.json', 'config.defaults.json', 'scripts/build.mjs', 'scripts/source-fingerprint.mjs']) await write(path, path);
  const clean = await sourceFingerprint(root);
  for (const path of ['topology/fixtures/presence-v1/__pycache__/validate_presence.cpython-314.pyc', 'topology/fixtures/validate_presence.pyc', 'src/.cache/build.json', 'src/node_modules/dependency/index.js']) await write(path, 'generated local data');
  assert.equal(await sourceFingerprint(root), clean, 'test-generated caches cannot change shipped bundle bytes');
  await write('topology/lib/launch.mjs', 'changed runtime source');
  assert.notEqual(await sourceFingerprint(root), clean, 'the fingerprint must still detect a runtime change');
});
