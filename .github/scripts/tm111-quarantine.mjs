import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const caseName = 'tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd';
export const caseFile = 'agent-orchestration/tests/contract/clean-install.test.mjs';

export function validate(record, source, now = new Date()) {
  assert.equal(record.task, 'TM-111');
  assert.equal(record.owner, 'Ryan Helms (@ryanhelms)', 'Quarantine needs its named accountable owner');
  assert.equal(record.file, caseFile);
  assert.equal(record.test, caseName);
  assert.equal(record.expiresAt, '2026-09-13T00:00:00Z', 'Expiry changes require reviewing this exception');
  assert(now < new Date(record.expiresAt), 'TM-111 quarantine EXPIRED: restore hosted coverage or obtain an explicit renewed decision');
  assert(record.reason && record.evidence, 'Quarantine requires reason and evidence');
  assert.equal(source.split(`test("${caseName}",`).length - 1, 1, 'Quarantined case missing, renamed, or duplicated');
}

export function classify(run) {
  const tap = run.stdout || '';
  const line = (key, count) => new RegExp(`^# ${key} ${count}$`, 'm').test(tap);
  assert(!run.error && !run.signal, 'Contract crashed, timed out, or exceeded output bound');
  assert(line('tests', 1) && line('skipped', 0) && line('cancelled', 0) && line('todo', 0), 'Expected exactly one executed contract, zero skips');
  if (run.status === 0 && line('pass', 1) && line('fail', 0)) {
    assert.deepEqual([...tap.matchAll(/^ok \d+ - (.+)$/gm)].map(m => m[1]), [caseName]);
    assert(!/^not ok /m.test(tap));
    return 'passed';
  }
  const failures = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
  assert.equal(run.status, 1);
  assert.deepEqual(failures, [caseName], 'Only the named contract can be quarantined');
  assert(line('pass', 0) && line('fail', 1), 'Unexpected test failures');
  const error = tap.match(/^  error: \|-\n((?:    .*\n)+)/m);
  assert(error, 'Missing structured provider diagnostic');
  const message = error[1].split('\n').map(l => l.slice(4)).join('\n').trim();
  const suffix = '\n\nfalse !== true';
  assert(message.endsWith(suffix), 'Unexpected assertion diagnostic');
  const probe = JSON.parse(message.slice(0, -suffix.length));
  assert.match(tap, /^  code: 'ERR_ASSERTION'$/m);
  assert.match(tap, /^  expected: true$/m);
  assert.match(tap, /^  actual: false$/m);
  assert.equal(probe.id, 'kimi');
  assert.equal(probe.ready, false);
  assert.equal(probe.sessionProbe?.ok, false);
  assert.match(probe.sessionProbe.error, /AO_PROVIDER_PROBE_FAILED: ACP agent exited before initialize completed.*bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted/);
  assert.match(tap, /clean-install\.test\.mjs:126:16\)/, 'Failure moved beyond the known initialization assertion');
  return 'quarantined';
}

function main() {
  const record = JSON.parse(readFileSync(join(root, '.github/quarantines/tm111.json'), 'utf8'));
  validate(record, readFileSync(join(root, record.file), 'utf8'));
  if (process.argv.includes('--check-expiry')) {
    console.log(`TM-111 owner=${record.owner}; expires=${record.expiresAt}; hosted contract coverage remains quarantined`);
    return;
  }
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Quarantine is CI-only; local npm run test:contract stays strict');
  assert.equal(process.env.RUNNER_OS, 'Linux');
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/contract/clean-install.test.mjs'], {
    cwd: join(root, 'agent-orchestration'), encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = join(root, 'tm111-ci-result');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'contract.tap'), run.stdout || '');
  writeFileSync(join(output, 'stderr.log'), run.stderr || '');
  // Persist a failing default before parsing: malformed/unexpected output never appears covered.
  const result = { ...record, status: 'failed', coverage: false, exitCode: run.status };
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  result.status = classify(run);
  result.coverage = result.status === 'passed';
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  const message = result.coverage
    ? `TM-111 contract recovered and passed; ${record.owner} should remove quarantine before ${record.expiresAt}.`
    : `QUARANTINED TM-111, NOT COVERED: ${record.owner}; expires ${record.expiresAt}. ${record.reason}`;
  console.log(`::warning title=TM-111 installed-cache coverage::${message}`);
  console.log(`Contract exit=${run.status}; status=${result.status}; coverage=${result.coverage}; zero skipped tests`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## ${result.coverage ? 'Recovered contract' : 'QUARANTINED — installed-cache contract NOT COVERED'}\n\n${message}\n\nCase: ${caseName}\n\n[Original failure](${record.evidence}). Raw TAP and machine-readable result are attached.\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
