import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { caseName, classify, validate } from '../scripts/tm111-quarantine.mjs';
const record = JSON.parse(readFileSync(new URL('../quarantines/tm111.json', import.meta.url)));
const source = `test("${caseName}", async () => {});`;
const beforeExpiry = new Date('2026-09-12T23:59:59Z');
const diagnostic = { id: 'kimi', ready: false, sessionProbe: { ok: false,
  error: 'AO_PROVIDER_PROBE_FAILED: ACP agent exited before initialize completed (exit=1, signal=null): bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' } };
const failed = {
  status: 1, signal: null,
  stdout: `TAP version 13\nnot ok 1 - ${caseName}\n  error: |-\n${JSON.stringify(diagnostic, null, 2).split('\n').map(l => '    ' + l).join('\n')}\n    \n    false !== true\n    \n  code: 'ERR_ASSERTION'\n  expected: true\n  actual: false\n  stack: |-\n    TestContext.<anonymous> (file:///fixture/clean-install.test.mjs:126:16)\n1..1\n# tests 1\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n`,
};
test('only the exact known initialization failure is quarantined', () => {
  assert.equal(classify(failed), 'quarantined');
});
test('unexpected errors, later assertions, renamed cases and added failures fail closed', () => {
  for (const [from, to] of [
    ['RTM_NEWADDR: Operation not permitted', 'mount: Permission denied'],
    ['false !== true', 'unexpected diagnostic'], ['126:16', '145:16'], [caseName, 'another assertion'],
    ['# tests 1', '# tests 2'], ['# fail 1', '# fail 2'],
    ['# skipped 0', '# skipped 1'], ['# cancelled 0', '# cancelled 1'],
    ['# todo 0', '# todo 1'], ['"kimi"', '"grok-build"'],
  ]) assert.throws(() => classify({ ...failed, stdout: failed.stdout.replace(from, to) }), `${from} must not be quarantined`);
  assert.throws(() => classify({ ...failed, signal: 'SIGTERM' }));
  assert.throws(() => classify({ ...failed, error: new Error('timeout') }));
  assert.throws(() => classify({ ...failed, stdout: 'malformed TAP' }));
});
test('actual recovery is coverage, not a quarantine or skip', () => {
  assert.equal(classify({ status: 0, stdout: `ok 1 - ${caseName}\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n` }), 'passed');
});
test('expiry, missing owner, missing or duplicated case cannot silently extend the exception', () => {
  validate(record, source, beforeExpiry);
  assert.throws(() => validate(record, source, new Date(record.expiresAt)), /EXPIRED/);
  assert.throws(() => validate(record, source, new Date('2026-09-14')), /EXPIRED/);
  assert.throws(() => validate({ ...record, owner: '' }, source, beforeExpiry));
  assert.throws(() => validate({ ...record, expiresAt: '2027-01-01T00:00:00Z' }, source, beforeExpiry));
  assert.throws(() => validate(record, '', beforeExpiry));
  assert.throws(() => validate(record, source + source, beforeExpiry));
});

test('captured hosted Node assertion diagnostic retains its exact narrow exception', () => {
  const stdout = readFileSync(new URL('./fixtures/tm111-runner-failure.tap', import.meta.url), 'utf8');
  assert.equal(classify({ status: 1, stdout }), 'quarantined');
});
