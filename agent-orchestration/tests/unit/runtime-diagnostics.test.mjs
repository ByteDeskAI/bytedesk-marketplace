import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeDiagnostics} from '../../src/diagnostics.mjs';
import {run,writeJson} from '../../topology/lib/util.mjs';
import {canonicalRepoId,repoKey} from '../../topology/lib/repoid.mjs';

test('diagnostics separate admission, loaded build, missing services and mismatched roots without leaking host credentials',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ao-diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),pluginRoot=join(root,'plugin'),stateRoot=join(root,'state');
  await run('git',['init','-q',consumer]);
  await run('git',['-C',consumer,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','base']);await mkdir(pluginRoot);
  await writeJson(join(pluginRoot,'package.json'),{version:'test'});
  await writeJson(join(stateRoot,'sessions','host.json'),{pid:-1,port:1,nonce:'do-not-expose'});
  const env={...process.env,AGENT_ORCHESTRATION_STATE_HOME:join(root,'different')};
  const report=await runtimeDiagnostics({consumerCwd:consumer,pluginRoot,stateRoot,env});
  assert.equal(report.consumerAdmission.admitted,true);
  assert.equal(report.loadedBuild.mode,'source');assert.equal(report.loadedBuild.diskVersion,'test');
  assert.equal(report.stateRoots.aligned,false);assert.equal(report.sessionHost.healthy,false);
  assert.equal(report.roles.length,2);assert.ok(report.roles.every(role=>!role.ready));
  assert.equal(JSON.stringify(report).includes('do-not-expose'),false);
  const denied=await runtimeDiagnostics({consumerCwd:pluginRoot,pluginRoot,stateRoot,env});
  assert.equal(denied.consumerAdmission.admitted,false);assert.equal(denied.roles.length,0);
});

test('diagnostics require fresh census evidence for the exact registered role incarnation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ao-diagnostics-role-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),pluginRoot=join(root,'plugin'),stateRoot=join(root,'state');
  await run('git',['init','-q',consumer]);
  await run('git',['-C',consumer,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','base']);await mkdir(pluginRoot);
  const env={...process.env,AGENT_ORCHESTRATION_STATE_HOME:stateRoot};
  const key=repoKey((await canonicalRepoId(consumer)).id);
  const binding={serverKey:'/test/socket',serverPid:1,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:2};
  await writeJson(join(stateRoot,'leads',`${key}.json`),{agent_id:'lead',provider:'claude',binding});
  const census={at:new Date().toISOString(),staleAfterMs:1000,agents:[{agentId:'lead',session:binding,state:'idle',dispatchable:true}]};
  await writeJson(join(stateRoot,'census',`${key}.json`),census);
  const args={consumerCwd:consumer,pluginRoot,stateRoot,env};
  assert.equal((await runtimeDiagnostics(args)).roles[0].ready,true);
  census.agents[0].session={...binding,panePid:3};await writeJson(join(stateRoot,'census',`${key}.json`),census);
  assert.equal((await runtimeDiagnostics(args)).roles[0].ready,false);
  census.agents[0].session=binding;census.at=new Date(0).toISOString();await writeJson(join(stateRoot,'census',`${key}.json`),census);
  assert.equal((await runtimeDiagnostics(args)).roles[0].ready,false);
});
