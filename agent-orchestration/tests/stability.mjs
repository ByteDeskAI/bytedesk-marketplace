#!/usr/bin/env node
// Run the suite N times and report whether it agrees with itself.
//
// TM-165. A single green run is one sample, and this suite does not always answer the same way
// twice: it drives real tmux, and tmux is shared mutable state owned by the machine, not by us.
// A bare "# fail 0" therefore says "it passed this time", which is a weaker claim than anyone
// reading it assumes. This harness makes the weaker claim visible by taking more than one sample.
//
// It also refuses to describe a dirty tree as a measurement of a commit. That is not pedantry:
// the failure that started TM-165 was another session's uncommitted feature, measured in the
// shared checkout and reported as a defect in main. The tree state is part of the result.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const runs = Number(arg('runs', 5));
const pattern = arg('pattern', 'tests/unit/*.test.mjs');

const git = async (...a) => (await exec('git', a, { cwd: root }).catch(() => ({ stdout: '' }))).stdout.trim();
const commit = await git('rev-parse', '--short', 'HEAD');
const dirty = (await git('status', '--porcelain', '--', '.')).split('\n').filter(Boolean);

if (dirty.length) {
  console.log(`!! TREE DIRTY — ${dirty.length} uncommitted path(s). This measures your working tree, NOT ${commit}.`);
  for (const line of dirty.slice(0, 12)) console.log(`     ${line}`);
  if (dirty.length > 12) console.log(`     … and ${dirty.length - 12} more`);
  console.log('   A failure here may belong to unfinished work — yours or another session\'s.\n');
} else {
  console.log(`tree clean at ${commit}\n`);
}

// One `# fail` count and the set of failing test-file names per run.
const results = [];
for (let i = 1; i <= runs; i++) {
  // Never let a nonzero exit (a failing suite is the normal case here) throw away the output.
  const { stdout } = await exec(process.execPath,
    ['--test', '--test-concurrency=1', ...pattern.split(' ')],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 }).catch(e => e);
  const out = stdout ?? '';
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
  results.push({ run: i, count: Number(/^# fail (\d+)/m.exec(out)?.[1] ?? failed.length), failed });
  console.log(`run ${i}: ${results.at(-1).count} fail  ${failed.join(', ') || '—'}`);
}

// A test that fails every run is broken. A test that fails some runs is unstable, and it is the
// second kind that makes a green run meaningless — so they are reported as different things.
const seen = new Map();
for (const r of results) for (const f of new Set(r.failed)) seen.set(f, (seen.get(f) ?? 0) + 1);
const always = [...seen].filter(([, n]) => n === runs).map(([f]) => f);
const sometimes = [...seen].filter(([, n]) => n < runs).map(([f, n]) => `${f} (${n}/${runs})`);

console.log(`\n${runs} runs · fail counts ${results.map(r => r.count).join(', ')}`);
if (always.length) console.log(`consistently failing (${always.length}):\n  ${always.join('\n  ')}`);
if (sometimes.length) console.log(`UNSTABLE — passed some runs, failed others (${sometimes.length}):\n  ${sometimes.join('\n  ')}`);
if (!seen.size) console.log('stable: every run agreed, and every run passed.');

// Exit 2 for instability specifically. A caller that only checks "did it pass" would otherwise
// read a run that happened to be green as a clean bill of health.
process.exit(sometimes.length ? 2 : always.length ? 1 : 0);
