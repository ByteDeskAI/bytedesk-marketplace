import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveConsumerRepository } from './workspace/repository.mjs';
import { probeSessionHost } from './session/host.mjs';
import { repoKey, stateRoot as topologyStateRoot } from '../topology/lib/repoid.mjs';
import { supervisionStatus } from '../topology/lib/supervision.mjs';
import { sameIncarnation } from '../topology/lib/incarnation.mjs';

// These values describe the loaded executable even if its installed files have
// since been refreshed. Disk fingerprints are reported separately.
const loadedBuild = {
  mode:typeof __AO_BUILD_FINGERPRINT__==='undefined'?'source':'bundle',
  sourceFingerprint:typeof __AO_BUILD_FINGERPRINT__==='undefined'?null:__AO_BUILD_FINGERPRINT__,
  version:typeof __AO_BUILD_VERSION__==='undefined'?null:__AO_BUILD_VERSION__,
};
const json = path => readFile(path,'utf8').then(JSON.parse).catch(()=>null);
const fingerprint = path => readFile(path).then(bytes=>createHash('sha256').update(bytes).digest('hex')).catch(()=>null);

export async function runtimeDiagnostics({consumerCwd,pluginRoot,stateRoot,env=process.env}) {
  let consumer=null,admission={provided:Boolean(consumerCwd),admitted:null};
  if(consumerCwd) {
    try { consumer=await resolveConsumerRepository({consumerCwd,pluginRoot,stateRoot}); admission={provided:true,admitted:true,checkoutRoot:consumer.checkoutRoot,repositoryId:consumer.commonGitDir}; }
    catch(error) { admission={provided:true,admitted:false,code:error.code??'AO_CONSUMER_DIAGNOSIS_FAILED',message:error.message}; }
  }
  const [mcp,cli,host,pkg]=await Promise.all([fingerprint(join(pluginRoot,'dist/mcp.cjs')),fingerprint(join(pluginRoot,'dist/cli.cjs')),probeSessionHost(stateRoot),json(join(pluginRoot,'package.json'))]);
  const effectiveTopologyRoot=topologyStateRoot(env);
  const diagnostics={consumerAdmission:admission,loadedBuild:{...loadedBuild,diskVersion:pkg?.version??null,disk:{mcp,cli}},
    runtimeModes:['acp','topology'],stateRoots:{acp:stateRoot,topology:effectiveTopologyRoot,aligned:stateRoot===effectiveTopologyRoot},
    sessionHost:{healthy:Boolean(host),port:host?.port??null,pid:host?.pid??null},repositorySupervision:null,roles:[]};
  if(!consumer) return diagnostics;
  // The ACP caller's selected state root is explicit. Report any topology
  // mismatch without reading a different repository's role records.
  const opts={consumer:consumer.checkoutRoot,env:{...env,AGENT_ORCHESTRATION_STATE_HOME:stateRoot}};
  diagnostics.repositorySupervision=await supervisionStatus(opts).catch(error=>({state:'unknown',error:error.code??error.message}));
  const key=repoKey(consumer.commonGitDir);
  const census=await json(join(stateRoot,'census',`${key}.json`));
  const at=Date.parse(census?.at);
  const fresh=Number.isFinite(at)&&Date.now()-at>=-5000&&Date.now()-at<=Number(census?.staleAfterMs??45000);
  for(const role of ['lead','reviewer']) {
    const record=await json(join(stateRoot,`${role}s`,`${key}.json`));
    const observed=census?.agents?.find(agent=>agent.agentId===record?.agent_id && sameIncarnation(agent.session??agent.binding,record?.binding));
    diagnostics.roles.push({role,registered:Boolean(record),agentId:record?.agent_id??null,provider:record?.provider??null,
      incarnationRecorded:Boolean(record?.binding),censusFresh:fresh,state:fresh&&observed?observed.state:'unknown',
      ready:fresh&&Boolean(observed?.dispatchable),readinessScope:'recorded exact-incarnation census; ACP provider readiness is separate'});
  }
  return diagnostics;
}
