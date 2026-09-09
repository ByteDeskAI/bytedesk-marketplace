// Explicit completion for watcher-discovered sessions. Enrollment attaches
// metadata to an existing exact tmux incarnation; it never moves, types into,
// restarts, kills, or changes the privileges of a session.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { agentDirs, agentsRoot, requireAgent } from './agents.mjs';
import { withLock } from './lockfile.mjs';
import { refreshPrompt } from './prompt-lifecycle.mjs';
import { canonicalRepoId, stateRoot } from './repoid.mjs';
import { listServerPanes } from './tmux.mjs';
import { invariant, nowIso } from './util.mjs';

const SIX = ['serverKey', 'serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'];
const exact = (a,b) => a && b && SIX.every(k => a[k] === b[k]);
function validBinding(b) {
  return b && ['serverKey','sessionId','paneId'].every(k=>typeof b[k]==='string' && b[k]) &&
    ['serverPid','sessionCreated','panePid'].every(k=>Number.isSafeInteger(b[k]) && b[k]>0);
}
async function read(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(error) { if(error.code==='ENOENT')return null;throw error; }
}
async function atomic(path,value) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=`${path}.${randomUUID()}.tmp`;
  try {
    const f=await open(temp,'wx',0o600);
    try {await f.writeFile(`${JSON.stringify(value)}\n`);await f.sync();}finally{await f.close();}
    await rename(temp,path);
    if(process.platform!=='win32'){
      const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
    }
  }finally{await rm(temp,{force:true});}
}
function paths(pendingKey,env,home) {
  invariant(typeof pendingKey==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(pendingKey),'TOPOLOGY_ENROLLMENT_KEY','An exact safe pending key is required.');
  const root=join(stateRoot(env,home),'enrollments');
  return {pending:join(root,'pending',`${pendingKey}.json`),lock:join(root,'pending',`${pendingKey}.lock`),
    request:join(root,'requests',`${pendingKey}.json`),enrolled:join(root,'enrolled',`${pendingKey}.json`)};
}
async function localAgent(consumer,agentRef,{home,pluginRoot}) {
  const agent=await requireAgent(agentRef,agentDirs({consumer,home,pluginRoot}));
  const root=await realpath(agentsRoot(consumer));
  const dir=await realpath(agent._dir);
  const rel=relative(root,dir);
  invariant(rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel), 'TOPOLOGY_ENROLLMENT_AGENT','Enrollment requires an identity in this repository library.');
  return agent;
}
async function observe(binding,consumer,{env,listPanesFn}) {
  invariant(validBinding(binding),'TOPOLOGY_ENROLLMENT_BINDING','Pending enrollment needs the complete six-tuple.');
  const panes=await (listPanesFn??listServerPanes)({tmuxServer:binding.serverKey,env});
  const matches=panes.filter(p=>p.alive!==false && exact(p,binding));
  invariant(matches.length===1,'TOPOLOGY_ENROLLMENT_BINDING','The pending session incarnation is no longer uniquely alive.');
  const current=matches[0];
  if(current.cwd) invariant((await canonicalRepoId(current.cwd)).id===(await canonicalRepoId(consumer)).id,
    'TOPOLOGY_ENROLLMENT_REPOSITORY','The current session belongs to another repository.');
  return current;
}

export async function requestEnrollment({consumer,pendingKey,agentRef,env=process.env,home=homedir(),pluginRoot,listPanesFn,ttlMs=300000}) {
  invariant(Number.isSafeInteger(ttlMs)&&ttlMs>0&&ttlMs<=1800000,'TOPOLOGY_ENROLLMENT_TTL','Enrollment challenge lifetime must be 1..1800000 ms.');
  const identity=await canonicalRepoId(consumer);
  const agent=await localAgent(consumer,agentRef,{home,pluginRoot});
  const p=paths(pendingKey,env,home);
  return withLock(p.lock,async()=>{
    const enrolled=await read(p.enrolled);
    if(enrolled){
      invariant(enrolled.repo_id===identity.id && enrolled.agent_id===agent.id,'TOPOLOGY_ENROLLMENT_ASSIGNED','This incarnation is already assigned to another identity.');
      return {status:'enrolled',record:enrolled,privileges:'unchanged'};
    }
    const pending=await read(p.pending);
    invariant(pending?.key===pendingKey && pending.repo_id===identity.id,'TOPOLOGY_ENROLLMENT_PENDING','No matching pending enrollment in this repository.');
    const current=await observe(pending.incarnation,consumer,{env,listPanesFn});
    const assigned=await read(p.request);
    invariant(!assigned || (assigned.agent_id===agent.id && assigned.repo_id===identity.id && exact(assigned.binding,pending.incarnation)),
      'TOPOLOGY_ENROLLMENT_ASSIGNED','This pending incarnation already has a different identity assignment.');
    const challengePath=join(agent._dir,'enrollment-challenges',`${pendingKey}.json`);
    const prior=await read(challengePath);
    if(prior && prior.version===1 && prior.pending_key===pendingKey && prior.expires_at>Date.now() && prior.agent_id===agent.id && prior.repo_id===identity.id && exact(prior.binding,pending.incarnation))
      return {status:'awaiting-ack',challenge:prior,challengePath,privileges:'unchanged'};
    const challenge={version:1,pending_key:pendingKey,nonce:randomUUID(),agent_id:agent.id,repo_id:identity.id,
      consumer:resolve(consumer),binding:Object.fromEntries(SIX.map(k=>[k,pending.incarnation[k]])),session:pending.session,
      observed_cwd:current.cwd??null,created_at:nowIso(),expires_at:Date.now()+ttlMs,privileges:'unchanged'};
    // The index reserves the identity before publishing its pollable challenge.
    await atomic(p.request,{agent_id:agent.id,repo_id:identity.id,binding:challenge.binding,challengePath});
    await atomic(challengePath,challenge);
    return {status:'awaiting-ack',challenge,challengePath,privileges:'unchanged'};
  });
}

export async function acknowledgeEnrollment({consumer,pendingKey,agentRef,nonce,env=process.env,home=homedir(),pluginRoot,listPanesFn}) {
  const identity=await canonicalRepoId(consumer);
  const agent=await localAgent(consumer,agentRef??env.AO_AGENT_ID,{home,pluginRoot});
  invariant(env.AO_AGENT_ID===agent.id && env.AO_CONSUMER && (await canonicalRepoId(env.AO_CONSUMER)).id===identity.id,
    'TOPOLOGY_ENROLLMENT_ACK','Enrollment acknowledgement requires the assigned launcher identity and repository.');
  const p=paths(pendingKey,env,home);
  return withLock(p.lock,async()=>{
    const assigned=await read(p.request);
    const challenge=await read(join(agent._dir,'enrollment-challenges',`${pendingKey}.json`));
    invariant(assigned?.agent_id===agent.id && assigned.repo_id===identity.id && challenge?.nonce===nonce && typeof nonce==='string' && nonce &&
      challenge.agent_id===agent.id && challenge.repo_id===identity.id && challenge.pending_key===pendingKey && exact(assigned.binding,challenge.binding),
      'TOPOLOGY_ENROLLMENT_ACK','The nonce does not identify this pending session and assigned identity.');
    const tmuxMatch = /^(.*),([0-9]+),[^,]+$/.exec(env.TMUX ?? '');
    invariant(env.TMUX_PANE===challenge.binding.paneId && tmuxMatch && tmuxMatch[1]===challenge.binding.serverKey && Number(tmuxMatch[2])===challenge.binding.serverPid,
      'TOPOLOGY_ENROLLMENT_BINDING', 'Acknowledgement must come from the exact challenged tmux server and pane.');
    await observe(challenge.binding,consumer,{env,listPanesFn});
    const old=await read(p.enrolled);
    if(old){
      invariant(old.agent_id===agent.id && old.repo_id===identity.id && exact(old.binding,challenge.binding),'TOPOLOGY_ENROLLMENT_ASSIGNED','This incarnation is already assigned differently.');
      // Recover a crash after the atomic enrolled record but before pending removal.
      const remaining=await read(p.pending);
      if(remaining?.key===pendingKey && remaining.repo_id===identity.id && exact(remaining.incarnation,old.binding))await rm(p.pending);
      return {status:'enrolled',record:old,privileges:'unchanged',deduplicated:true};
    }
    invariant(challenge.expires_at>Date.now(),'TOPOLOGY_ENROLLMENT_EXPIRED','The enrollment challenge expired; request a fresh challenge.');
    const pending=await read(p.pending);
    invariant(pending?.key===pendingKey && pending.repo_id===identity.id && exact(pending.incarnation,challenge.binding),
      'TOPOLOGY_ENROLLMENT_PENDING','The exact pending incarnation changed or disappeared.');
    const prompt=await refreshPrompt({agent,consumer,pluginRoot,home,env,live:true});
    invariant(prompt.status!=='invalid-config','TOPOLOGY_ENROLLMENT_PROMPT','Prompt configuration is invalid; pending enrollment is preserved.');
    // Prompt refresh touches files only. Queued/restart-required is never reported
    // as an applied system prompt or a privilege grant.
    const record={version:1,key:pendingKey,repo_id:identity.id,consumer:resolve(consumer),agent_id:agent.id,
      binding:challenge.binding,session:pending.session,pane:challenge.binding.paneId,kind:'external',
      enrollment:'enrolled',ready:true,readiness_checked_at:nowIso(),enrolled_at:nowIso(),
      // Agent-level prior acknowledgements do not prove this newly enrolled
      // terminal has applied a prompt. Report its own replacement limitation.
      prompt_status:['queued','restart-required'].includes(prompt.status)?prompt.status:'restart-required',
      prompt_revision:prompt.desired_revision??null,privileges:'unchanged'};
    await atomic(p.enrolled,record);
    const remaining = await read(p.pending);
    if (remaining?.key===pendingKey && remaining.repo_id===identity.id && exact(remaining.incarnation,record.binding)) await rm(p.pending);
    return {status:'enrolled',record,privileges:'unchanged'};
  });
}
