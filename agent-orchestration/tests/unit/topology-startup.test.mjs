import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  afterSessionOpen,
  clearPendingEnrollment,
  hooksStatus,
  hookSupport,
  installHooks,
  pendingEnrollments,
  startupCheck,
  uninstallHooks,
  watchServer,
} from "../../topology/lib/startup.mjs";
import { loadAdapters } from "../../topology/lib/providers.mjs";
import { stateRoot } from "../../topology/lib/repoid.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(here, "..", "..", "providers");

const scratch = () => mkdtemp(join(tmpdir(), "ao-startup-"));

const CLAUDE = {
  id: "claude",
  hooks: { kind: "claude-settings", path: "~/.claude/settings.json", event: "SessionStart" },
};
const HOOKLESS = { id: "kimi", hooks: null };

const envFor = (root) => ({ AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") });

async function readSettings(home) {
  return JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
}

test("installHooks preserves unrelated hook entries and unrelated top-level keys", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, ".claude"), { recursive: true });
  const foreign = { matcher: "startup", hooks: [{ type: "command", command: "/usr/local/bin/other-tool on-start" }] };
  await writeFile(
    join(home, ".claude", "settings.json"),
    `${JSON.stringify({
      model: "opus",
      env: { FOO: "bar" },
      hooks: {
        SessionStart: [foreign],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }],
      },
    }, null, 2)}\n`,
  );

  const result = await installHooks({ adapter: CLAUDE, cliBin: "/usr/local/bin/ao-topology", home, env: envFor(root) });
  assert.equal(result.installed, true);
  assert.equal(result.created, false);

  const settings = await readSettings(home);
  assert.equal(settings.model, "opus", "unrelated top-level key preserved");
  assert.deepEqual(settings.env, { FOO: "bar" });
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }], "unrelated event preserved");
  assert.equal(settings.hooks.SessionStart.length, 2);
  assert.deepEqual(settings.hooks.SessionStart[0], foreign, "foreign SessionStart entry preserved");
  const ours = settings.hooks.SessionStart[1];
  assert.equal(ours.matcher, "");
  assert.equal(ours.hooks[0].type, "command");
  assert.match(ours.hooks[0].command, /startup-check --source hook/);
  assert.ok(ours.hooks[0].command.startsWith("'/usr/local/bin/ao-topology' "));
});

test("installHooks is idempotent: installing twice yields exactly one entry", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");

  const first = await installHooks({ adapter: CLAUDE, cliBin: "/bin/ao", home, env: envFor(root) });
  const again = await installHooks({ adapter: CLAUDE, cliBin: "/bin/ao", home, env: envFor(root) });
  assert.equal(first.created, true, "the first install created the missing file");
  assert.equal(again.created, false, "the second found it already there");

  const settings = await readSettings(home);
  assert.equal(settings.hooks.SessionStart.length, 1, "one entry, not two");
  const status = await hooksStatus({ adapter: CLAUDE, home, env: envFor(root) });
  assert.deepEqual({ supported: status.supported, installed: status.installed, entries: status.entries }, { supported: true, installed: true, entries: 1 });
});

test("uninstallHooks removes only our entry, leaving foreign SessionStart entries and the file", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, ".claude"), { recursive: true });
  const foreign = { matcher: "", hooks: [{ type: "command", command: "someone-else on-start" }] };
  await writeFile(
    join(home, ".claude", "settings.json"),
    `${JSON.stringify({ theme: "dark", hooks: { SessionStart: [foreign] } }, null, 2)}\n`,
  );

  await installHooks({ adapter: CLAUDE, cliBin: "/bin/ao", home, env: envFor(root) });
  const before = await readSettings(home);
  assert.equal(before.hooks.SessionStart.length, 2);

  const result = await uninstallHooks({ adapter: CLAUDE, home, env: envFor(root) });
  assert.equal(result.removed, 1);
  const after = await readSettings(home);
  assert.equal(after.theme, "dark", "unrelated top-level key survives uninstall");
  assert.deepEqual(after.hooks.SessionStart, [foreign], "foreign entry survives; only ours went");
  const status = await hooksStatus({ adapter: CLAUDE, home, env: envFor(root) });
  assert.equal(status.installed, false);

  const again = await uninstallHooks({ adapter: CLAUDE, home, env: envFor(root) });
  assert.equal(again.removed, 0, "uninstalling twice is a no-op");
});

test("corrupt settings file: install fails with TOPOLOGY_STARTUP_HOOKS and the file is untouched", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, ".claude"), { recursive: true });
  const corrupt = "{ this is not json !!!";
  const path = join(home, ".claude", "settings.json");
  await writeFile(path, corrupt);

  await assert.rejects(
    () => installHooks({ adapter: CLAUDE, cliBin: "/bin/ao", home, env: envFor(root) }),
    (error) => {
      assert.equal(error.name, "TopologyError");
      assert.equal(error.code, "TOPOLOGY_STARTUP_HOOKS");
      return true;
    },
  );
  assert.equal(await readFile(path, "utf8"), corrupt, "the corrupt file was not overwritten");
});

test("an adapter without a hooks capability cannot install hooks, and reports unsupported", async () => {
  assert.equal(hookSupport(HOOKLESS), null);
  await assert.rejects(
    () => installHooks({ adapter: HOOKLESS, cliBin: "/bin/ao", home: "/tmp/nope", env: {} }),
    (error) => error.code === "TOPOLOGY_STARTUP_HOOKS",
  );
  const status = await hooksStatus({ adapter: HOOKLESS, home: "/tmp/nope", env: {} });
  assert.deepEqual(status, { supported: false, installed: false, path: null, event: null, entries: 0 });
});

test("startupCheck labels an unregistered session pending-enrollment and journals it", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const consumer = join(root, "repo");
  await mkdir(consumer, { recursive: true });

  const result = await startupCheck({ consumer, source: "hook", agentId: "abc1234", session: "abc1234-deadbe1", pane: "%7", env, home: join(root, "home") });
  assert.deepEqual({ registered: result.registered, labelled: result.labelled }, { registered: false, labelled: true });

  const pending = await pendingEnrollments({ env, home: join(root, "home") });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].session, "abc1234-deadbe1");
  assert.equal(pending[0].pane, "%7");
  assert.equal(pending[0].consumer, consumer);
  assert.equal(pending[0].source, "hook");
  assert.equal(pending[0].label, "pending-enrollment");
  assert.equal(pending[0].note, "detected after startup; nothing was blocked or pre-empted");
  assert.ok(pending[0].detected_at);

  // Journaled under the consumer's canonical repo key.
  const startupDir = join(stateRoot(env, join(root, "home")), "startup");
  const journals = await readdir(startupDir);
  assert.equal(journals.length, 1);
  assert.match(journals[0], /^[0-9a-f]{16}\.jsonl$/);
  const lines = (await readFile(join(startupDir, journals[0]), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.source, "hook");
  assert.equal(record.agentId, "abc1234");
  assert.equal(record.session, "abc1234-deadbe1");
  assert.equal(record.consumer, consumer);

  // A repeat detection does not rewrite the first label.
  const again = await startupCheck({ consumer, source: "hook", agentId: "abc1234", session: "abc1234-deadbe1", env, home: join(root, "home") });
  assert.deepEqual({ registered: again.registered, labelled: again.labelled }, { registered: false, labelled: true });
  assert.equal((await pendingEnrollments({ env, home: join(root, "home") })).length, 1);
});

test("startupCheck does not label a session a lead/reviewer registration claims", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const home = join(root, "home");
  const consumer = join(root, "repo");
  await mkdir(consumer, { recursive: true });
  const state = stateRoot(env, home);
  await mkdir(join(state, "leads"), { recursive: true });
  await writeFile(
    join(state, "leads", "abc123def4567890.json"),
    `${JSON.stringify({ repo_id: consumer, agent_id: "lead001", session: "ao-lead001", role: "lead" }, null, 2)}\n`,
  );
  await mkdir(join(state, "reviewers"), { recursive: true });
  await writeFile(
    join(state, "reviewers", "fedcba0987654321.json"),
    `${JSON.stringify({ repo_id: consumer, agent_id: "rev0001", session: "rev0001-1234abc", role: "reviewer" }, null, 2)}\n`,
  );

  const lead = await startupCheck({ consumer, source: "hook", session: "ao-lead001", env, home });
  assert.deepEqual({ registered: lead.registered, labelled: lead.labelled }, { registered: true, labelled: false });
  const reviewer = await startupCheck({ consumer, source: "hook", session: "rev0001-1234abc", env, home });
  assert.deepEqual({ registered: reviewer.registered, labelled: reviewer.labelled }, { registered: true, labelled: false });
  assert.equal((await pendingEnrollments({ env, home })).length, 0);
});

test("afterSessionOpen is the managed-launch source", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const home = join(root, "home");
  const consumer = join(root, "repo");
  await mkdir(consumer, { recursive: true });

  const result = await afterSessionOpen({ consumer, session: "zz99999-abcdef0", env, home });
  assert.deepEqual({ registered: result.registered, labelled: result.labelled }, { registered: false, labelled: true });
  const pending = await pendingEnrollments({ env, home });
  assert.equal(pending[0].source, "managed-launch");
});

function observed(cwd, serverKey="server-a", sessionName="work", overrides={}) {
  return { serverKey, serverPid: 1, sessionId: "$" + sessionName, sessionCreated: 100, paneId: "%1", panePid: 2, sessionName, command: "kimi", cwd, ...overrides };
}
test("watcher detects arbitrary provider sessions, rejects unrelated processes and selects server", async t => {
  const root = await scratch(); t.after(() => rm(root,{recursive:true,force:true}));
  const env = envFor(root); const seen=[];
  for(const server of ["alpha","beta"]) {
    const result = await watchServer({env, once:true, tmuxServer:server, listPanesFn:async options => { seen.push(options.tmuxServer); return [observed(root,server),observed(root,server,"editor",{command:"vim"}),observed(root,server,"shell",{command:"zsh"})]; }});
    assert.deepEqual(result.labelled,["work"]);
  }
  assert.deepEqual(seen,["alpha","alpha","beta","beta"]);
  const pending=await pendingEnrollments({env}); assert.equal(pending.length,2);
  assert.ok(pending.every(r=>r.consumer===root && r.repo_id===root && r.incarnation.paneId==="%1"));
});
test("pending identity separates repos, punctuation and pane incarnations; registration never suppresses another repo", async t => {
  const root=await scratch(); t.after(()=>rm(root,{recursive:true,force:true})); const env=envFor(root);
  const a=join(root,"a"), b=join(root,"b"); await mkdir(a); await mkdir(b);
  const state=stateRoot(env); await mkdir(join(state,"leads"),{recursive:true});
  const pane=observed(a);
  await writeFile(join(state,"leads","a.json"),JSON.stringify({repo_id:a,session:"work",incarnation:pane}));
  const result=await watchServer({env,once:true,listPanesFn:async()=>[pane,observed(b),observed(b,"server-a","a:b"),observed(b,"server-a","a/b"),observed(b,"server-a","work",{panePid:3})]});
  assert.equal(result.labelled.length,4);
  const pending=await pendingEnrollments({env}); assert.equal(pending.length,4); assert.equal(new Set(pending.map(r=>r.key)).size,4);
  await assert.rejects(clearPendingEnrollment({env,session:"work"}),/Multiple pending/);
  assert.equal(await clearPendingEnrollment({env,key:pending[0].key}),true);
});
test("watcher fences a suspended owner after explicit dead-owner takeover", async t=>{
  const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const env=envFor(root);
  let release,entered;const waiting=new Promise(r=>entered=r);const stall=new Promise(r=>release=r);
  let calls=0;
  const a=watchServer({env,once:true,intervalMs:1,listPanesFn:async()=>{if(calls++>0){entered();await stall;}return [observed(root)];}});
  await waiting;await new Promise(r=>setTimeout(r,10));
  const refused=await watchServer({env,once:true,intervalMs:1,listPanesFn:async()=>[observed(root)]});assert.equal(refused.acquired,false,"clock age never evicts a living owner");
  const b=await watchServer({env,once:true,ownerAliveFn:()=>false,listPanesFn:async()=>[observed(root)]});assert.equal(b.acquired,true);
  const dir=join(stateRoot(env),"watchers"),file=(await readdir(dir)).find(n=>n.endsWith(".json"));const before=await readFile(join(dir,file),"utf8");
  release();const old=await a;assert.equal(old.fenced,true);assert.deepEqual(old.labelled,[]);assert.equal(await readFile(join(dir,file),"utf8"),before);assert.equal((await pendingEnrollments({env})).length,1);
});
test("two concurrent watcher acquisitions permit only one owner",async t=>{
 const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const env=envFor(root);
 const results=await Promise.all([1,2].map(()=>watchServer({env,once:true,listPanesFn:async()=>[observed(root)]})));
 assert.equal(results.filter(r=>r.acquired).length,1);assert.equal((await pendingEnrollments({env})).length,1);
});

test("pendingEnrollments and clearPendingEnrollment round trip", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const home = join(root, "home");
  const consumer = join(root, "repo");
  await mkdir(consumer, { recursive: true });

  assert.deepEqual(await pendingEnrollments({ env, home }), []);
  await startupCheck({ consumer, source: "hook", session: "one1111-0000000", env, home });
  await startupCheck({ consumer, source: "hook", session: "two2222-1111111", env, home });
  assert.equal((await pendingEnrollments({ env, home })).length, 2);

  assert.equal(await clearPendingEnrollment({ env, home, session: "one1111-0000000" }), true);
  assert.equal(await clearPendingEnrollment({ env, home, session: "one1111-0000000" }), false, "clearing twice is a no-op");
  const remaining = await pendingEnrollments({ env, home });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].session, "two2222-1111111");
});

test("the claude adapter's hooks capability survives loadAdapters; kimi and codex honestly have none", async () => {
  const adapters = await loadAdapters([PROVIDERS_DIR]);
  const claude = adapters.get("claude");
  assert.deepEqual(hookSupport(claude), { kind: "claude-settings", path: "~/.claude/settings.json", event: "SessionStart" });
  assert.equal(hookSupport(adapters.get("kimi")), null, "no observed hook mechanism for kimi — no invented coverage");
  assert.equal(hookSupport(adapters.get("codex")), null);
});

test("install/uninstall preserve hook siblings and a foreign startup-check command",async t=>{
 const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const home=root;
 await installHooks({adapter:CLAUDE,cliBin:"/bin/ao",home});const settings=await readSettings(home);
 const foreign=["other startup-check","two","three"].map(command=>({type:"command",command}));
 settings.hooks.SessionStart[0].hooks.push(...foreign);await writeFile(join(home,".claude/settings.json"),JSON.stringify(settings));
 await installHooks({adapter:CLAUDE,cliBin:"/bin/ao",home});await uninstallHooks({adapter:CLAUDE,home});
 assert.deepEqual((await readSettings(home)).hooks.SessionStart,[{matcher:"",hooks:foreign}]);
});
test("concurrent installs preserve unrelated settings bytes and contain one managed hook",async t=>{
 const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const home=root;await mkdir(join(home,".claude"));
 const prefix='{ "model" : "opus", "env":{"X":1}, "hooks": {"Other" : [ { "custom": true } ], "SessionStart": ';
 const suffix=' }, "tail" : [1,  2] }\n';const path=join(home,".claude/settings.json");await writeFile(path,prefix+'[]'+suffix);
 await Promise.all([1,2].map(()=>installHooks({adapter:CLAUDE,cliBin:"/bin/ao",home})));
 let text=await readFile(path,"utf8");assert.ok(text.startsWith(prefix));assert.ok(text.endsWith(suffix));assert.equal((await hooksStatus({adapter:CLAUDE,home})).entries,1);
 await uninstallHooks({adapter:CLAUDE,home});assert.equal(await readFile(path,"utf8"),prefix+'[]'+suffix);
});
test("quoted hook executable with spaces and apostrophe executes as one path",async t=>{
 const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const bin=join(root,"agent's executable");const output=join(root,"output");
 await writeFile(bin,'#!/bin/sh\nprintf "%s\\n" "$@" > "'+output+'"\n');await chmod(bin,0o700);
 await installHooks({adapter:CLAUDE,cliBin:bin,home:root});const command=(await readSettings(root)).hooks.SessionStart[0].hooks[0].command;
 await promisify(execFile)("sh",["-c",command]);assert.equal(await readFile(output,"utf8"),"startup-check\n--source\nhook\n");
 assert.equal((await hooksStatus({adapter:CLAUDE,home:root})).installed,true);
});
test("native and managed startup offer receiving-repository lead readiness; watcher stays eventual",async t=>{
 const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const env=envFor(root);
 const hook=await startupCheck({consumer:root,source:"hook",env});assert.equal(hook.readiness.state,"offer");assert.ok(hook.readiness.command.includes(root));
 const managed=await afterSessionOpen({consumer:root,env,readinessFn:async()=>({state:"verified"})});assert.equal(managed.readiness.state,"verified");
 const eventual=await startupCheck({consumer:root,source:"watcher",env});assert.equal(eventual.readiness.state,"eventual");
});

test("real isolated tmux servers bind hookless provider panes to repository cwd", async t => {
  const run = promisify(execFile);
  try { await run("tmux", ["-V"]); } catch { t.skip("tmux unavailable"); return; }
  const root = await scratch();
  const servers = [join(root, "one.sock"), join(root, "two.sock")];
  t.after(async () => { for (const server of servers) await run("tmux", ["-S", server, "kill-server"]).catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const { copyFile } = await import("node:fs/promises");
  const bin = join(root, "kimi"); await copyFile("/bin/sleep", bin); await chmod(bin, 0o700);
  for (const server of servers) {
    await run("tmux", ["-S", server, "-f", "/dev/null", "new-session", "-d", "-s", "work", "-c", root, bin, "30"]);
    const { listServerPanes } = await import("../../topology/lib/tmux.mjs");
    let panes;
    for (let i = 0; i < 50; i++) { panes = await listServerPanes({ tmuxServer: server }); if (panes[0]?.command === "kimi") break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(panes[0]?.command, "kimi");
    const result = await watchServer({ env: envFor(root), once: true, tmuxServer: server });
    assert.deepEqual(result.labelled, ["work"]);
  }
  const pending = await pendingEnrollments({ env: envFor(root) });
  assert.equal(pending.length, 2); assert.notEqual(pending[0].incarnation.serverKey, pending[1].incarnation.serverKey);
  assert.ok(pending.every(r => r.repo_id === root && r.consumer === root && r.incarnation.panePid > 0));
});

test("watcher aliases to one observed server share one lease", async t => {
  const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const env=envFor(root);
  const listPanesFn=async()=>[observed(root,"/actual/socket")];
  const first=await watchServer({env,once:true,tmuxServer:"friendly-name",listPanesFn});
  const alias=await watchServer({env,once:true,tmuxServer:"/actual/socket",listPanesFn});
  assert.equal(first.acquired,true);assert.equal(alias.acquired,false);
  assert.equal((await readdir(join(stateRoot(env),"watchers"))).filter(n=>n.endsWith(".json")).length,1);
});

test("renaming a tmux display session does not create a new pending identity", async t => {
  const root=await scratch();t.after(()=>rm(root,{recursive:true,force:true}));const env=envFor(root);
  const incarnation=observed(root);
  await startupCheck({consumer:root,session:"work",source:"watcher",incarnation,env});
  await startupCheck({consumer:root,session:"renamed",source:"watcher",incarnation,env});
  assert.equal((await pendingEnrollments({env})).length,1);
});
