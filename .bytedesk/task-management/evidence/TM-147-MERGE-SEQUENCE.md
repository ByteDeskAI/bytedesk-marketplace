# TM-147 — untracking `pane.log`, and the merge sequence it requires

**Branch:** `tm/TM-147-panelog-untrack`. **Do not merge this the ordinary way.** The steps are below
and they are not optional — I proved both failure modes rather than reasoning about them.

## What the branch does

- `.gitignore` gains `.bytedesk/agent-orchestration/agents/*/pane.log` and the `runs/*/agents/*`
  sibling, with the reason written beside the rule.
- `git rm --cached` on the two tracked logs: `eff264fa` (1.4 MB, written 90 seconds before I looked)
  and `fd2b831f` (375 KB).

## Why this matters more than tidiness

`pipe-pane -o` is attached at pane creation and appends every byte a pane renders, so a tracked
`pane.log` is rewritten continuously while an agent does anything. In a shared checkout that means
**the tree is never clean**, and `git status` stops being a usable signal for "is there unowned work
here". It has already cost this repository real work twice today:

- a conductor read `status`, saw a dirty file, and attributed it to an unowned party — the only dirty
  file was one agent's own log;
- a merge raced a live `pane.log` write, failed with "Unable to write index", left `MERGE_HEAD` set,
  and the next routine commit **concluded that merge with none of the branch's code in it**.

## THE MERGE SEQUENCE — measured, not assumed

I built a throwaway repository and reproduced both outcomes:

| the log's state when you merge | what git does |
|---|---|
| **dirty** (an agent is writing) | `error: Your local changes to the following files would be overwritten by merge` — **the merge refuses.** This is the failure that has been happening. |
| **clean** | the merge succeeds and **DELETES THE LOG FROM DISK** — and takes the now-empty agent directory with it. |

Neither is acceptable on its own: one blocks you, the other destroys a live agent's history. So:

```bash
# 1. Copy both logs aside FIRST. They are the only copy.
cp .bytedesk/agent-orchestration/agents/eff264fa/pane.log /tmp/tm147-eff264fa.log
cp .bytedesk/agent-orchestration/agents/fd2b831f/pane.log /tmp/tm147-fd2b831f.log

# 2. Make the tree clean so the merge is allowed to proceed.
git checkout -- .bytedesk/agent-orchestration/agents/eff264fa/pane.log \
                .bytedesk/agent-orchestration/agents/fd2b831f/pane.log

# 3. Merge.
git merge tm/TM-147-panelog-untrack

# 4. Restore. `mkdir -p` is REQUIRED — the merge removes the emptied agent directory, and my first
#    attempt at this sequence failed on exactly that.
mkdir -p .bytedesk/agent-orchestration/agents/eff264fa .bytedesk/agent-orchestration/agents/fd2b831f
cp /tmp/tm147-eff264fa.log .bytedesk/agent-orchestration/agents/eff264fa/pane.log
cp /tmp/tm147-fd2b831f.log .bytedesk/agent-orchestration/agents/fd2b831f/pane.log

# 5. Verify all three criteria at once.
git ls-files | grep -c 'pane\.log$'    # 0  — no longer tracked          (AC1)
ls -la .bytedesk/agent-orchestration/agents/*/pane.log   # both present  (AC2)
git status --porcelain                 # empty — the ignore rule holds   (AC3)
```

Verified on the throwaway repository: log restored with both lines including the one appended after
the last commit, `ls-files` returns 0, `status` returns 0 dirty files.

## One residual worth knowing

A live agent's tmux `pipe-pane` holds an open descriptor. If step 3 deletes the path while that
agent is running, tmux keeps writing to the unlinked inode and those bytes are unreachable — which
is why step 1 copies first and step 4 restores. After the restore the running agent's future writes
go to the **unlinked** inode, not the restored file, until its pane is next re-piped. The restored
file is therefore a snapshot up to the merge, and that is the honest limit of what this sequence can
preserve for an agent that never stops.

**The cleanest time to do this is when no agent is live.** If that is not now, the sequence above is
correct and the residual is one truncated log tail, not a lost log.
