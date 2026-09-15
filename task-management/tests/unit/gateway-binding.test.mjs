import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureGatewayBinding, gatewayActiveTasks } from '../../lib/gateway-binding.mjs';
const env={TM_SESSION_ID:'harness', BYTEDESK_EMOTE_GATEWAY_TAB_ID:'tab-1', BYTEDESK_EMOTE_GATEWAY_TAB_SESSION:'gateway-1', TMUX:'/tmp/tmux/default,10,0', TMUX_PANE:'%3'};
const output='gateway-1\t/tmp/tmux/default\t10\t$2\t100\t%3\t20\n';
const binding=captureGatewayBinding('harness',{env,run:()=>output});
test('captures exact observed pane, refuses inherited or mismatched identity',()=>{
 assert.equal(binding.tmux.paneId,'3');
 assert.equal(captureGatewayBinding('another',{env,run:()=>output}),null);
 assert.equal(captureGatewayBinding('harness',{env,run:()=>output.replace('gateway-1','other')}),null);
 assert.equal(captureGatewayBinding('harness',{env,run:()=>output.replace('%3','%4')}),null);
 assert.equal(captureGatewayBinding('harness',{env,run:()=>{throw Error('gone')}}),null);
 assert.equal(captureGatewayBinding('harness',{env:{...env,TMUX_PANE:''},run:()=>output}),null);
});
test('active task projection joins state and valid claims; natural order and separate incarnations',()=>{
 const claims={};const tasks=[];
 for(const [id,status] of [['TM-10','in_progress'],['TM-2','in_progress'],['TM-3','done'],['TM-4','blocked'],['TM-5','parked'],['TM-6','open'],['TM-7','in_progress']]){
  claims[id]={session:'harness',gateway:binding,expired:id==='TM-7'};tasks.push({id,status});
 }
 assert.deepEqual(gatewayActiveTasks(claims,tasks,c=>c.expired).bindings[0].activeTaskIds,['TM-2','TM-10']);
 delete claims['TM-2'];
 assert.deepEqual(gatewayActiveTasks(claims,tasks,c=>c.expired).bindings[0].activeTaskIds,['TM-10']);
 claims['TM-10'].session=null;
 assert.deepEqual(gatewayActiveTasks(claims,tasks,c=>c.expired).bindings,[]);
});

import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempStore, cleanup, withSessionEnv } from './helpers.mjs';
import { claimTask, heartbeatClaim } from '../../lib/claims.mjs';
import { create, state, update, writeState, release } from '../../lib/store.mjs';
import { handleWrite } from '../../lib/dashboard-api.mjs';
test('holder claim and heartbeat publish exact binding through the API and lifecycle removes it',()=>{
 const p=tempStore();
 try {
  const exe=join(p.root,'tmux');
  writeFileSync(exe, "#!/bin/sh\nprintf '%s\\n' '" + output.trim() + "'\n");chmodSync(exe,0o700);
  withSessionEnv({...env,PATH:p.root+':'+process.env.PATH},()=>{
   const task=create('task',{title:'bound',status:'in_progress'},'',p);
   assert.equal(claimTask(task.id,{session:'harness',p}).ok,true);
   assert.deepEqual(state(p).claims[task.id].gateway,binding);
   const read=()=>handleWrite('GET','/api/gateway/active-tasks',{}, {p}).body;
   assert.deepEqual(read().bindings[0].activeTaskIds,[task.id]);
   const claims=state(p).claims;delete claims[task.id].gateway;writeState({claims},p);
   heartbeatClaim(task.id,{session:'other',p});assert.equal(state(p).claims[task.id].gateway,undefined);
   heartbeatClaim(task.id,{session:'harness',p});assert.deepEqual(state(p).claims[task.id].gateway,binding);
   for(const status of ['done','blocked','parked','open']){update(task.id,{status},p);assert.deepEqual(read().bindings,[]);}
   update(task.id,{status:'in_progress'},p);release(task.id,p);assert.deepEqual(read().bindings,[]);
  });
 } finally {cleanup(p.root);}
});
