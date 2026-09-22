import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeDiagnostics} from '../../src/diagnostics.mjs';
import {run,readJson,writeJson} from '../../topology/lib/util.mjs';
import {canonicalRepoId,repoKey} from '../../topology/lib/repoid.mjs';
import {listServerPanes} from '../../topology/lib/tmux.mjs';
import {acknowledgePrompt,refreshPrompt} from '../../topology/lib/prompt-lifecycle.mjs';
import {leadNonceAck,leadRegistryDir,responsiveForTest} from '../../topology/lib/lead.mjs';
import {reviewerInboxRoot,reviewerNonceAck,reviewerProbeReady} from '../../topology/lib/reviewer.mjs';

async function fileEvidence(root) {
  const entries=[];
  async function visit(dir) {
    for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=join(dir,entry.name);
      if(entry.isDirectory()) await visit(path);
      else if(entry.isFile()) {
        const info=await stat(path);
        entries.push({path,sha:createHash('sha256').update(await readFile(path)).digest('hex'),mtime:info.mtimeMs,ctime:info.ctimeMs});
      }
    }
  }
  await visit(root);return entries;
}

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

test('fresh idle census evidence alone never labels a role ready',async t=>{
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
  const idle=(await runtimeDiagnostics(args)).roles[0];
  assert.equal(idle.state,'idle');assert.equal(idle.ready,false);
  census.agents[0].session={...binding,panePid:3};await writeJson(join(stateRoot,'census',`${key}.json`),census);
  assert.equal((await runtimeDiagnostics(args)).roles[0].ready,false);
  census.agents[0].session=binding;census.at=new Date(0).toISOString();await writeJson(join(stateRoot,'census',`${key}.json`),census);
  assert.equal((await runtimeDiagnostics(args)).roles[0].ready,false);
});

async function roleFixture(t) {
  if((await run('tmux',['-V'],{allowFailure:true})).code!==0){t.skip('tmux unavailable');return null;}
  const root=await mkdtemp(join(tmpdir(),'ao-diagnostics-proof-'));
  const consumer=join(root,'repo'),pluginRoot=join(root,'plugin'),stateRoot=join(root,'state'),home=join(root,'home'),tmuxDir=join(root,'tmux');
  await mkdir(tmuxDir,{recursive:true});
  const socket=join(tmuxDir,'roles.sock');
  const env={...process.env,TMUX:'',TMUX_PANE:'',TMUX_TMPDIR:tmuxDir,HOME:home,XDG_CONFIG_HOME:join(home,'.config'),AGENT_ORCHESTRATION_STATE_HOME:stateRoot};
  t.after(async()=>{
    assert.ok(env.TMUX==='' && socket.startsWith(`${tmuxDir}/`));
    await run('tmux',['-S',socket,'kill-server'],{env,allowFailure:true});
    await rm(root,{recursive:true,force:true});
  });
  await run('git',['init','-q',consumer]);
  await run('git',['-C',consumer,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','base']);
  await writeJson(join(pluginRoot,'config.defaults.json'),{prompts:{common:'common.md'}});
  await writeFile(join(pluginRoot,'common.md'),'Follow the approved role protocol.\n');
  const identity=await canonicalRepoId(consumer),key=repoKey(identity.id),roles=[];
  const options={consumer,pluginRoot,home,env};
  for(const [role,id] of [['lead','a0000001'],['reviewer','b0000001']]) {
    const session=`diagnostic-${role}`;
    await run('tmux',['-S',socket,'new-session','-d','-s',session,'-c',consumer,'sleep','120'],{env});
    const binding=(await listServerPanes({tmuxServer:socket,session,env}))[0];
    const dir=join(consumer,'.bytedesk','agent-orchestration','agents',id);
    const definition={version:1,id,role,cli:'claude',full_name:`Diagnostic ${role}`,title:role};
    await writeJson(join(dir,'agent.json'),definition);
    const agent={...definition,_dir:dir,_file:join(dir,'agent.json')};
    const record={version:1,repo_id:identity.id,consumer,agent_id:id,provider:'claude',session,pane:binding.paneId,binding};
    const recordPath=join(stateRoot,`${role}s`,`${key}.json`);
    await writeJson(recordPath,record);
    await refreshPrompt({...options,agent,session,binding});
    const probeDir=role==='lead'?join(leadRegistryDir(env,home),'probes'):join(await reviewerInboxRoot(consumer,env,home),'probes');
    roles.push({role,agent,record,recordPath,promptPath:join(dir,'prompt-state.json'),memoPath:join(probeDir,`${id}.answered.json`)});
  }
  const censusPath=join(stateRoot,'census',`${key}.json`);
  const census={at:new Date().toISOString(),staleAfterMs:45000,agents:roles.map(({record})=>({agentId:record.agent_id,session:record.binding,state:'idle',dispatchable:true}))};
  await writeJson(censusPath,census);
  const diagnose=async()=>{
    const before=await fileEvidence(root);
    const report=await runtimeDiagnostics({consumerCwd:consumer,pluginRoot,stateRoot,env,home});
    assert.deepEqual(await fileEvidence(root),before,'diagnostics cannot write, mint or consume role state');
    return report;
  };
  const acknowledgePrompts=async()=>{
    for(const {agent,record,promptPath} of roles) {
      const prompt=await readJson(promptPath);
      await acknowledgePrompt({...options,agent,revision:prompt.desired_revision,nonce:prompt.nonce,binding:record.binding,session:record.session,
        env:{...env,AO_AGENT_ID:agent.id,AO_CONSUMER:consumer,AO_SESSION:record.session}});
    }
  };
  const acknowledgeReadiness=async()=>{
    for(const {role,record} of roles) {
      const ackEnv={...env,AO_AGENT_ID:record.agent_id};
      const ready=role==='lead'
        ? await responsiveForTest(record,500,{registryDir:leadRegistryDir(env,home),wake:async(_record,nonce)=>leadNonceAck({...options,nonce,env:ackEnv})})
        : await reviewerProbeReady({...options,record,timeoutMs:500,wake:async()=>{},output:async()=>'',onProbe:async probe=>reviewerNonceAck({...options,nonce:probe.nonce,env:ackEnv})});
      assert.equal(ready,true,'fixture must establish proof through the producer acknowledgement protocol');
    }
  };
  return {root,pluginRoot,roles,census,censusPath,diagnose,acknowledgePrompts,acknowledgeReadiness};
}

test('idle live roles require both prompt and nonce acknowledgement, and diagnostics stay read-only',async t=>{
  const f=await roleFixture(t);if(!f)return;
  let report=await f.diagnose();
  assert.ok(report.roles.every(role=>role.censusFresh && role.state==='idle' && !role.ready && !role.responsive && role.prompt.state==='awaiting-ack'));
  await f.acknowledgePrompts();report=await f.diagnose();
  assert.ok(report.roles.every(role=>role.prompt.current && !role.ready && !role.responsive));
  await f.acknowledgeReadiness();report=await f.diagnose();
  assert.ok(report.roles.every(role=>role.ready && role.responsive && role.prompt.current && role.readinessReasons.length===0));
});

test('role diagnostics reject expired proof, successor bindings and changed composed prompts',async t=>{
  const f=await roleFixture(t);if(!f)return;
  await f.acknowledgePrompts();await f.acknowledgeReadiness();
  for(const entry of f.roles) {
    const index=f.roles.indexOf(entry),memo=await readJson(entry.memoPath),prompt=await readJson(entry.promptPath);
    await writeJson(entry.memoPath,{...memo,at:Date.now()-3600000});
    assert.equal((await f.diagnose()).roles[index].ready,false,'expired nonce proof cannot establish readiness');
    await writeJson(entry.memoPath,memo);
    await writeJson(entry.promptPath,{...prompt,applied_binding:{...prompt.applied_binding,panePid:prompt.applied_binding.panePid+1}});
    let observed=(await f.diagnose()).roles[index];
    assert.equal(observed.responsive,true);assert.equal(observed.ready,false);assert.equal(observed.prompt.state,'stale');
    await writeJson(entry.promptPath,prompt);
    const successor={...entry.record.binding,panePid:entry.record.binding.panePid+1};
    await writeJson(entry.recordPath,{...entry.record,binding:successor});
    f.census.agents[index].session=successor;await writeJson(f.censusPath,f.census);
    observed=(await f.diagnose()).roles[index];
    assert.equal(observed.state,'idle');assert.equal(observed.responsive,false);assert.equal(observed.ready,false);
    await writeJson(entry.recordPath,entry.record);
    f.census.agents[index].session=entry.record.binding;await writeJson(f.censusPath,f.census);
  }
  await writeFile(join(f.pluginRoot,'common.md'),'An updated role protocol requires a new acknowledgement.\n');
  const report=await f.diagnose();
  assert.ok(report.roles.every(role=>role.responsive && !role.ready && role.prompt.state==='stale' && role.prompt.desiredRevision!==role.prompt.appliedRevision));
});
