import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { leadQueueDepth, pendingReplies, queueDepth, readJournal, recordReply, sendMessage, waitForReplies } from "../../topology/lib/mailbox.mjs";
import { adapterFor, buildArgv, loadAdapters } from "../../topology/lib/providers.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

async function fakeRun() {
  const runDir = await mkdtemp(join(os.tmpdir(), "ao-topology-run-"));
  await writeJson(join(runDir, "run.json"), {
    consumer: runDir,
    version: 1,
    name: "t",
    run_id: "r1",
    session: "t-r1",
    sequence: 0,
    agents: [
      { id: "conductor", role: "orchestrator" },
      { id: "a", role: "worker" },
      { id: "b", role: "worker" },
    ],
  });
  return runDir;
}

test("sendMessage writes one inbox file per recipient and journals it", async () => {
  const runDir = await fakeRun();
  try {
    const message = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a", "b"], stage: "brief", body: "Do the thing.", contract: "x.v1", round: 1 });
    assert.equal(message.id, "001-brief");
    assert.equal(message.deliveries.length, 2);
    const inbox = await readFile(message.deliveries[0].inbox, "utf8");
    assert.match(inbox, /^---\nid: 001-brief\nfrom: conductor\nto: a\nstage: brief\nround: 1\ncontract: x.v1/);
    assert.match(inbox, /Do the thing\./);
    assert.match(inbox, /Write your complete reply to: .*001-brief\.reply\.md/);
    const pending = await pendingReplies(runDir);
    assert.deepEqual(pending.map((item) => `${item.agent}:${item.id}`), ["a:001-brief", "b:001-brief"]);
    const journal = await readJournal(runDir);
    assert.equal(journal.at(-1).type, "message.sent");
    await assert.rejects(sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["ghost"], stage: "x", body: "y" }), /Unknown agent "ghost"/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("waitForReplies resolves when every reply file exists and times out otherwise", async () => {
  const runDir = await fakeRun();
  try {
    const message = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a", "b"], stage: "brief", body: "Do the thing." });
    const timeout = await waitForReplies({ runDir, agentIds: ["a", "b"], messageId: message.id, timeoutMs: 200, pollMs: 50 });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.pending.length, 2);

    setTimeout(() => recordReply({ runDir, agentId: "a", messageId: message.id, body: "done a" }), 60);
    setTimeout(() => recordReply({ runDir, agentId: "b", messageId: message.id, body: "done b" }), 120);
    const result = await waitForReplies({ runDir, agentIds: ["a", "b"], messageId: message.id, timeoutMs: 5000, pollMs: 50 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.replies.map((reply) => [reply.agent, reply.body.trim()]), [["a", "done a"], ["b", "done b"]]);
    const journal = await readJournal(runDir);
    assert.ok(journal.some((event) => event.type === "wait.timeout"));
    assert.ok(journal.some((event) => event.type === "message.replied" && event.from === "b"));
    assert.equal(journal.at(-1).type, "wait.satisfied");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("adapters: unknown cli falls back to generic with the id as command; argv order is stable", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  assert.ok(adapters.has("claude"));
  assert.ok(adapters.has("generic"));
  const aider = adapterFor({ cli: "aider", args: ["--no-git"], skills: [] }, adapters);
  assert.equal(aider.fallback, true);
  assert.equal(aider.command, "aider");
  const claude = adapterFor({ cli: "claude", model: "opus", auto_approve: true, args: [], skills: [] }, adapters);
  const argv = buildArgv(claude, { cli: "claude", model: "opus", auto_approve: true, args: ["--verbose"], skills: [] }, { system_prompt: "SP", bootstrap_file: "/b" });
  // `--strict-mcp-config` is the provider's own arg and comes first, ahead of the agent's. It is in
  // this expectation deliberately rather than relaxed away: the point of the assertion is that argv
  // ORDER is pinned — provider args, then agent args, then model, prompt, auto-approve — and a
  // provider arg appearing anywhere else would be the bug this test exists to catch.
  assert.deepEqual(argv, ["claude", "--strict-mcp-config", "--verbose", "--model", "opus", "--append-system-prompt", "SP", "--dangerously-skip-permissions"]);
});

test("queue depth counts what each agent still owes, and a run with no lead reports no lead queue", async () => {
  const runDir = await fakeRun();
  try {
    assert.deepEqual(await leadQueueDepth(runDir), [], "a run with no lead has no lead queue to watch");
    assert.deepEqual((await queueDepth(runDir, ["a"])).map((r) => r.depth), [0], "an idle agent reads zero, not nothing");

    const first = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a", "b"], stage: "brief", body: "One." });
    await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a"], stage: "brief", body: "Two." });

    const depths = await queueDepth(runDir, ["a", "b"]);
    assert.deepEqual(depths.map((r) => [r.agent, r.depth]), [["a", 2], ["b", 1]], "deepest queue first");
    assert.ok(depths[0].oldest_age_ms >= 0, "the message that has waited longest has an age");

    await recordReply({ runDir, agentId: "a", messageId: first.id, body: "Answered one." });
    assert.equal((await queueDepth(runDir, ["a"]))[0].depth, 1, "answering drains the queue");

    // An empty reply is not an answer, so it must not drain it either.
    const stillOwed = (await pendingReplies(runDir, ["a"]))[0];
    await writeFile(stillOwed.outbox, "   \n", "utf8");
    assert.equal((await queueDepth(runDir, ["a"]))[0].depth, 1, "a blank file leaves the work outstanding");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('workflow forwarding reads persisted source/task/ancestry, revalidates child admission, and deduplicates retries',async t=>{
 const {forwardMessageToWorkflow}=await import('../../topology/lib/mailbox.mjs');
 const {readStandingOutbox}=await import('../../topology/lib/standing-mailbox.mjs');
 const {mkdir}=await import('node:fs/promises');
 const root=await mkdtemp(join(os.tmpdir(),'ao-forward-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const parent=join(root,'parent'),child=join(root,'child'),consumer=join(root,'repo-a'),childConsumer=join(root,'repo-b');
 await Promise.all([parent,child,consumer,childConsumer].map(dir=>mkdir(dir,{recursive:true})));
 await writeJson(join(parent,'run.json'),{run_id:'parent-run',consumer,sequence:0,parent:{run_id:'outer-run',chain:['outer'],depth:1},depth:1,agents:[{id:'team0001',role:'worker',workflow:{run_dir:child,conductor:'lead0001',name:'child-work'}}]});
 await writeJson(join(child,'run.json'),{run_id:'child-run',consumer:childConsumer,sequence:0,agents:[{id:'lead0001',role:'orchestrator'}]});
 await writeJson(join(childConsumer,'.bytedesk/agent-orchestration/agents/lead0001/agent.json'),{id:'lead0001',role:'lead'});
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,'state'),AO_CONSUMER:childConsumer};
 const sent=await sendMessage({runDir:parent,fromProject:consumer,from:'author01',to:['team0001'],stage:'ask',body:'Original body',task:'TM-42',via:['ancestor'],provenance:{root:'origin'},idempotencyKey:'parent-id',env});
 const blocked=await forwardMessageToWorkflow({runDir:parent,messageId:sent.id,recipient:'team0001',env,standingOptions:{readiness:async()=>({status:'unresponsive'})}});
 assert.equal(blocked.deliveries.length,0);assert.equal(blocked.holds[0].reason,'leads_not_ready');
 const [held]=await readStandingOutbox({consumer,agent:'author01',env});
 assert.equal(held.envelope.fromProject,consumer,'forwarder env cannot replace original source');
 assert.equal(held.envelope.task,'TM-42');assert.equal(held.envelope.body,'Original body');assert.deepEqual(held.envelope.via,['ancestor','team0001']);
 const childState=JSON.parse(await readFile(join(child,'run.json'),'utf8'));const snapshot=childState.message_envelopes[blocked.id];
 assert.equal(snapshot.parentId,sent.id);assert.deepEqual(snapshot.provenance.original,{root:'origin'});assert.deepEqual(snapshot.provenance.lineage,{run_id:'outer-run',chain:['outer'],depth:1});
 const options={readiness:async()=>({status:'responsive',record:{agent_id:'lead0001'},library_lead:'lead0001'})};
 const accepted=await forwardMessageToWorkflow({runDir:parent,messageId:sent.id,recipient:'team0001',env,standingOptions:options});
 assert.equal(accepted.id,blocked.id);assert.equal(accepted.deliveries[0].agent,'lead0001');
 const retry=await forwardMessageToWorkflow({runDir:parent,messageId:sent.id,recipient:'team0001',env,standingOptions:options});assert.equal(retry.id,accepted.id);
 assert.equal((await readStandingOutbox({consumer,agent:'author01',env})).length,1);
 await assert.rejects(forwardMessageToWorkflow({runDir:parent,messageId:sent.id,recipient:'other',env}),{code:'TOPOLOGY_WORKFLOW_FORWARD_INVALID'});
});

test('CLI send persists notification without injecting a live terminal composer',async t=>{
 const {mkdir}=await import('node:fs/promises');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const {fileURLToPath}=await import('node:url');const exec=promisify(execFile);
 const runDir=await fakeRun();
 // `send` self-starts a repository supervisor (TM-127), and that detached child outlives `send`.
 // Measured on this branch: every tmux call the shim saw came from `cli.mjs supervise`, none from
 // `send` — the child's first tick lists panes, and TM-162 made `send` wait for the child to take
 // its lock, so the old "the shim never ran" assertion stopped winning that race. The child must
 // be reaped BEFORE runDir goes: once the shim is deleted its PATH falls through to the real tmux,
 // and its watcher asks for `-L default`. TMUX:'' and TMUX_TMPDIR keep even that off the
 // operator's server (.claude/rules/tmux-test-isolation.md); this test never starts or kills a server.
 let supervisorPid=null;
 const reapSupervisor=async()=>{
   const pid=supervisorPid;supervisorPid=null;if(!pid) return;
   try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}
   for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{break;}await new Promise(r=>setTimeout(r,50));}
 };
 t.after(async()=>{ await reapSupervisor(); await rm(runDir,{recursive:true,force:true}); });
 const run=JSON.parse(await readFile(join(runDir,'run.json'),'utf8'));run.agents[1].pane='%999';await writeJson(join(runDir,'run.json'),run);
 const bin=join(runDir,'bin'),calls=join(runDir,'tmux-calls.log'),tmuxTmp=join(runDir,'tmux');await mkdir(bin);await mkdir(tmuxTmp);
 // One line per call: the caller's pid, the caller's command line, and the arguments. A value, not
 // a bit — "was tmux called" cannot tell a send-path regression from the supervisor's own reads.
 await writeFile(join(bin,'tmux'),'#!/bin/sh\nprintf \'%s\\037%s\\037%s\\n\' "$PPID" "$(ps -o args= -p $PPID)" "$*" >> "$AO_TEST_TMUX_LOG"\nexit 0\n',{mode:0o755});
 const env={...process.env,TMUX:'',TMUX_TMPDIR:tmuxTmp,PATH:`${bin}:${process.env.PATH}`,AO_TEST_TMUX_LOG:calls,AO_TMUX_COMMAND:undefined,
   // Pin the state home, or `send` spawns a real daemon into ~/.local/state (how TM-139's orphans appeared).
   AGENT_ORCHESTRATION_STATE_HOME:join(runDir,'state')};
 const readCalls=async()=>(await readFile(calls,'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>{const [ppid,caller,args]=line.split('\x1f');return {ppid:Number(ppid),caller,args:args.split(/\s+/)};});
 // Coverage first: prove the shim intercepts `tmux` in this env, so an empty log below means "not called".
 await exec('tmux',['-V'],{env});
 assert.equal((await readCalls()).filter(c=>c.ppid===process.pid).length,1,'the tmux shim must be reachable on PATH, or the assertions below cannot fail');
 const cli=fileURLToPath(new URL('../../topology/cli.mjs',import.meta.url));
 const output=JSON.parse((await exec(process.execPath,[cli,'send','--run',runDir,'--from-project',runDir,'--from','conductor','--to','a','--body','Wait in the inbox.','--json'],{env})).stdout);
 supervisorPid=Number.isInteger(output.supervision?.pid)?output.supervision.pid:null;
 assert.equal(output.delivered[0].rang,false);assert.equal(output.delivered[0].notification,'durable-pending');
 // Let the supervisor reach tmux (bounded), then stop it and judge its whole lifetime, so the
 // allowlist below is tested against real calls rather than passing over an empty log.
 const SUPERVISOR=/cli\.mjs supervise\b/;
 for(let i=0;supervisorPid&&i<200&&!(await readCalls()).some(c=>SUPERVISOR.test(c.caller));i++) await new Promise(r=>setTimeout(r,50));
 await reapSupervisor();
 const seen=(await readCalls()).filter(c=>c.ppid!==process.pid), log=seen.map(c=>`ppid=${c.ppid} caller=${c.caller} args=${c.args.join(' ')}`).join('\n')||'(none)';
 // An allowlist, not "ppid is not send": a tmux call send made through a shell or helper child
 // would carry that intermediary's ppid and slip past a send-pid filter.
 assert.deepEqual(seen.filter(c=>!SUPERVISOR.test(c.caller)),[],`only the spawned supervisor may run tmux — never send, nor anything send starts; calls:\n${log}`);
 // tmux command names and their aliases that put input into a pane.
 const writes=new Set(['send-keys','send','send-prefix','paste-buffer','pasteb','load-buffer','loadb','set-buffer','setb']);
 assert.deepEqual(seen.filter(c=>c.args.some(a=>writes.has(a))),[],`nothing may send keys, paste, or load a buffer; calls:\n${log}`);
 assert.match(await readFile(output.deliveries[0].inbox,'utf8'),/Wait in the inbox/);
});
