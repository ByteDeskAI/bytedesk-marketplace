// Diagnostic evidence only. Does not edit production code or the failing test.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const evidence = fileURLToPath(new URL('./', import.meta.url));
const plugin = fileURLToPath(new URL('../../../', import.meta.url));
if (process.argv[2] === '--plan') {
  const { sandboxArguments } = await import(process.argv.includes('--bundle')
    ? new URL('file://' + process.env.HOME + '/provider-sandbox.cjs').href
    : '../../../src/provider-sandbox.mjs');
  const home = os.homedir();
  const root = join(home, 'case');
  const workspace = join(root, 'workspace'), git = join(root, 'consumer.git');
  const scratch = join(root, 'scratch'), control = join(root, 'control');
  for (const dir of [workspace, git, scratch, control]) await mkdir(dir, { recursive: true });
  await writeFile(join(workspace, '.git'), `gitdir: ${git}/worktrees/fixture\n`);
  const args = await sandboxArguments({ providerId: 'codex', pluginRoot: '/plugin',
    workspacePath: workspace, commonGitDir: git, sandboxTempDir: scratch,
    brokerControlDir: control, providerExecutable: '/usr/bin/true', permissionProfile: 'write' });
  const runtime = '/agent-orchestration-runtime', homes = runtime + '/provider-home';
  const provider = homes + '/codex', auth = provider + '/auth.json';
  const index = (flag, destination) => args.findIndex((a, i) => a === flag && args[i + 2] === destination);
  const indices = { workspace: index('--bind', workspace), scratch: index('--bind', runtime),
    providerHomeRoot: index('--bind', homes), providerHome: index('--bind', provider),
    authReadOnly: index('--ro-bind', auth), gitMarker: index('--ro-bind', workspace + '/.git'),
    commonGit: index('--ro-bind', git) };
  let kernel = null;
  if (process.argv.includes('--kernel')) {
    const probe = `const fs=require('node:fs'); const results=[];
      for(const [name,source,dest] of ${JSON.stringify([['rename-home-root',homes,runtime+'/renamed'],['rename-provider-home',provider,homes+'/renamed'],['rename-auth',auth,provider+'/renamed']])}){
        try{fs.renameSync(source,dest);results.push({name,blocked:false});}catch(e){results.push({name,blocked:e.code==='EBUSY',code:e.code});}
      }
      for(const [name,path] of ${JSON.stringify([['write-auth',auth],['write-git-marker',workspace+'/.git'],['write-common-git',git+'/escape']])}){
        try{fs.writeFileSync(path,'TM111_MUTATION');results.push({name,blocked:false});}catch(e){results.push({name,blocked:e.code==='EROFS',code:e.code});}
      }
      for(const [name,path] of ${JSON.stringify([['write-workspace',workspace+'/allowed'],['write-scratch',runtime+'/allowed']])}){
        try{fs.writeFileSync(path,'TM111_FIXTURE');results.push({name,allowed:true});}catch(e){results.push({name,allowed:false,code:e.code});}
      }
      console.log(JSON.stringify(results));process.exit(results.every(r=>r.blocked===true||r.allowed===true)?0:1);`;
    const command = [...args.slice(0, args.lastIndexOf('--') + 1), process.execPath, '-e', probe];
    const result = spawnSync('/usr/bin/bwrap', command, { encoding: 'utf8', timeout: 10000 });
    kernel = { exitCode: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  }
  console.log(JSON.stringify({ indices, authPresent: indices.authReadOnly >= 0, kernel }));
} else {
  const results = [];
  for (const mode of ['empty-home', 'fixture-auth-home']) {
    const home = await mkdtemp(join(os.tmpdir(), 'tm111-diagnostic-'));
    try {
      if (mode === 'fixture-auth-home') {
        await mkdir(join(home, '.codex'));
        await writeFile(join(home, '.codex/auth.json'), '{"TM111_FIXTURE_ONLY":true}\n');
      }
      // Use the resolved executable, never a HOME-dependent launcher shim.
      const env = { HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
      const run = spawnSync(process.execPath, ['--test',
        '--test-name-pattern=^write provider sandboxes make only the worktree writable and remount Git metadata read-only$',
        join(plugin, 'tests/unit/provider-sandbox.test.mjs')], { env, encoding: 'utf8', timeout: 30000 });
      if (run.error) throw run.error;
      assert.equal(run.status, mode === 'empty-home' ? 1 : 0, run.stdout + run.stderr);
      await writeFile(join(evidence, mode + '.txt'), run.stdout + run.stderr);
      const plans = {};
      await writeFile(join(home, 'provider-sandbox.cjs'), await readFile(join(plugin, 'dist/provider-sandbox.cjs')));
      for (const implementation of ['source', 'committed-bundle-copy']) {
        const plan = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--plan',
          ...(implementation === 'committed-bundle-copy' ? ['--bundle'] : []),
          ...(mode === 'fixture-auth-home' ? ['--kernel'] : [])], { env, encoding: 'utf8', timeout: 15000 });
        if (plan.error || plan.status !== 0) throw plan.error || Error(plan.stderr);
        plans[implementation] = JSON.parse(plan.stdout);
        const observed = plans[implementation], i = observed.indices;
        assert.ok(i.workspace > 0 && i.scratch > i.workspace && i.providerHomeRoot > i.scratch && i.providerHome > i.providerHomeRoot);
        if (mode === 'empty-home') assert.equal(i.authReadOnly, -1);
        else {
          assert.ok(i.authReadOnly > i.providerHome && i.gitMarker > i.authReadOnly && i.commonGit > i.gitMarker);
          assert.equal(observed.kernel.exitCode, 0, observed.kernel.stderr + observed.kernel.stdout);
          assert.equal(JSON.parse(observed.kernel.stdout).length, 8);
        }
        await rm(join(home, 'case'), { recursive: true, force: true });
      }
      results.push({ mode, originalTestExitCode: run.status, plans });
    } finally { await rm(home, { recursive: true, force: true }); }
  }
  await writeFile(join(evidence, 'diagnosis.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
