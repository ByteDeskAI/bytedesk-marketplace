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
  assert.deepEqual(argv, ["claude", "--verbose", "--model", "opus", "--append-system-prompt", "SP", "--dangerously-skip-permissions"]);
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
 const runDir=await fakeRun();t.after(()=>rm(runDir,{recursive:true,force:true}));
 const run=JSON.parse(await readFile(join(runDir,'run.json'),'utf8'));run.agents[1].pane='%999';await writeJson(join(runDir,'run.json'),run);
 const bin=join(runDir,'bin'),marker=join(runDir,'unsafe-tmux-call');await mkdir(bin);
 await writeFile(join(bin,'tmux'),'#!/bin/sh\nprintf unsafe > "$AO_TEST_MARKER"\nexit 0\n',{mode:0o755});
 const cli=fileURLToPath(new URL('../../topology/cli.mjs',import.meta.url));
 const result=await exec(process.execPath,[cli,'send','--run',runDir,'--from-project',runDir,'--from','conductor','--to','a','--body','Wait in the inbox.','--json'],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,AO_TEST_MARKER:marker}});
 const output=JSON.parse(result.stdout);assert.equal(output.delivered[0].rang,false);assert.equal(output.delivered[0].notification,'durable-pending');
 await assert.rejects(readFile(marker),{code:'ENOENT'});
 assert.match(await readFile(output.deliveries[0].inbox,'utf8'),/Wait in the inbox/);
});
