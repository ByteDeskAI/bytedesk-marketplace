import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const workflow = await readFile(new URL('../workflows/agent-orchestration.yml', import.meta.url), 'utf8');
const caseName = 'tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd';

function installedContractScript() {
  const lines = workflow.split('\n');
  const start = lines.indexOf('  installed-cache-contract:');
  assert.ok(start >= 0, 'strict installed-cache job is required');
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z-]+:$/.test(line));
  const job = lines.slice(start, end < 0 ? undefined : end);
  const run = job.indexOf('        run: |');
  assert.ok(run >= 0, 'strict contract must have an executable shell block');
  const block = [];
  for (const line of job.slice(run + 1)) {
    if (line && !line.startsWith('          ')) break;
    block.push(line.slice(10));
  }
  return block.join('\n');
}

function tap({ name = caseName, pass = 1, fail = 0, skipped = 0, tests = 1 } = {}) {
  return `TAP version 13\n${fail ? 'not ok' : 'ok'} 1 - ${name}${skipped ? ' # SKIP unavailable' : ''}\n1..${tests}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n`;
}

test('CI keeps runtime and installed-cache gates strict and runs tmux contracts serially on a private outer server', () => {
  const installedJob = workflow.slice(workflow.indexOf('  installed-cache-contract:'), workflow.indexOf('  test-build-install:'));
  assert.doesNotMatch(installedJob, /^    needs:/m, 'installed-cache verification must run independently of the build job');
  assert.match(workflow, /needs: \[unit-build-contracts, installed-cache-contract\]/);
  assert.match(workflow, /test "\$STRICT_RESULT" = success/);
  assert.match(workflow, /test "\$INSTALLED_CACHE_RESULT" = success/);
  assert.match(workflow, /node --test --test-concurrency=1 "\$\{contracts\[@\]\}"/);
  assert.match(workflow, /export TMUX=''/);
  assert.match(workflow, /TMUX_TMPDIR=\$\(mktemp -d "\$RUNNER_TEMP\/ao-contract-tmux-XXXXXX"\)/);
  assert.doesNotMatch(workflow, /run: node \.github\/scripts\/tm111-quarantine\.mjs/);
  assert.doesNotMatch(workflow, /continue-on-error|--check-expiry|installed-cache-quarantine:/);
});

test('the actual CI shell records coverage only for one exact passing installed-cache test', async t => {
  const script = installedContractScript();
  for (const fixture of [
    { label: 'exact pass', stdout: tap(), exitCode: 0, coverage: true },
    { label: 'runner initialization failure', stdout: tap({ pass: 0, fail: 1 }), exitCode: 1, coverage: false },
    { label: 'skipped contract', stdout: tap({ pass: 0, skipped: 1 }), exitCode: 0, coverage: false },
    { label: 'renamed contract', stdout: tap({ name: 'some source-only test' }), exitCode: 0, coverage: false },
    { label: 'unexpected extra test', stdout: tap({ tests: 2, pass: 2 }), exitCode: 0, coverage: false },
    { label: 'crashed process', stdout: '', exitCode: 137, coverage: false },
  ]) await t.test(fixture.label, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ao-workflow-contract-'));
    try {
      const bin = join(root, 'bin'); await mkdir(bin);
      const capturedTap = join(root, 'fixture.tap'); await writeFile(capturedTap, fixture.stdout);
      const actualNode = `'${process.execPath.replaceAll("'", "'\\''")}'`;
      await writeFile(join(bin, 'node'), `#!/usr/bin/env bash\nif [[ "$1" == '--test' ]]; then\n  [[ "$2" == '--test-reporter=tap' && "$3" == 'tests/contract/clean-install.test.mjs' && "$#" == 3 ]] || exit 98\n  cat "$AO_WORKFLOW_FIXTURE_TAP"\n  printf '%s\\n' 'fixture diagnostic' >&2\n  exit "$AO_WORKFLOW_FIXTURE_EXIT"\nfi\nexec ${actualNode} "$@"\n`);
      await chmod(join(bin, 'node'), 0o755);
      const result = await execute('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: root, timeout: 10_000,
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GITHUB_WORKSPACE: root, GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
          AO_WORKFLOW_FIXTURE_TAP: capturedTap, AO_WORKFLOW_FIXTURE_EXIT: String(fixture.exitCode) },
      }).then(value => ({ code: 0, ...value }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
      assert.equal(result.code, fixture.coverage ? 0 : 1, result.stderr);
      const artifactDir = join(root, 'installed-cache-ci-result');
      const receipt = JSON.parse(await readFile(join(artifactDir, 'result.json'), 'utf8'));
      assert.equal(receipt.coverage, fixture.coverage);
      assert.equal(receipt.exitCode, fixture.exitCode);
      assert.equal(receipt.status, fixture.coverage ? 'passed' : 'failed');
      assert.equal(await readFile(join(artifactDir, 'contract.tap'), 'utf8'), fixture.stdout);
      assert.equal(await readFile(join(artifactDir, 'stderr.log'), 'utf8'), 'fixture diagnostic\n');
      assert.match(await readFile(join(root, 'summary.md'), 'utf8'), new RegExp(`coverage=${fixture.coverage}`));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
