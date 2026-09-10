---
id: "TM-155"
kind: "task"
status: "open"
created: "2026-09-10T02:17:20.899Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a repository Claude has never trusted hits a silent first-run trust modal, and doctor does not say so"
epic: "EP-018"
acceptance: [{"text":"The first-run trust gate is documented where an operator meets it — doctor reports it, or launch's refusal names it — rather than being discovered by reading a pane.","done":false},{"text":"A supported way exists to bring a governed run up in a fresh repo, or the one required human action is stated as part of the design (like failover.consent) rather than being an accident of the provider's UI.","done":false},{"text":"TMUX_TMPDIR that is too long for a unix socket is refused with the reason, not with tmux's raw error.","done":false},{"text":"A repo config template override reports which key is invalid, and relative prompt paths in a repo config resolve somewhere a copied default would work — or the docs say they must be absolute.","done":false}]
evidence: []
commits: ["caba55b"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T02:24:08.358Z"
comments: [{"author":"main","ts":"2026-09-10T02:21:56.143Z","text":"CORRECTION, from a second demo run in a repository Claude HAS trusted (bytedesk-tmux-manager).\n\nMy original claim — that the reviewer always meets the folder-trust modal — is too strong and I am correcting it before anyone acts on it. In a TRUSTED repository the agent's own subdirectory does NOT prompt: `lead ensure` there brought the lead straight up and the census read it as `working` within seconds, no modal, no human turn. Trust is inherited by subdirectories of a trusted project root, and ~/.claude.json holds no entry for any agent directory because none is needed.\n\nSo the accurate scope is: the trust modal blocks a governed launch only in a repository Claude Code has NEVER been trusted in. bytedesk-bench was such a repository, which is why the first demo hit it. That is still worth fixing — it is a silent first-run wall in any new repo, and doctor should say so — but it is not the universal blocker I described.\n\nTHE UNIVERSAL BLOCKER IS TM-151, and the second demo is what showed it. In the trusted repo both sessions came up fine and the reviewer STILL never registered, because its ready composer renders the placeholder hint `❯ Try \"fix lint errors\"` and the shipped ready pattern does not match a hint. Measured on the live pane: shipped 0, candidate 12. Detail on TM-151 comment 2.\n\nThe two smaller findings in this task's body stand unchanged: the socket-path length error, and the repo-config template override needing a whole template with an absolute prompt path."},{"author":"main","ts":"2026-09-10T02:23:36.525Z","text":"Title repaired by the integrator. The store had recorded it literally as \"--title\" — the retitle attempt passed the flag through as the value, which is a CLI defect worth knowing about: `tm task edit <id> --title \"...\"` does not retitle, it sets the title to the flag name. I hit the same wall on TM-152 and edited the frontmatter directly instead. Neither of us should be hand-editing task markdown to rename a task; that is worth its own entry if it recurs.\n\nThe scope correction stands and is the right call — retitled to match it. The trust modal blocks only a repository Claude Code has never been trusted in, not every governed launch. Trust is inherited by subdirectories of a trusted root, which is why an agent directory under a trusted project needs no entry in ~/.claude.json and prompts for nothing.\n\nCorrecting a claim downward before anyone acts on it is worth more than the original report was. The first demo genuinely hit the modal; the difference was the repository, not the code, and that is exactly the kind of distinction that would have sent someone chasing a bug in the launcher.\n\nPriority set to medium: a silent first-run wall in a fresh repo is real and doctor should name it, but it is not the universal blocker. TM-151 is, and it is now highest."}]
priority: "medium"
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