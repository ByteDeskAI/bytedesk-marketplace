# TM-523: worktree-isolation probe, 2026-11-01

## AC1: The refusing component

The refusal comes from Claude Code itself, not from a hook in this repository.

- The text appears in `/home/ryan/.local/share/claude/versions/2.1.316` (the claude binary), in
  function `qr(t,e,i,n)`. Excerpt:
  `a=(m,_=...)=>\`${r} is isolated in the worktree ${n}, but this command ${m}. Refusing to run it — ${s} git operations must target its own worktree. ${_}\``
  `if(t.kind!=="simple"){if(De(t)||t.tree===void 0)return a("is too complex to verify that it stays inside the worktree",o);if(Er.test(e))return a("names git in a form too complex to verify ...`
- `grep -rl "too complex to verify"` over this repository and over `~/.claude/plugins` found
  nothing.
- All 6 refused calls in the cited transcripts were compound Bash commands (heredoc, pipe, `&&`,
  `;` or redirect). None were Edit or Write tool calls:
  - design-system `agent-a6b0aa74708d0a19d.jsonl`:27, :34, :41, :45 (`python3 - <<EOF`,
    `node --test … | grep`, `cat > … <<EOF`)
  - marketplace `agent-a8a5279aabf195587.jsonl`:75, :80, :88 (`cd … && grep … | …`,
    `cd … && npm ci … > /dev/null 2>&1; echo`, `cd … && python3 - <<EOF`)
- Both refused subagents ran Claude Code **2.1.289**. Their parents ran in `bypassPermissions`
  mode (marketplace) and `auto` mode (design-system), so permission mode does not explain the
  refusals.

## AC2: The supported path, run on Claude Code 2.1.316 with `isolation: "worktree"`

### Probe 1 (subagent `a42f9b2957176f59b`, cwd `.claude/worktrees/agent-a42f9b2957176f59b`)

| # | Command | Result |
|---|---|---|
| 1 | `pwd` | RAN |
| 2 | `npm ci --prefix ./agent-orchestration --ignore-scripts --no-audit --no-fund` | RAN, "added 154 packages in 4s" |
| 3 | `npm ci --prefix ./agent-orchestration --silent > /dev/null 2>&1; echo npm $?` (the form refused on 2.1.289) | RAN, "npm 0" |
| 4 | `cd agent-orchestration && npm ci --ignore-scripts --no-audit --no-fund` | RAN, "added 154 packages in 7s" |
| 5 | `python3 - <<'EOF' … EOF` | RAN, "heredoc ran" |
| 6 | Write tool: `probe-tm523.txt` | RAN |
| 7 | Edit tool: replace `line one` with `line two` | RAN |
| 8 | Read tool: read the same file | RAN, "line two" |
| 9 | `node --test agent-orchestration/tests/unit/mailbox-receipts.test.mjs` | RAN, pass 6, fail 0 |
| 10 | `node --version \| head -1` | RAN, v22.23.1 |

### Probe 2 (subagent `a348cd8cbff864df9`): Does the guard still run on 2.1.316?

| # | Command | Result |
|---|---|---|
| 1 | `git status --short` | RAN |
| 2 | `cd agent-orchestration && git status --short \| head -3` | RAN |
| 3 | `git -C <shared checkout> status --short \| head -3` | **REFUSED by Claude Code:** "…this command redirects git to the shared checkout via -C. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree." |
| 4 | `G=git; $G log --oneline -1` | **REFUSED by the task-management dispatch guard** (`tm-hook.sh pre-bash`, which the subagent inherited from this tm worker session): "runs a command named by an expansion" |
| 5 | `cd <shared checkout>/agent-orchestration && npm ci --ignore-scripts --dry-run` | RAN |

The guard is still active in 2.1.316, so the probe was able to fail. Its scope has narrowed to git
commands that target another checkout. Non-git compound commands now run.

### What this isolation removed

Both probes ran from this tm worker session in `bypassPermissions` mode. The probes did not
retest `auto` mode on 2.1.316. Version 2.1.289 is no longer installed (installed versions are 295,
296, 312 and 316), so the probes did not reproduce the original refusals. That evidence comes from
the transcripts above. Probe worktree 1 was removed with `git worktree remove --force`. Probe
worktree 2 was cleaned up automatically because it had no changes.

## Required checks at bec824d2 (this branch; diff = two Markdown files only)

| Check | Exit | Result |
|---|---|---|
| agent-orchestration: npm ci | 0 | added 154 packages |
| agent-orchestration: unit | 1 | 1297 tests, 1284 pass, 9 fail |
| agent-orchestration: build:check | 0 | Done |
| task-management: unit | 1 | 1677 tests, 1662 pass, 15 fail |
| agent-orchestration: plugin validate | 0 | passed with warnings |
| task-management: plugin validate | 0 | passed with warnings |

The diff contains no code, so the two unit suite failures were not caused by this change. These
failures depend on the environment. The checks ran inside a dispatched tm worker session. For
example, the task-management `actor` test expected an empty actor, but read `fd2b831f`, the lead's
session id, from the inherited environment. Failing tests include `actor`, `tm_claim`,
`tm_task_update start`, `TM-247 governed worker lifecycle`, and agent-orchestration
`topology-prompt-modes` `config set`. The working tree also held graft rewrites of tracked files
(`.mcp.json`, `.claude/settings.json`, and others) that this task did not make (audit problem 3).
The checks were not rerun in a clean shell.
