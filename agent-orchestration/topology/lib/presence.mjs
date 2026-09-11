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
import { slotsDir } from "./slots.mjs";
import { censusPath, withStaleness } from "./census.mjs";
import { queueDepth } from "./mailbox.mjs";
import { roleVisual } from "./identity.mjs";
import { invariant, run } from "./util.mjs";

export const PRESENCE_BINDING_FIELDS = ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"];
// The frozen contract's runRole vocabulary (§3), enforced by exact membership. It is a MAPPING
// TARGET, never a filter: a run agent whose library role is outside it — `image-gen`, and `lead`,
// which a run spec never carries because a repo lead appears in its own run as `orchestrator` —
// used to be `continue`d past, so `add()` never ran and the agent had NO ENTRY IN THE SNAPSHOT AT
// ALL. Dropping an agent is strictly worse than mislabelling one. Unknown roles now map to the
// nearest legal token and the truth rides in the additive `roleName` (PRESENCE-HEADER-ADDENDUM.md
// §3.4/§7), which a v1 consumer ignores. Opening this set WAS schemaVersion 2 — and v2 is now
// countersigned by the gateway coordinator and committed on their side (bd8cefc0), so `image-gen`
// is legal here rather than mapped away. `roleName` stays: it still carries roles outside BOTH
// vocabularies, and dropping it would re-open the hole where an unknown role has no snapshot entry.
const ROLES = new Set(["orchestrator", "worker", "designer", "judge", "reviewer", "researcher", "implementer", "image-gen"]);
const NEAREST_RUN_ROLE = "worker";
// v2 only. Kept as its own set rather than merged into the lead/reviewer/member literals, mirroring
// the gateway's separate presenceRepoRolesV2 table, so the frozen v1 vocabulary cannot drift by an
// edit to one line.
const REPO_ROLES_V2 = new Set(["designer", "image-gen"]);
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
/**
 * TM-138. The additive header keys, gathered READ-ONLY.
 *
 * `slotStatus()` is the obvious source for slots and it is the wrong one: it takes a lock per slot
 * and COMMITS a reconciled record. Calling it from here would turn a publisher that this file's
 * first line calls "read-only metadata, never authority" into something that mutates every slot
 * record on every heartbeat — roughly every ten seconds, forever. So the records are read directly.
 * A publisher must never be a writer of the state it publishes.
 *
 * Every one of these is optional and absent-on-failure. A key is emitted only when the producer
 * actually knows the answer, never as a placeholder, which is what keeps a sparse snapshot honest
 * and is the same rule `roleName` already follows.
 */
async function readSlots(identity, env, home) {
  const dir = slotsDir(identity, env, home);
  const names = (await readdir(dir).catch(() => [])).filter(n => n.endsWith(".json")).map(n => n.slice(0, -5)).sort();
  const queues = [];
  const byAgent = new Map();
  const note = (agentId, key, value) => {
    if (!agentId) return;
    const seat = byAgent.get(agentId) ?? { held: [], waiting: [] };
    seat[key].push(value);
    byAgent.set(agentId, seat);
  };
  for (const name of names) {
    const record = await json(join(dir, `${name}.json`));
    if (!record) continue;
    const holder = record.holder?.agent_id ?? null;
    const waiting = (record.queue ?? []).map(entry => entry?.agent_id).filter(Boolean);
    queues.push({ name, holder, heldSince: record.holder?.granted_at ?? null, waiting });
    if (holder) note(holder, "held", name);
    // `position` is 1-based and is the queue's own order, not a re-derivation of it.
    waiting.forEach((agentId, index) => note(agentId, "waiting", { name, position: index + 1 }));
  }
  return { queues, byAgent };
}

/**
 * `observedAt` answers gateway defect D1: when the verdict was last CONFIRMED, as distinct from
 * `since`, when the state was ENTERED. It is the census document's own `at`, so it costs no new
 * observation. A STALE census contributes nothing rather than a stale-but-plausible reading —
 * `withStaleness` already rewrites those agents to `unknown`, and publishing "unknown" as though it
 * were observed is exactly the confidently-wrong verdict the addendum forbids.
 */
async function readActivity(identity, env, home) {
  const document = await json(censusPath({ env, home, key: repoKey(identity.id) }));
  const fresh = withStaleness(document);
  const byAgent = new Map();
  if (!fresh || fresh.stale) return byAgent;
  for (const agent of fresh.agents ?? []) {
    if (!agent?.agent_id || typeof agent.state !== "string") continue;
    byAgent.set(agent.agent_id, {
      state: agent.state,
      ...(typeof agent.since === "string" ? { since: agent.since } : {}),
      ...(typeof fresh.at === "string" ? { observedAt: fresh.at } : {}),
      observed: agent.observed !== false,
    });
  }
  return byAgent;
}

async function readMailboxDepths(runDirs) {
  const byAgent = new Map();
  for (const runDir of runDirs ?? []) {
    const rows = await queueDepth(runDir, null).catch(() => null);
    for (const row of rows ?? []) {
      if (!row?.agent) continue;
      const prior = byAgent.get(row.agent) ?? { depth: 0, oldestAgeMs: 0 };
      byAgent.set(row.agent, {
        depth: prior.depth + (Number(row.depth) || 0),
        oldestAgeMs: Math.max(prior.oldestAgeMs, Number(row.oldest_age_ms ?? row.oldestAgeMs) || 0),
      });
    }
  }
  return byAgent;
}

/**
 * `task` — the task an agent currently holds, from the management record's own assignee. Read
 * directly from the assignment records for the same reason the slots are: `managementStatus()`
 * builds a context and a task-store binding, and a publisher must not do either on a heartbeat.
 *
 * An assignment with a `released_at` is over, so it contributes nothing. An agent with no live
 * assignment has no `task` key rather than a null one.
 */
async function readAssignedTasks(identity, env, home) {
  const root = join(stateRoot(env, home), "management", repoKey(identity.id));
  const byAgent = new Map();
  for (const name of (await readdir(root).catch(() => [])).filter(n => /^TM-[0-9]+\.json$/.test(n))) {
    const record = await json(join(root, name));
    const assignee = record?.assignee;
    if (!assignee || assignee.released_at || !assignee.agent_id || typeof record.task !== "string") continue;
    byAgent.set(assignee.agent_id, record.task);
  }
  return byAgent;
}

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
  // TM-167: no named server and no binding means nothing here can match a pane — every match below is
  // by binding — so enumerating the implicit server could only observe other repositories' agents.
  const observations = (await Promise.all([...selectors].map(server=>listPanesFn({tmuxServer:server,env})))).flat();
  const panes = new Map();
  for(const pane of observations) {
    invariant(validBinding(pane) && typeof pane.sessionName === "string" && pane.sessionName.length > 0,"TOPOLOGY_PRESENCE_BINDING","tmux returned an incomplete pane incarnation.");
    panes.set(bindingKey(pane),pane);
  }
  const agents = new Map();
  const add = (record, {agentId,kind="role-session",runRole=null,roleName=null,membership:member=null,enrollment="enrolled",spawn=null}={}) => {
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
      if(member && entry.primaryRunId === null) {entry.primaryRunId=member.runId;entry.runRole=runRole;if(roleName) entry.roleName=roleName;}
      return;
    }
    // v2 opens repoRole to the standing library roles the gateway now renders. Anything still
    // outside both sets falls to `member` and rides in `roleName` — the v1 behaviour, unchanged,
    // because opening a vocabulary is not the same as removing the fallback that protects it.
    const repoRole=def?.role === "lead" ? "lead" : def?.role === "reviewer" ? "reviewer"
      : REPO_ROLES_V2.has(def?.role) ? def.role : "member";
    const lifecycle=pane.alive === false ? "dead" : LIFE.has(record.lifecycle) ? record.lifecycle : record.ready === true ? "ready" : "starting";
    // Additive and optional: emitted only when a role token was actually read, never as a
    // placeholder. `repoRole`/`runRole` stay inside their frozen vocabularies; this carries what
    // the producer actually knows so nothing has to be coerced or dropped.
    const trueRole=typeof roleName === "string" && roleName ? roleName : typeof def?.role === "string" && def.role ? def.role : null;
    entry={agentId,displayName:typeof def?.full_name === "string" ? def.full_name : "Unenrolled agent",title:typeof def?.title === "string" ? def.title : "Agent",repoRole,runRole,...(trueRole?{roleName:trueRole}:{}),coordinatesOnly:def?.coordinates_only === true,enrollment,lifecycle,readinessCheckedAt:typeof (record.readiness_checked_at ?? record.readinessCheckedAt) === "string" ? (record.readiness_checked_at ?? record.readinessCheckedAt) : null,
      session:{kind,...Object.fromEntries(PRESENCE_BINDING_FIELDS.map(k=>[k,pane[k]])),sessionName:pane.sessionName,spawn},memberships:member?[member]:[],primaryRunId:member?.runId??null};
    agents.set(key,entry);
  };
  for(const record of standing) add(record,{agentId:record.agent_id,kind:record.kind === "external" ? "external" : "role-session",enrollment:record.enrollment === "detached" ? "detached" : "enrolled"});
  for(const record of [...runs.values()].sort((a,b)=>a.run_id.localeCompare(b.run_id))) {
    const member=await membership(record,identity.id);
    for(const agent of record.agents??[]) {
      const spawn=typeof agent.spawn === "string" && /^[a-f0-9]{7}$/.test(agent.spawn) ? agent.spawn : null;
      const declared=typeof agent.role === "string" && agent.role ? agent.role : null;
      add(agent,{agentId:agent.agent_id ?? agent.id,kind:spawn?"spawn":"run",spawn,runRole:ROLES.has(declared)?declared:NEAREST_RUN_ROLE,roleName:declared,membership:member});
    }
  }
  for(const record of pending) {
    const binding=bindingOf(record); if(validBinding(binding) && agents.has(bindingKey(binding))) continue;
    add(record,{agentId:record.agent_id,kind:"external",enrollment:"pending"});
  }
  const [slots, activity, depths, tasks] = await Promise.all([
    readSlots(identity, env, home),
    readActivity(identity, env, home),
    readMailboxDepths(runDirs),
    readAssignedTasks(identity, env, home),
  ]);
  const ordered = [...agents.values()].sort((a,b)=>bindingKey(a.session).localeCompare(bindingKey(b.session)));
  for (const entry of ordered) {
    // TM-168. Display only, and computed HERE rather than in add(): a standing agent that later joins
    // a run has its roleName moved to the run role by the first-join overwrite above, and an icon
    // taken at add() time would keep the library role. Never read back for routing or authority.
    Object.assign(entry, roleVisual({
      repoRole: entry.repoRole,
      runRole: entry.primaryRunId ? entry.roleName ?? null : null,
      role: library.get(entry.agentId)?.role ?? null,
    }));
    const seat = slots.byAgent.get(entry.agentId);
    // `slots` is emitted whenever the agent appears in any slot record, held or waiting. An agent in
    // none is absent from the key rather than carrying two empty arrays, because "not in a queue"
    // and "queues exist and this agent is in none" are the same fact to a consumer and the shorter
    // one does not invite a reader to infer a queue that is not there.
    if (seat) entry.slots = { held: seat.held, waiting: seat.waiting };
    const seen = activity.get(entry.agentId);
    if (seen) entry.activity = seen;
    const depth = depths.get(entry.agentId);
    if (depth) entry.mailboxDepth = depth;
    const task = tasks.get(entry.agentId);
    if (task) entry.task = task;
  }
  PRESENCE_SLOT_QUEUES.set(identity.id, slots.queues);
  return ordered;
}

/**
 * The top-level `slotQueues` belongs to the SNAPSHOT, not to any agent, and `collectPresenceAgents`
 * returns an array. Rather than change that signature — every caller and test depends on it — the
 * collector records the queues it just read and the publisher picks them up for the same identity.
 */
const PRESENCE_SLOT_QUEUES = new Map();
export function presenceSlotQueues(identity) { return PRESENCE_SLOT_QUEUES.get(identity?.id) ?? []; }

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
      const snapshot={schemaVersion:2,repositoryKey,repositoryRoot,generation,revision,generatedAt:new Date().toISOString(),staleAfterMs,clockSkewToleranceMs,agents,slotQueues:presenceSlotQueues(identity)};
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
