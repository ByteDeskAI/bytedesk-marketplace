import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  for (const job of ['unit-build-contracts', 'installed-cache-contract']) {
    const body = workflow.split(`  ${job}:\n`)[1].split(/^  [a-z][a-z-]+:$/m)[0];
    assert.match(body, /runs-on: ubuntu-24\.04/);
    assert.match(body, /run: bash \.github\/scripts\/ao-sandbox-prerequisites\.sh/);
    assert.match(body, /path: \$\{\{ runner\.temp \}\}\/ao-sandbox-prerequisites\//);
  }
  assert.equal(workflow.split('      - ".github/scripts/ao-sandbox-prerequisites.sh"').length - 1, 2, 'helper changes must trigger both push and pull-request validation');
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

test('CI prerequisite helper requires an enforced child profile without changing AppArmor settings', async t => {
  // All privileged and Bubblewrap commands are shell-function fixtures. The
  // real helper runs, but this test never installs packages or loads profiles.
  const fixtureShell = `
source "$AO_PREREQUISITE_SCRIPT"
lsb_release() { if [[ "$1" == -is ]]; then echo "\${AO_FIXTURE_DISTRO:-Ubuntu}"; else echo 24.04; fi; }
uname() { echo 'Linux fixture-kernel'; }
cat() {
  if [[ "$1" == /sys/module/apparmor/parameters/enabled ]]; then echo Y; else command cat "$@"; fi
}
sysctl() {
  printf '%s\n' "sysctl $*" >> "$RUNNER_TEMP/calls.log"
  [[ "$1" == -n ]] || return 90
  case "$2" in kernel.apparmor_restrict_unprivileged_userns|kernel.apparmor_restrict_unprivileged_unconfined) ;;
    *) return 91;; esac
  if [[ "\${AO_FIXTURE_SYSCTL_CHANGED:-0}" == 1 && -f "$RUNNER_TEMP/profile-loaded" ]]; then echo 0; else echo 1; fi
}
dpkg-query() { echo 'apparmor-profiles fixture-version'; }
sha256sum() {
  [[ "$1" == /usr/share/apparmor/extra-profiles/bwrap-userns-restrict ]] || return 92
  echo 'fixture-hash official-profile'
}
sudo() {
  printf '%s\n' "sudo $*" >> "$RUNNER_TEMP/calls.log"
  case "$*" in
    'apt-get update'|'apt-get install --yes bubblewrap slirp4netns apparmor-profiles') ;;
    'cat /sys/kernel/security/apparmor/profiles')
      if [[ -f "$RUNNER_TEMP/profile-loaded" ]]; then printf '%s\n' 'bwrap (enforce)' 'unpriv_bwrap (enforce)'; fi ;;
    'apparmor_parser -r /usr/share/apparmor/extra-profiles/bwrap-userns-restrict')
      [[ "\${AO_FIXTURE_PARSER_FAILURE:-0}" == 0 ]] || return 93
      touch "$RUNNER_TEMP/profile-loaded" ;;
    'journalctl -k --no-pager --since 5 minutes ago --grep apparmor=.*DENIED.*comm="bwrap"')
      echo 'apparmor="DENIED" comm="bwrap" capname="net_admin"' ;;
    *) echo "Unexpected privileged command: $*" >&2; return 94 ;;
  esac
}
function /usr/bin/bwrap() {
  printf '%s\n' "bwrap $*" >> "$RUNNER_TEMP/calls.log"
  if [[ "$1" == --version ]]; then echo 'bubblewrap fixture-version'; return; fi
  [[ "$*" == *--unshare-all* && "$*" != *--share-net* ]] || return 95
  if [[ "$*" == *'/bin/true' ]]; then echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2; return 1; fi
  [[ "$*" == *'--clearenv --setenv PATH /usr/bin:/bin'* ]] || return 96
  [[ "\${AO_FIXTURE_SMOKE_FAILURE:-0}" == 0 ]] || return 97
  printf '%s\n' "$AO_FIXTURE_SMOKE"
}
ao_sandbox_prerequisites
`;
  const passingSmoke = 'child_profile=bwrap//&unpriv_bwrap (enforce)\nCapEff=0000000000000000';
  for (const fixture of [
    { label: 'official restricted profile and zero capabilities', pass: true },
    { label: 'operator host is refused before privileged commands', env: { GITHUB_ACTIONS: 'false' }, guard: true },
    { label: 'self-hosted runner is refused before privileged commands', env: { RUNNER_ENVIRONMENT: 'self-hosted' }, guard: true },
    { label: 'different distribution is refused before privileged commands', env: { AO_FIXTURE_DISTRO: 'LinuxMint' }, guard: true },
    { label: 'profile loading failure stays failed', env: { AO_FIXTURE_PARSER_FAILURE: '1' } },
    { label: 'smoke execution failure stays failed', env: { AO_FIXTURE_SMOKE_FAILURE: '1' } },
    { label: 'unconfined child is rejected', env: { AO_FIXTURE_SMOKE: 'child_profile=unconfined\nCapEff=0000000000000000' } },
    { label: 'effective capabilities are rejected', env: { AO_FIXTURE_SMOKE: 'child_profile=bwrap//&unpriv_bwrap (enforce)\nCapEff=0000000000001000' } },
    { label: 'changed AppArmor settings are rejected', env: { AO_FIXTURE_SYSCTL_CHANGED: '1' } },
  ]) await t.test(fixture.label, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ao-ci-prerequisites-'));
    try {
      const result = await execute('bash', ['--noprofile', '--norc', '-c', fixtureShell], {
        cwd: root, timeout: 10_000,
        env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', ImageOS: 'ubuntu24', RUNNER_TEMP: root,
          AO_PREREQUISITE_SCRIPT: fileURLToPath(new URL('../scripts/ao-sandbox-prerequisites.sh', import.meta.url)),
          AO_FIXTURE_DISTRO: 'Ubuntu', AO_FIXTURE_SYSCTL_CHANGED: '0', AO_FIXTURE_PARSER_FAILURE: '0', AO_FIXTURE_SMOKE_FAILURE: '0',
          AO_FIXTURE_SMOKE: passingSmoke, ...fixture.env },
      }).then(value => ({ code: 0, ...value }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
      assert.equal(result.code === 0, Boolean(fixture.pass), `${result.stdout}\n${result.stderr}`);
      const calls = await readFile(join(root, 'calls.log'), 'utf8').catch(() => '');
      if (fixture.guard) assert.equal(calls, '', 'host guard must precede every privileged or sandbox operation');
      else {
        assert.match(calls, /sudo apparmor_parser -r \/usr\/share\/apparmor\/extra-profiles\/bwrap-userns-restrict/);
        assert.doesNotMatch(calls, /sysctl -w|systemctl.*apparmor|--share-net/);
        assert.match(await readFile(join(root, 'ao-sandbox-prerequisites/diagnostics.log'), 'utf8'), /Before: restrict_unprivileged_userns=1 restrict_unprivileged_unconfined=1/);
      }
      if (fixture.pass) {
        assert.equal(await readFile(join(root, 'ao-sandbox-prerequisites/bwrap-after.log'), 'utf8'), `${passingSmoke}\n`);
        assert.match(result.stdout, /Sandbox prerequisites passed/);
      } else assert.doesNotMatch(result.stdout, /Sandbox prerequisites passed/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
