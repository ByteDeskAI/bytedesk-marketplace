# Changelog

## Unreleased

### Added — the plugin (EP-017)

- **Six gated stages, one at a time.** `discovery → identity → direction → theme → brand →
  mockups`, each a tmux agent team launched through `agent-orchestration`, with a human approval
  between each. The stage list, the folder names and the artifact set each stage owns are pinned in
  `CONTRACT.md`, which both the driver and the six specs are written against.
- **`bin/rebrand` — the driver, and the gate.** Gates in the orchestration layer are prose: a
  spec's `gates` block is rendered into the conductor's BOOTSTRAP.md and nothing ever reads it
  back, so a gate there is a sentence asking a model to stop. Here it is a refusal, with four
  distinct reasons and the exact command that clears each.
- **An approval is bound to the bytes it approved.** `approve` records a sha256 over the stage's
  whole artifact set, sorted, hashed by path as well as content. `next` recomputes it and refuses
  when it no longer matches: a deliverable edited after sign-off, or a file added or removed, all
  break the approval rather than silently riding on it. This is the discipline
  `bytedesk-designer`'s run-folder contract already applies to its `viewed` list — *record the
  content, not just the name* — and the same rule `task-management`'s planner applies to board
  mutations.
- **A stage is complete only if its files are still there.** The status is cross-checked against
  disk on every read, so a stage whose folder was emptied reports incomplete regardless of what
  `state.json` says. Trusting the JSON alone is how a case reports green over nothing.
- **Stopping between stages needs no command.** Between stages no process is running, so a case
  waiting on a client can sit for a week; `rebrand next` continues it, and a fresh process with no
  memory of the earlier ones is in exactly the same position. That is why this does not add a
  `resume` to the orchestration layer: `stop` there kills the tmux session and each agent's model
  context dies with its pane, so a resumed conductor would have to be re-briefed from files
  anyway — which is what launching the next stage already does.
- **The case file is a git repository** under `~/Documents/GitHub/ByteDeskAI/clients/<slug>/`,
  created by `rebrand new`. It follows `bytedesk-designer`'s run-folder contract with one addition,
  an `approval` block per stage, so anything that already reads one of those folders reads this one.
- **A rejection keeps the round.** `reject --why` records the reason and sets the stage back to
  pending without deleting anything; what was rejected and why is the most useful thing in a case
  file six months later.

### Notes

- The specs use the `bytedesk-designer-*` skills, which resolve. They deliberately do not reference
  `brand-brief`, `brand-concept`, `brand-judge`, `brand-explore` or `design-system-assets` — all
  five are absent from every skill directory, so the two shipped brand workflows in
  `agent-orchestration` currently launch with three of four skills missing.
- Stage 5 produces PNG only, by operator instruction. Stage 6 produces PNG renderings only and fans
  out one child run per page.
