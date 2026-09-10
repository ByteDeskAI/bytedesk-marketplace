---
id: "TM-155"
kind: "task"
status: "open"
created: "2026-09-10T02:17:20.899Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: no governed orchestration can start unattended — the reviewer always meets Claude's folder-trust modal"
epic: "EP-018"
acceptance: [{"text":"The first-run trust gate is documented where an operator meets it — doctor reports it, or launch's refusal names it — rather than being discovered by reading a pane.","done":false},{"text":"A supported way exists to bring a governed run up in a fresh repo, or the one required human action is stated as part of the design (like failover.consent) rather than being an accident of the provider's UI.","done":false},{"text":"TMUX_TMPDIR that is too long for a unix socket is refused with the reason, not with tmux's raw error.","done":false},{"text":"A repo config template override reports which key is invalid, and relative prompt paths in a repo config resolve somewhere a copied default would work — or the docs say they must be absolute.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T02:17:20.908Z"
---

Found by running a real demo orchestration in an idle repo (bytedesk-bench, clean tree, no prior AO state), on an isolated tmux socket, torn down afterwards.

WHAT HAPPENS. `launch` refuses without a responsive lead AND an independent reviewer (TOPOLOGY_STARTUP_NOT_READY). `lead ensure` and `reviewer ensure` each open a session whose cwd is a NEW directory — the agent's own dir under .bytedesk/agent-orchestration/agents/<id>. Claude Code has never seen that directory, so it renders the folder-trust modal:

    Quick safety check: Is this a project you created or one you trust?
    > No, exit
      Yes, I trust this folder

The plugin handles this correctly and that is worth saying first: it does NOT press Enter. TM-111's guard holds — the highlighted option is 'No, exit', and Enter there would exit the provider. It reports TOPOLOGY_SESSION_START, 'Provider is not accepting startup instructions; session preserved', and leaves the pane alone. The census then names the condition exactly, unprompted:

    state: attention
    reason: Claude is waiting on its folder-trust question for this directory - nobody can answer
            it from here. Answer it once in a normal terminal (cd into the agent's cwd and run
            `claude`, choose "Yes, I trust this folder"), then launch again.

That is the epic's census doing precisely what it was built for.

WHY THERE IS NO WAY ROUND IT FOR THE REVIEWER. auto_approve passes --dangerously-skip-permissions, which also clears the trust prompt, and a repo config template override can set it for the lead. The reviewer CANNOT have it: reviewer.mjs:145-146 hard-overrides auto_approve:false and forces --restricted --safe-mode, and that is the independence guarantee, not an oversight. So the reviewer's first start in any repo needs a human at a keyboard, once per agent directory. Nothing on this machine has ever trusted an agent directory: 0 of ~/.claude.json's project entries under any agent-orchestration/agents path is trusted.

CONSEQUENCE FOR THE EPIC'S OWN GOAL. EP-018 exists to make coordination deterministic with the fewest possible AI turns. The first turn of every governed run in a fresh repo is a HUMAN turn, and it is not the one the design chose to spend (failover.consent). It is unbudgeted and undocumented.

TWO SMALLER THINGS THE SAME RUN EXPOSED, both real:
1. A long TMUX_TMPDIR fails with 'error connecting to <path> (File name too long)'. The unix socket path limit is ~107 bytes and a session-scratch directory exceeds it easily. The error names the path but not the cause.
2. A repo config that overrides a template must repeat the WHOLE template, and its `prompt` is resolved against the repo, so copying the documented default value './prompts/lead.md' silently points at a file that does not exist. A partial override, and a full one with the default relative path, both fail with the same message: 'Invalid lead prompt; refusing restart.' Neither says which key was wrong.