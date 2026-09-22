import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveConsumerRepository } from './workspace/repository.mjs';
import { probeSessionHost } from './session/host.mjs';
import { canonicalRepoId, repoKey, stateRoot as topologyStateRoot } from '../topology/lib/repoid.mjs';
import { supervisionStatus } from '../topology/lib/supervision.mjs';
import { incarnationOf, sameIncarnation } from '../topology/lib/incarnation.mjs';
import { leadState } from '../topology/lib/lead.mjs';
import { reviewerStanding } from '../topology/lib/reviewer.mjs';
import { agentDirs, resolveAgentRef } from '../topology/lib/agents.mjs';
import { loadConfig } from '../topology/lib/config.mjs';
import { composePrompt, readPromptState } from '../topology/lib/prompts.mjs';

// These values describe the loaded executable even if its installed files have
// since been refreshed. Disk fingerprints are reported separately.
const loadedBuild = {
  mode:typeof __AO_BUILD_FINGERPRINT__==='undefined'?'source':'bundle',
  sourceFingerprint:typeof __AO_BUILD_FINGERPRINT__==='undefined'?null:__AO_BUILD_FINGERPRINT__,
  version:typeof __AO_BUILD_VERSION__==='undefined'?null:__AO_BUILD_VERSION__,
};
const json = path => readFile(path,'utf8').then(JSON.parse).catch(()=>null);
const fingerprint = path => readFile(path).then(bytes=>createHash('sha256').update(bytes).digest('hex')).catch(()=>null);

async function rolePromptEvidence(options, record, role, repositoryId) {
  const result = { current: false, state: 'missing', desiredRevision: null, appliedRevision: null };
  if (!record || record.repo_id !== repositoryId || !incarnationOf(record.binding)) return result;
  const consumer = record.consumer || options.consumer;
  if ((await canonicalRepoId(consumer)).id !== repositoryId) return { ...result, state: 'repository-mismatch' };
  const scoped = { ...options, consumer };
  const agent = await resolveAgentRef(record.agent_id, agentDirs(scoped));
  if (!agent || agent.id !== record.agent_id || agent.role !== role) return { ...result, state: 'agent-mismatch' };
  const [loaded, state] = await Promise.all([loadConfig(scoped), readPromptState(agent._dir)]);
  const composed = await composePrompt({ agent, consumer, dir: agent._dir, loaded, templateName: agent.template });
  Object.assign(result, { state: state?.status || 'missing', desiredRevision: composed.revision, appliedRevision: state?.applied_revision || null });
  if (!composed.ok) return { ...result, state: 'invalid-config' };
  const acknowledgedAt = Date.parse(state?.acknowledged_at);
  result.current = state?.status === 'current' && state.repo_id === repositoryId && state.desired_session === record.session &&
    state.desired_revision === composed.revision && state.applied_revision === composed.revision && !state.nonce &&
    sameIncarnation(state.desired_binding, record.binding) && sameIncarnation(state.applied_binding, record.binding) &&
    Number.isFinite(acknowledgedAt) && acknowledgedAt <= Date.now() + 5000;
  if (result.state === 'current' && !result.current) result.state = 'stale';
  return result;
}

export async function runtimeDiagnostics({consumerCwd,pluginRoot,stateRoot,env=process.env,home=homedir()}) {
  let consumer=null,admission={provided:Boolean(consumerCwd),admitted:null};
  if(consumerCwd) {
    try { consumer=await resolveConsumerRepository({consumerCwd,pluginRoot,stateRoot}); admission={provided:true,admitted:true,checkoutRoot:consumer.checkoutRoot,repositoryId:consumer.commonGitDir}; }
    catch(error) { admission={provided:true,admitted:false,code:error.code??'AO_CONSUMER_DIAGNOSIS_FAILED',message:error.message}; }
  }
  const [mcp,cli,host,pkg]=await Promise.all([fingerprint(join(pluginRoot,'dist/mcp.cjs')),fingerprint(join(pluginRoot,'dist/cli.cjs')),probeSessionHost(stateRoot),json(join(pluginRoot,'package.json'))]);
  const effectiveTopologyRoot=topologyStateRoot(env,home);
  const diagnostics={consumerAdmission:admission,loadedBuild:{...loadedBuild,diskVersion:pkg?.version??null,disk:{mcp,cli}},
    runtimeModes:['acp','topology'],stateRoots:{acp:stateRoot,topology:effectiveTopologyRoot,aligned:stateRoot===effectiveTopologyRoot},
    sessionHost:{healthy:Boolean(host),port:host?.port??null,pid:host?.pid??null},repositorySupervision:null,roles:[]};
  if(!consumer) return diagnostics;
  // The ACP caller's selected state root is explicit. Report any topology
  // mismatch without reading a different repository's role records.
  const opts={consumer:consumer.checkoutRoot,pluginRoot,home,env:{...env,AGENT_ORCHESTRATION_STATE_HOME:stateRoot}};
  diagnostics.repositorySupervision=await supervisionStatus(opts).catch(error=>({state:'unknown',error:error.code??error.message}));
  const key=repoKey(consumer.commonGitDir);
  const census=await json(join(stateRoot,'census',`${key}.json`));
  const at=Date.parse(census?.at);
  const fresh=Number.isFinite(at)&&Date.now()-at>=-5000&&Date.now()-at<=Number(census?.staleAfterMs??45000);
  for(const role of ['lead','reviewer']) {
    const record=await json(join(stateRoot,`${role}s`,`${key}.json`));
    const observed=census?.agents?.find(agent=>agent.agentId===record?.agent_id && sameIncarnation(agent.session??agent.binding,record?.binding));
    const reasons=[];
    let responsive=false,prompt={current:false,state:'missing',desiredRevision:null,appliedRevision:null},roleState='unknown';
    const exact=record?.repo_id===consumer.commonGitDir && Boolean(incarnationOf(record?.binding));
    if(!exact) reasons.push('registered repository and exact role incarnation are unavailable');
    if(!fresh || !observed) reasons.push('fresh census evidence for this incarnation is unavailable');
    else if(observed.dispatchable!==true) reasons.push('the observed process is not dispatchable');
    if(exact) {
      try {
        // Producer checks reuse only existing proof. A doctor never wakes a role,
        // mints a challenge, consumes an acknowledgement or starts a provider.
        const standing=role==='lead' ? await leadState({...opts,readOnly:true}) : await reviewerStanding({...opts,readOnly:true});
        roleState=role==='lead' ? standing.status : !standing.registered?'none':!standing.alive?'registered':standing.responsive?'responsive':'unresponsive';
        responsive=roleState==='responsive' && standing.record?.agent_id===record.agent_id && sameIncarnation(standing.record.binding,record.binding);
        prompt=await rolePromptEvidence(opts,record,role,consumer.commonGitDir);
      } catch(error) { reasons.push(`role readiness observation failed: ${error.code??'AO_ROLE_READINESS_UNKNOWN'}`); }
    }
    if(!responsive) reasons.push('no current readiness acknowledgement for this exact role incarnation');
    if(!prompt.current) reasons.push(`current prompt acknowledgement is unavailable (${prompt.state})`);
    diagnostics.roles.push({role,registered:Boolean(record),agentId:record?.agent_id??null,provider:record?.provider??null,
      incarnationRecorded:Boolean(incarnationOf(record?.binding)),censusFresh:fresh,state:fresh&&observed?observed.state:'unknown',
      roleState,responsive,prompt,ready:reasons.length===0,readinessReasons:reasons,
      readinessScope:'current prompt and existing role nonce acknowledgements for the exact incarnation; ACP provider readiness is separate'});
  }
  return diagnostics;
}
