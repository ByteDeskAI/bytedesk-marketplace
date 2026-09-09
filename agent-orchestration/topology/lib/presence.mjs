// Presence v1 is read-only metadata, never authority. All session joins require an exact
// persisted tmux incarnation; legacy name-only records cannot label a newly reused pane.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { globalConfigPath } from "./config.mjs";
import { withLock } from "./lockfile.mjs";
import { listServerPanes } from "./tmux.mjs";
import { invariant, run } from "./util.mjs";

export const PRESENCE_BINDING_FIELDS = ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"];
const ROLES = new Set(["orchestrator", "worker", "designer", "judge", "reviewer", "researcher", "implementer"]);
const LIFE = new Set(["starting", "ready", "busy", "unresponsive", "dead"]);
const COUNTER = /^[0-9]+$/;
const idValid = value => typeof value === "string" && /^[a-z0-9]{8}$/.test(value);
const bindingKey = b => JSON.stringify(PRESENCE_BINDING_FIELDS.map(k => b[k]));
const bindingOf = r => r?.binding ?? r?.incarnation ?? r?.pane_identity;
const validBinding = b => b && ["serverKey", "sessionId", "paneId"].every(k => typeof b[k] === "string" && b[k]) && ["serverPid", "sessionCreated", "panePid"].every(k => Number.isSafeInteger(b[k]) && b[k] > 0);
async function json(path, optional = true) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (e) { if (optional && e.code === "ENOENT") return null; throw e; }
}
async function entries(path) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch(e) { if(e.code === "ENOENT") return []; throw e; }
}
async function records(path) {
  return Promise.all((await entries(path)).filter(e => e.isFile() && e.name.endsWith(".json")).map(e => json(join(path, e.name), false)));
}
async function durableReplace(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temp, "wx", 0o600); await file.writeFile(text, "utf8"); await file.sync(); await file.close(); file = null;
    await rename(temp, path);
    const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
  } finally { if(file) await file.close(); await rm(temp, {force:true}); }
}
async function rootCheckout(consumer, identity) {
  if(identity.kind !== "git-common-dir") return realpath(consumer).catch(() => resolve(consumer));
  const result = await run("git", ["-C", consumer, "worktree", "list", "--porcelain"], {allowFailure:true});
  const first = result.stdout.split("\n").find(line => line.startsWith("worktree "));
  invariant(first, "TOPOLOGY_PRESENCE_REPOSITORY", "Cannot resolve the main repository checkout.");
  return realpath(first.slice(9));
}
function bounds(staleAfterMs, clockSkewToleranceMs) {
  invariant(Number.isInteger(staleAfterMs) && staleAfterMs >= 1000 && staleAfterMs <= 300000, "TOPOLOGY_PRESENCE_BOUNDS", "staleAfterMs must be an integer in 1000..300000.");
  invariant(Number.isInteger(clockSkewToleranceMs) && clockSkewToleranceMs >= 0 && clockSkewToleranceMs <= 30000, "TOPOLOGY_PRESENCE_BOUNDS", "clockSkewToleranceMs must be an integer in 0..30000.");
}
async function loadLibrary(roots) {
  const library = new Map();
  for(const root of roots) {
    for(const dir of await entries(join(root, ".bytedesk/agent-orchestration/agents"))) {
      if(!dir.isDirectory()) continue;
      const path = join(root, ".bytedesk/agent-orchestration/agents", dir.name);
      const agent = await json(join(path, "agent.json"));
      if(agent && idValid(agent.id) && !library.has(agent.id)) library.set(agent.id, {...agent, _presenceDir:path});
    }
  }
  for(const role of ["lead", "reviewer"]) invariant([...library.values()].filter(a => a.role === role).length <= 1, "TOPOLOGY_PRESENCE_MULTIPLE_STANDING", `Multiple repository ${role} definitions; refusing ambiguous presence.`);
  return library;
}
async function loadRuns(roots, repoId, explicitDirs = []) {
  const dirs = new Set(explicitDirs.map(d => resolve(d)));
  for(const root of roots) for(const dir of await entries(join(root, ".bytedesk/agent-orchestration/runs"))) if(dir.isDirectory()) dirs.add(join(root, ".bytedesk/agent-orchestration/runs", dir.name));
  const found = new Map();
  for(const dir of dirs) {
    const record = await json(join(dir, "run.json"));
    if(!record || typeof record.run_id !== "string" || !record.consumer) continue;
    if((await canonicalRepoId(record.consumer)).id !== repoId) continue;
    invariant(!found.has(record.run_id), "TOPOLOGY_PRESENCE_RUN_ID", "Duplicate run identity; refusing ambiguous lineage.");
    found.set(record.run_id, {...record, _presenceDir:await realpath(dir)});
  }
  return found;
}
async function membership(record, repoId) {
  const depth = record.depth;
  invariant(Number.isInteger(depth) && depth >= 0 && depth <= 64, "TOPOLOGY_PRESENCE_DEPTH", "Run depth must be an integer in 0..64.");
  const parentId = record.parent?.run_id ?? null;
  invariant(depth === 0 ? record.parent === null : typeof parentId === "string" && parentId.length > 0, "TOPOLOGY_PRESENCE_LINEAGE", "Run lacks explicit root or parent lineage.");
  let root = depth === 0 ? record.run_id : null;
  let current = record;
  const seen = new Set([record.run_id]);
  for(let remaining=depth; remaining>0; remaining--) {
    const parent = current.parent;
    if(!parent?.run_dir || !parent.run_id) break;
    let ancestor;
    try { ancestor = await json(join(parent.run_dir, "run.json")); } catch { break; }
    if(!ancestor || ancestor.run_id !== parent.run_id || seen.has(ancestor.run_id) || ancestor.depth !== remaining-1 || !ancestor.consumer) break;
    if((await canonicalRepoId(ancestor.consumer)).id !== repoId) break;
    seen.add(ancestor.run_id); current = ancestor;
    if(remaining === 1 && ancestor.parent === null) root = ancestor.run_id;
  }
  const chain = [...(Array.isArray(record.parent?.chain) ? record.parent.chain.filter(v => typeof v === "string") : []), String(record.name ?? record.run_id)];
  return {runId:record.run_id,parentRunId:parentId,rootRunId:root,runName:String(record.name ?? record.run_id),depth,chain};
}

/** Complete fresh metadata projection. Injectable enumeration is for isolated tests only. */
export async function collectPresenceAgents({consumer, repositoryRoot, identity, env=process.env, home=homedir(), tmuxServer, listPanesFn=listServerPanes, runDirs=[]}={}) {
  identity ??= await canonicalRepoId(consumer);
  repositoryRoot ??= await rootCheckout(consumer, identity);
  const roots = [...new Set([repositoryRoot, resolve(consumer)])];
  if(identity.kind === "git-common-dir") {
    const listing = await run("git", ["-C", consumer, "worktree", "list", "--porcelain"], {allowFailure:true});
    invariant(listing.code === 0,"TOPOLOGY_PRESENCE_REPOSITORY","Cannot enumerate repository worktrees.");
    for(const line of listing.stdout.split("\n")) if(line.startsWith("worktree ")) {
      const root=await realpath(line.slice(9)).catch(()=>null);
      if(root && !roots.includes(root)) roots.push(root);
    }
  }
  const library = await loadLibrary(roots);
  const state = stateRoot(env,home);
  const standing = [...await records(join(state,"leads")), ...await records(join(state,"reviewers")), ...await records(join(state,"enrollments/enrolled"))].filter(r=>r.repo_id === identity.id);
  // Role-session launch records are stored inside the owning library entry.
  for(const agent of library.values()) {
    const record = await json(join(agent._presenceDir,"session.json"));
    if(record) standing.push({...record,agent_id:agent.id});
  }
  const pending = (await records(join(state,"enrollments/pending"))).filter(r=>r.repo_id === identity.id);
  const runs = await loadRuns(roots,identity.id,runDirs);
  const selectors = new Set(tmuxServer ? [tmuxServer] : []);
  for(const record of [...standing,...pending,...[...runs.values()].flatMap(r=>r.agents??[])]) {
    const binding=bindingOf(record); if(validBinding(binding)) selectors.add(binding.serverKey);
  }
  if(!selectors.size) selectors.add(tmuxServer);
  const observations = (await Promise.all([...selectors].map(server=>listPanesFn({tmuxServer:server,env})))).flat();
  const panes = new Map();
  for(const pane of observations) {
    invariant(validBinding(pane) && typeof pane.sessionName === "string" && pane.sessionName.length > 0,"TOPOLOGY_PRESENCE_BINDING","tmux returned an incomplete pane incarnation.");
    panes.set(bindingKey(pane),pane);
  }
  const agents = new Map();
  const add = (record, {agentId,kind="role-session",runRole=null,membership:member=null,enrollment="enrolled",spawn=null}={}) => {
    const binding=bindingOf(record);
    if(!validBinding(binding)) return;
    const pane=panes.get(bindingKey(binding)); if(!pane) return;
    const def=library.get(agentId);
    if(!idValid(agentId)) agentId=createHash("sha256").update(bindingKey(binding)).digest("hex").slice(0,8);
    invariant(kind !== "spawn" || pane.sessionName === `${agentId}-${spawn}`,"TOPOLOGY_PRESENCE_SPAWN","Spawn metadata disagrees with the observed incarnation name; refusing an invalid snapshot.");
    const key=bindingKey(binding); let entry=agents.get(key);
    if(entry) {
      invariant(entry.agentId === agentId,"TOPOLOGY_PRESENCE_CONFLICT","Two identities claim one pane incarnation.");
      if(member && !entry.memberships.some(m=>m.runId===member.runId)) entry.memberships.push(member);
      if(member && entry.primaryRunId === null) {entry.primaryRunId=member.runId;entry.runRole=runRole;}
      return;
    }
    const repoRole=def?.role === "lead" ? "lead" : def?.role === "reviewer" ? "reviewer" : "member";
    const lifecycle=pane.alive === false ? "dead" : LIFE.has(record.lifecycle) ? record.lifecycle : record.ready === true ? "ready" : "starting";
    entry={agentId,displayName:typeof def?.full_name === "string" ? def.full_name : "Unenrolled agent",title:typeof def?.title === "string" ? def.title : "Agent",repoRole,runRole,coordinatesOnly:def?.coordinates_only === true,enrollment,lifecycle,readinessCheckedAt:typeof (record.readiness_checked_at ?? record.readinessCheckedAt) === "string" ? (record.readiness_checked_at ?? record.readinessCheckedAt) : null,
      session:{kind,...Object.fromEntries(PRESENCE_BINDING_FIELDS.map(k=>[k,pane[k]])),sessionName:pane.sessionName,spawn},memberships:member?[member]:[],primaryRunId:member?.runId??null};
    agents.set(key,entry);
  };
  for(const record of standing) add(record,{agentId:record.agent_id,kind:record.kind === "external" ? "external" : "role-session",enrollment:record.enrollment === "detached" ? "detached" : "enrolled"});
  for(const record of [...runs.values()].sort((a,b)=>a.run_id.localeCompare(b.run_id))) {
    const member=await membership(record,identity.id);
    for(const agent of record.agents??[]) {
      if(!ROLES.has(agent.role)) continue;
      const spawn=typeof agent.spawn === "string" && /^[a-f0-9]{7}$/.test(agent.spawn) ? agent.spawn : null;
      add(agent,{agentId:agent.agent_id ?? agent.id,kind:spawn?"spawn":"run",spawn,runRole:agent.role,membership:member});
    }
  }
  for(const record of pending) {
    const binding=bindingOf(record); if(validBinding(binding) && agents.has(bindingKey(binding))) continue;
    add(record,{agentId:record.agent_id,kind:"external",enrollment:"pending"});
  }
  return [...agents.values()].sort((a,b)=>bindingKey(a.session).localeCompare(bindingKey(b.session)));
}

/** Allocate one incarnation. The global generation allocator never resets; per-repo fencing
 * allows independent repository publishers without letting an old publisher overwrite its successor. */
export async function createPresenceProducer({consumer,env=process.env,home=homedir(),presenceDir,staleAfterMs=30000,clockSkewToleranceMs=5000,tmuxServer,listPanesFn,runDirs=[]}={}) {
  bounds(staleAfterMs,clockSkewToleranceMs);
  // L1, and only L1. The frozen contract §2.2 requires a rewrite every staleAfterMs/3 — the
  // heartbeat is what makes the ABSENCE of a rewrite meaningful to a consumer. The supervisor's
  // reconcile tick is a different, slower, deliberately unrelated cadence (see supervision.mjs);
  // asserting the bound at CONSTRUCTION is what stops the two ever being conflated into one number.
  const publishIntervalMs=Math.floor(staleAfterMs/3);
  invariant(publishIntervalMs>0 && publishIntervalMs*3<=staleAfterMs,"TOPOLOGY_PRESENCE_BOUNDS",
    `Presence publish interval ${publishIntervalMs}ms exceeds the contract's staleAfterMs/3 (${staleAfterMs}/3).`);
  const identity=await canonicalRepoId(consumer), repositoryKey=repoKey(identity.id), repositoryRoot=await rootCheckout(consumer,identity);
  const global=await json(globalConfigPath(home,env));
  const dir=presenceDir ?? global?.presenceDir ?? join(stateRoot(env,home),"presence");
  invariant(typeof dir === "string" && isAbsolute(dir),"TOPOLOGY_PRESENCE_PATH","Presence directory must be absolute.");
  await mkdir(dir,{recursive:true});
  const generationPath=join(dir,".generation"), lockPath=join(dir,".publish.lock"), ownerPath=join(dir,`.${repositoryKey}.owner.json`), path=join(dir,`${repositoryKey}.json`);
  const owner=randomUUID();
  const generation=await withLock(lockPath,async()=>{
    let current;
    try {current=(await readFile(generationPath,"utf8")).trim();}
    catch(e) {
      if(e.code!=="ENOENT") throw e;
      invariant(!(await entries(dir)).some(e=>e.name.endsWith(".json")),"TOPOLOGY_PRESENCE_GENERATION","Generation marker is missing from an existing presence store; refusing to reset it.");
      current="0";
    }
    invariant(COUNTER.test(current),"TOPOLOGY_PRESENCE_GENERATION","Unreadable generation counter; refusing to publish.");
    const next=(BigInt(current)+1n).toString();
    await durableReplace(generationPath,next+"\n");
    await durableReplace(ownerPath,JSON.stringify({owner,generation:next,revision:"0"})+"\n");
    return next;
  });
  const publish=async()=>{
    const agents=await collectPresenceAgents({consumer,repositoryRoot,identity,env,home,tmuxServer,listPanesFn,runDirs});
    return withLock(lockPath,async()=>{
      const active=await json(ownerPath,false);
      invariant(active.owner===owner && active.generation===generation,"TOPOLOGY_PRESENCE_FENCED","A newer producer owns this repository; stop this publisher.");
      const marker=(await readFile(generationPath,"utf8")).trim();
      invariant(COUNTER.test(marker) && BigInt(marker)>=BigInt(generation),"TOPOLOGY_PRESENCE_GENERATION","Generation marker is missing, corrupt or rolled back.");
      invariant(COUNTER.test(active.revision),"TOPOLOGY_PRESENCE_GENERATION","Revision counter is corrupt.");
      const revision=active.revision;
      const snapshot={schemaVersion:1,repositoryKey,repositoryRoot,generation,revision,generatedAt:new Date().toISOString(),staleAfterMs,clockSkewToleranceMs,agents};
      // Persist the next revision before publication. A crash may leave a harmless gap, never reuse.
      await durableReplace(ownerPath,JSON.stringify({...active,revision:(BigInt(revision)+1n).toString()})+"\n");
      await durableReplace(path,JSON.stringify(snapshot,null,2)+"\n");
      return snapshot;
    });
  };
  const watch=async({signal,onPublish=()=>{}}={})=>{
    const intervalMs=publishIntervalMs;
    while(!signal?.aborted) {
      const start=Date.now(); const snapshot=await publish(); await onPublish(snapshot);
      try {await delay(Math.max(0,intervalMs-(Date.now()-start)),undefined,{signal});} catch(e) {if(e.name!=="AbortError") throw e;}
    }
  };
  return {generation,path,publish,watch,publishIntervalMs,staleAfterMs};
}
export async function publishPresence(options={}) {return (await createPresenceProducer(options)).publish();}
export async function watchPresence(options={}) {const producer=await createPresenceProducer(options);await producer.watch({signal:options.signal,onPublish:options.onPublish});return producer;}
