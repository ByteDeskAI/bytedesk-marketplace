# TM-507 evidence — revision 25d77fcd4fa34d504355aedfe57187c6dc485b80, worktree clean at measurement

## AC1/AC2 — real graft 0.21.1 session-start hook on fresh worktrees
commit under test: c9cd187ec93aef43a8e513769d3cccbade7d48a5 + uncommitted TM-507 diff (task-management/lib/worktree.mjs)
graft: 0.21.1 (npx cache), hook ~/.claude/helpers/graft-hooks.cjs session-start
== seeded: hook mentions refresh: 0; git status:
== control: hook mentions refresh: 1; git status:
 M .claude/helpers/graft-hooks.cjs
 M .claude/helpers/graft-statusline.cjs
 M .claude/settings.json
 M .claude/skills/graft/SKILL.md
 M .grok/config.toml
 M .grok/skills/graft/SKILL.md
 M .mcp.json
?? opencode.json

## AC3 — finish report uses foreignDirtyPaths
New test 'finish report tolerates dirty tool store paths…' passes; fails with the fix reverted (pass 0 / fail 1).

## Required checks at this revision
npm-ci exit=0 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80
ao-unit exit=1 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80
build-check exit=0 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80
tm-unit exit=1 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80
ao-validate exit=0 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80
tm-validate exit=0 rev=25d77fcd4fa34d504355aedfe57187c6dc485b80

ao-unit failures (9) and tm-unit failures (15) are identical on a clean worktree at base c9cd187e:
ao base: topology-management 5 (ao-management-tests-base.txt) + goal-loop-console 2, topology-prompt-modes 1, workflow-control 1 (ao-unit-base-extra.txt)
tm base: tm-unit-base.txt (same 15)
