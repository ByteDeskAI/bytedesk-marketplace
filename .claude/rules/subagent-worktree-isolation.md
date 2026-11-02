# Subagents launched with `isolation: "worktree"`

A subagent started with `Agent({ isolation: "worktree" })` runs in its own git worktree under
`.claude/worktrees/agent-<id>`. Claude Code checks every Bash command that subagent runs, so the
subagent's git operations stay inside that worktree. **This guard is built into Claude Code. No
hook in this repository runs it, so no hook change here can relax it.** The refusal reads:

> This agent is isolated in the worktree `<path>`, but this command … Refusing to run it — a
> worktree-isolated agent's git operations must target its own worktree. …

(It is `qr()` in the Claude Code bundle. TM-523 checked versions 2.1.289 and 2.1.316.)

## What it refuses, by version

| Claude Code | Refused | Runs |
|---|---|---|
| 2.1.289 (2026-10-07 to 10-09) | Any Bash command that is not one plain command: heredocs, pipes, `&&`, `;` and redirects. This included `npm ci … > /dev/null 2>&1; echo $?` and `python3 - <<'EOF'` edits. The audit counted 88 refusals across 10 subagents. | One plain command per call, plus the Edit, Write and Read tools. |
| 2.1.316 (verified 2026-11-01) | Git commands that target anything other than the subagent's own worktree, for example `git -C <shared checkout> status`. | `npm ci` (plain, with `--prefix`, or after `cd … &&`), heredocs, pipes, redirects, `node --test`, and the Edit, Write and Read tools. |

Evidence: `.bytedesk/task-management/evidence/TM-523-worktree-isolation-probe.md`.

## How to brief a worktree-isolated subagent

- **Edit files with the Edit and Write tools**, not `python3 - <<EOF` or `cat > file <<EOF`. These
  tools are never refused, on any version.
- **Run git only from the subagent's own worktree.** Do not use `git -C` or `cd` into another
  checkout, and do not run git commands that read a git path from a variable.
- **If a command is refused, split it into one plain command per Bash call.** Do not retry the
  same compound form. In auto mode, the classifier treats a reworded retry as an
  `[Auto-Mode Bypass]`.
- **Work that must commit, push or open a PR goes through `tm dispatch <id>`.** A dispatched
  worker gets its own tm worktree and branch, so the isolation guard does not apply. A subagent
  hands its diff back to the lead, and the lead commits it.

Also note: inside a tm worker session (`TM_DISPATCH_WORKER` is set), subagents inherit
the task-management dispatch guard. That guard is a separate hook from this repository. It refuses
a command named by an expansion, such as `G=git; $G log` (TM-481).
