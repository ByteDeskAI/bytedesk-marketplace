import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { collectPresenceAgents, createPresenceProducer, publishPresence } from "../../topology/lib/presence.mjs";
const run=promisify(execFile);
const python=args=>run("python3",args,{env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
const fixtures=join(dirname(fileURLToPath(import.meta.url)),"../../topology/fixtures/presence-v1");
const put=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value));};
async function setup(t) {
 const root=await mkdtemp(join(tmpdir(),"ao-presence-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const consumer=join(root,"repo");await mkdir(consumer);
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,"state")};const home=join(root,"home");
 return {root,consumer,env,home,listPanesFn:async()=>[]};
}
function pane(n,overrides={}) {return {serverKey:"/tmp/test.sock",serverPid:100,sessionId:`$${n}`,sessionCreated:200,paneId:`%${n}`,panePid:300+n,sessionName:`display-${n}`,command:"kimi",alive:true,...overrides};}
async function agent(ctx,id,role,binding=null) {
 const dir=join(ctx.consumer,".bytedesk/agent-orchestration/agents",id);
 await put(join(dir,"agent.json"),{id,full_name:`Person ${id}`,title:"Engineer",role,coordinates_only:role==="lead",instructions:"DO NOT EMIT PROMPT",env:{TOKEN:"DO NOT EMIT SECRET"}});
 if(binding) await put(join(dir,"session.json"),{agent_id:id,binding,ready:true,readiness_checked_at:"2026-09-09T00:00:00.000Z",command:"SECRET COMMAND"});
}
async function workflow(ctx,id,agents,{parent=null,depth=0,name=id}={}) {
 const dir=join(ctx.consumer,".bytedesk/agent-orchestration/runs",id);
 await put(join(dir,"run.json"),{run_id:id,name,run_dir:dir,consumer:ctx.consumer,parent,depth,agents,inputs:{secret:"DO NOT EMIT INPUT"},prompt:"DO NOT EMIT PROMPT"});return dir;
}

test("frozen fixtures and validator negative suite conform unchanged",async()=>{
 const valid=await python([join(fixtures,"validate_presence.py")]);assert.match(valid.stdout,/7 snapshot/);
 const negative=await python([join(fixtures,"test_validator.py")]);assert.match(negative.stdout+negative.stderr,/OK|ok/);
});
test("producer emits standing, run, nested and pending metadata using exact bindings and passes frozen validator",async t=>{
 const ctx=await setup(t);const panes=[1,2,3,4,5].map(n=>pane(n));ctx.listPanesFn=async()=>panes;
 await agent(ctx,"lead0001","lead",panes[0]);await agent(ctx,"rev00001","reviewer",panes[1]);await agent(ctx,"work0001","worker");await agent(ctx,"nest0001","implementer");
 const root=await workflow(ctx,"root",[{id:"work0001",role:"orchestrator",binding:panes[2],ready:true}]);
 await workflow(ctx,"child",[{id:"nest0001",role:"implementer",binding:panes[3]}],{depth:1,parent:{run_id:"root",run_dir:root,chain:["root"]}});
 await put(join(ctx.env.AGENT_ORCHESTRATION_STATE_HOME,"enrollments/pending/p.json"),{repo_id:ctx.consumer,incarnation:panes[4],session:"work",consumer:ctx.consumer});
 const producer=await createPresenceProducer(ctx);const snapshot=await producer.publish();
 assert.equal(snapshot.agents.length,5);
 const lead=snapshot.agents.find(a=>a.agentId==="lead0001");assert.equal(lead.repoRole,"lead");assert.equal(lead.runRole,null);assert.deepEqual(lead.memberships,[]);
 const worker=snapshot.agents.find(a=>a.agentId==="work0001");assert.equal(worker.repoRole,"member","run orchestrator never becomes repository lead");assert.equal(worker.runRole,"orchestrator");
 const child=snapshot.agents.find(a=>a.agentId==="nest0001");assert.equal(child.memberships[0].rootRunId,"root");assert.equal(child.memberships[0].depth,1);
 assert.equal(snapshot.agents.filter(a=>a.enrollment==="pending").length,1);
 const output=await readFile(producer.path,"utf8");assert.ok(!output.includes("DO NOT EMIT"));assert.ok(!output.includes("SECRET COMMAND"));
 await python([join(fixtures,"validate_presence.py"),producer.path]);
});
test("same agent in separate runs retains separate bindings, depth five resolves, orphan resemblance never affiliates",async t=>{
 const ctx=await setup(t);ctx.listPanesFn=async()=>[pane(1),pane(2),pane(3)];await agent(ctx,"same0001","worker");
 let previous=await workflow(ctx,"r0",[]);
 for(let depth=1;depth<=5;depth++) previous=await workflow(ctx,`r${depth}`,depth===5?[{id:"same0001",role:"worker",binding:pane(1)}]:[],{depth,parent:{run_id:`r${depth-1}`,run_dir:previous,chain:Array.from({length:depth},(_,i)=>`r${i}`)}});
 for(const [id,n] of [["orphan-a",2],["orphan-b",3]]) await workflow(ctx,id,[{id:"same0001",role:"worker",binding:pane(n)}],{depth:1,name:"same-workflow",parent:{run_id:"gone",run_dir:join(ctx.root,"missing"),chain:["identical"]}});
 const snapshot=await publishPresence(ctx);assert.equal(snapshot.agents.length,3);
 assert.equal(snapshot.agents[0].memberships[0].rootRunId,"r0");assert.equal(snapshot.agents[0].memberships[0].depth,5);
 assert.equal(snapshot.agents[1].memberships[0].rootRunId,null);assert.equal(snapshot.agents[2].memberships[0].rootRunId,null);
 assert.notEqual(snapshot.agents[1].primaryRunId,snapshot.agents[2].primaryRunId);
});
test("parent directory identity mismatch remains unresolved",async t=>{
 const ctx=await setup(t);ctx.listPanesFn=async()=>[pane(1)];const parent=await workflow(ctx,"actual",[]);
 await workflow(ctx,"child",[{id:"work0001",role:"worker",binding:pane(1)}],{depth:1,parent:{run_id:"claimed",run_dir:parent,chain:["same"]}});
 assert.equal((await publishPresence(ctx)).agents[0].memberships[0].rootRunId,null);
});
test("server restart and pane replacement remove membership instead of reattaching stale identity",async t=>{
 const ctx=await setup(t);let current=pane(1);ctx.listPanesFn=async()=>[current];await agent(ctx,"lead0001","lead",current);
 const producer=await createPresenceProducer(ctx);assert.equal((await producer.publish()).agents.length,1);
 current=pane(1,{serverPid:999});assert.deepEqual((await producer.publish()).agents,[]);
 current=pane(1,{panePid:999});assert.deepEqual((await producer.publish()).agents,[]);
 current=pane(1,{sessionCreated:999});assert.deepEqual((await producer.publish()).agents,[]);
});
test("name-only legacy registrations never authorize a current pane",async t=>{
 const ctx=await setup(t);ctx.listPanesFn=async()=>[pane(1)];await agent(ctx,"lead0001","lead");
 await put(join(ctx.env.AGENT_ORCHESTRATION_STATE_HOME,"leads/a.json"),{repo_id:ctx.consumer,agent_id:"lead0001",session:"display-1",pane:"%1"});
 assert.deepEqual((await publishPresence(ctx)).agents,[]);
});
test("generation allocation races fence all predecessors; revisions serialize and survive restarts",async t=>{
 const ctx=await setup(t);
 const producers=await Promise.all([1,2,3].map(()=>createPresenceProducer(ctx)));
 assert.equal(new Set(producers.map(p=>p.generation)).size,3);
 const latest=producers.find(p=>p.generation==="3");
 for(const p of producers.filter(p=>p!==latest)) await assert.rejects(p.publish(),e=>e.code==="TOPOLOGY_PRESENCE_FENCED");
 const snapshots=await Promise.all([1,2,3].map(()=>latest.publish()));assert.deepEqual(snapshots.map(s=>s.revision).sort(),["0","1","2"]);
 const restarted=await createPresenceProducer(ctx);const snapshot=await restarted.publish();assert.equal(snapshot.generation,"4");assert.equal(snapshot.revision,"0");
 await assert.rejects(latest.publish(),e=>e.code==="TOPOLOGY_PRESENCE_FENCED");
});
test("slow old collection cannot publish after a successor takes ownership",async t=>{
 const ctx=await setup(t);let release,entered;
 const suspended=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const old=await createPresenceProducer({...ctx,listPanesFn:async()=>{entered();await suspended;return [];}});
 const work=old.publish();await started;
 const replacement=await createPresenceProducer(ctx);await replacement.publish();const expected=await readFile(replacement.path,"utf8");
 release();await assert.rejects(work,e=>e.code==="TOPOLOGY_PRESENCE_FENCED");assert.equal(await readFile(replacement.path,"utf8"),expected);
});
test("generation corruption or deletion fails closed; large decimal counters stay strings",async t=>{
 const ctx=await setup(t);const producer=await createPresenceProducer(ctx);await producer.publish();const marker=join(dirname(producer.path),".generation");
 await writeFile(marker,'not-a-counter');await assert.rejects(producer.publish());await assert.rejects(createPresenceProducer(ctx));
 await rm(marker);await assert.rejects(createPresenceProducer(ctx),e=>e.code==="TOPOLOGY_PRESENCE_GENERATION");
 await writeFile(marker,"90071992547409930\n");const newer=await createPresenceProducer(ctx);assert.equal((await newer.publish()).generation,"90071992547409931");
});
test("independent repositories share monotonic allocator without fencing each other",async t=>{
 const ctx=await setup(t);const other=join(ctx.root,"other");await mkdir(other);
 const a=await createPresenceProducer(ctx),b=await createPresenceProducer({...ctx,consumer:other});
 assert.equal((await a.publish()).generation,"1");assert.equal((await b.publish()).generation,"2");assert.equal((await a.publish()).revision,"1");
});
test("heartbeat republishes complete snapshots within TTL thirds and stops on abort",async t=>{
 const ctx=await setup(t);const producer=await createPresenceProducer({...ctx,staleAfterMs:1000});const controller=new AbortController(),times=[],revisions=[];
 await producer.watch({signal:controller.signal,onPublish:snapshot=>{times.push(Date.now());revisions.push(snapshot.revision);if(times.length===3)controller.abort();}});
 assert.deepEqual(revisions,["0","1","2"]);assert.ok(times[2]-times[0]<1200);
});
test("configured directory and bounds honor the frozen contract",async t=>{
 const ctx=await setup(t);const presenceDir=join(ctx.root,"configured");await put(join(ctx.home,".config/agent-orchestration/config.json"),{presenceDir});
 const producer=await createPresenceProducer(ctx);assert.equal(dirname(producer.path),presenceDir);
 for(const value of [true,999,300001]) await assert.rejects(createPresenceProducer({...ctx,staleAfterMs:value}),e=>e.code==="TOPOLOGY_PRESENCE_BOUNDS");
 for(const value of [true,-1,30001]) await assert.rejects(createPresenceProducer({...ctx,clockSkewToleranceMs:value}),e=>e.code==="TOPOLOGY_PRESENCE_BOUNDS");
});
test("failed enumeration preserves the previous complete snapshot",async t=>{
 const ctx=await setup(t);let broken=false;ctx.listPanesFn=async()=>{if(broken)throw Error("unknown tmux state");return [];};
 const producer=await createPresenceProducer(ctx);await producer.publish();const before=await readFile(producer.path,"utf8");broken=true;
 await assert.rejects(producer.publish(),/unknown tmux/);assert.equal(await readFile(producer.path,"utf8"),before);
});

test("all linked worktrees publish into the main checkout repository identity",async t=>{
 const ctx=await setup(t),linked=join(ctx.root,"linked");
 await run("git",["init","-q",ctx.consumer]);
 await run("git",["-C",ctx.consumer,"-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-q","--allow-empty","-m","fixture"]);
 await run("git",["-C",ctx.consumer,"worktree","add","-q","-b","fixture-linked",linked]);
 await agent(ctx,"lead0001","lead",pane(1));
 await workflow({...ctx,consumer:linked},"linked-run",[{id:"work0001",role:"worker",binding:pane(2)}]);
 ctx.listPanesFn=async()=>[pane(1),pane(2)];
 const main=await publishPresence(ctx),other=await publishPresence({...ctx,consumer:linked});
 assert.equal(main.repositoryKey,other.repositoryKey);assert.equal(other.repositoryRoot,ctx.consumer);assert.equal(main.agents.length,2);assert.equal(other.agents.length,2);
});
test("real isolated tmux pane observation publishes only its exact standing incarnation",async t=>{
 try {await run("tmux",["-V"]);} catch {t.skip("tmux unavailable");return;}
 const ctx=await setup(t),server=join(ctx.root,"presence.sock");
 t.after(()=>run("tmux",["-S",server,"kill-server"]).catch(()=>{}));
 await run("tmux",["-S",server,"-f","/dev/null","new-session","-d","-s","arbitrary","-c",ctx.consumer,"sleep","30"]);
 const {listServerPanes}=await import("../../topology/lib/tmux.mjs");
 const [observed]=await listServerPanes({tmuxServer:server,env:ctx.env});
 await agent(ctx,"lead0001","lead",observed);
 const producer=await createPresenceProducer({...ctx,listPanesFn:listServerPanes});
 const snapshot=await producer.publish();assert.equal(snapshot.agents.length,1);assert.equal(snapshot.agents[0].session.serverKey,server);
 await python([join(fixtures,"validate_presence.py"),producer.path]);
 await run("tmux",["-S",server,"kill-session","-t","arbitrary"]);
 assert.deepEqual((await producer.publish()).agents,[]);
});

test("spawn metadata is explicit, validated, and preserves library standing independently of run role",async t=>{
 const ctx=await setup(t);const observed=pane(1,{sessionName:"work0001-abcdef1"});ctx.listPanesFn=async()=>[observed];
 await agent(ctx,"work0001","worker");await workflow(ctx,"spawn-run",[{id:"work0001",role:"orchestrator",binding:observed,spawn:"abcdef1"}]);
 const producer=await createPresenceProducer(ctx),snapshot=await producer.publish();assert.equal(snapshot.agents[0].session.kind,"spawn");assert.equal(snapshot.agents[0].repoRole,"member");
 await python([join(fixtures,"validate_presence.py"),producer.path]);
});
test("multiple library leads refuse publication and preserve prior metadata",async t=>{
 const ctx=await setup(t),producer=await createPresenceProducer(ctx);await producer.publish();const original=await readFile(producer.path,"utf8");
 await agent(ctx,"lead0001","lead",pane(1));await agent(ctx,"lead0002","lead",pane(2));
 await assert.rejects(producer.publish(),e=>e.code==="TOPOLOGY_PRESENCE_MULTIPLE_STANDING");assert.equal(await readFile(producer.path,"utf8"),original);
});
test("concurrent snapshot readers only observe complete JSON documents",async t=>{
 const ctx=await setup(t),producer=await createPresenceProducer(ctx);await producer.publish();let publishing=true,reads=0;
 const reader=(async()=>{while(publishing){const snapshot=JSON.parse(await readFile(producer.path,"utf8"));assert.equal(snapshot.schemaVersion,1);assert.ok(Array.isArray(snapshot.agents));reads++;}})();
 try {for(let i=0;i<10;i++)await producer.publish();} finally {publishing=false;await reader;}
 assert.ok(reads>0);assert.equal(JSON.parse(await readFile(producer.path,"utf8")).revision,"10");
});
