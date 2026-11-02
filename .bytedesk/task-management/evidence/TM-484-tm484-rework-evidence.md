# TM-484 rework evidence (round 2) — revision 02b4a748187c43825e75fd82b066ad8aa44b4f32

Base: merged origin/main e251d0b8. Tree: the only uncommitted files are graft agent-wiring regenerations
(.claude/helpers/graft-*.cjs, .claude/settings.json, .claude/skills/graft, .grok/*, .mcp.json, opencode.json),
outside agent-orchestration/ and task-management/. Session env: TM_DISPATCH_WORKER=1, which was the same for the control run.

## Review findings addressed (reviewer c164bf8b, changes_requested at 91f1d33c)
1. Partial kill mid-batch: prepareClaim now returns settle() (second turn look + handoff, every refusal) and commit() (end only).
   launch settles EVERY claim before ending any; an end failure lists already-replaced sessions + handoff paths in error.details.replaced.
   Test: "TM-484: an agent that goes busy between prepare and commit is refused at settle, before any session ends".
2. findTranscript in a shared cwd: the fallback passes marker = the handoff path just typed; only a transcript whose tail holds it is taken; none → null (pane capture).
   Tests: "findTranscript with a marker never returns another conversation in a shared cwd"; fallback test now has a newer other-agent transcript that is not taken.
3. docs/topology.md added to TM-484 touches.
4. Required checks run at this revision (below).
5. Fallback writes <id>.fallback.md; handoff.requested keeps the agent's path; readHandoff prefers a late agent file. Test: "readHandoff prefers the agent's late handoff".
6. callerSession(env). The self-respawn test now passes TMUX via env (it failed against the fix while it mutated process.env).

## Required checks at 02b4a748187c43825e75fd82b066ad8aa44b4f32
npm-ci exit=0
ao-unit exit=1
build-check exit=0
tm-unit exit=1
ao-validate exit=0
tm-validate exit=0

## Unit failures exist on main
Control: clean worktree at origin/main e251d0b8, same argv.
- agent-orchestration unit: 9 failures here, 9 on main, identical names (diff empty).
- task-management unit: 15 failures here, 15 on main, identical names (diff empty).
TM-484 tests in this run:
ok 1006 - TM-484: an open that does not ask to respawn refuses a live agent, and nobody replaces its own session
ok 1010 - TM-484: a multi-agent launch refused for one agent ends no other agent's session
ok 1011 - TM-484: findTranscript with a marker never returns another conversation in a shared cwd
ok 1012 - TM-484: readHandoff prefers the agent's late handoff over the fallback
ok 1013 - TM-484: an agent that goes busy between prepare and commit is refused at settle, before any session ends

Logs: /tmp/tm484-r3/*.log, control /tmp/tm484-r2/main-*.log
