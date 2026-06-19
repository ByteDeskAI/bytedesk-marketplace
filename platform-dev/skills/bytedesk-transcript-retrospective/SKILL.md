---
name: bytedesk-transcript-retrospective
description: >-
  Analyze recent Claude/Codex/Grok transcripts, rollout summaries, and project
  memory to find repeated developer-workflow friction and recommend or implement
  worktree-operator / skill / rule / tooling improvements. Use for "analyze
  transcripts", "review the last N days of transcripts", "what skills should we
  improve", "self-enhance our development workflow", "last N days of
  Claude/Codex/Grok", productivity retrospectives, and agent process audits.
user-invokable: true
argument-hint: "[days=14] [optional topic]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Turn transcript evidence into concrete developer-workflow improvements —
worktree-operator verbs, new/enhanced skills, deterministic helpers, or repo
rules. Prefer current raw sessions over memory alone; use memory summaries as
an index.

**Signal model (don't skip this):** friction lives in what the **user typed**,
not in the injected `CLAUDE.md`/`AGENTS.md`/context that is replayed into every
transcript. A blanket `grep` of whole transcript files just counts how many
files echo the system prompt (e.g. "omnigent: 1328") and is near-useless for
ranking. The helper below extracts **user-authored prompts** across all three
agents, drops injected/subagent/Stop-hook noise, then clusters + phrase-ranks
those. Always reason from the prompt-centric output, not raw file greps.

## Inputs

- Codex sessions: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + clean prompt
  log `~/.codex/history.jsonl`
- Claude project sessions:
  `~/.claude/projects/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-platform*/**/*.jsonl`
  (the helper skips `subagents/` — those are agent-to-agent, not user friction)
- Grok prompt history:
  `~/.grok/sessions/<url-encoded-project>/prompt_history.jsonl` (the only Grok
  file with clean user prompts; session files interleave assistant turns)
- Codex memory index: `~/.codex/memories/MEMORY.md`
- Claude project memory:
  `~/.claude/projects/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-platform/memory/*.md`

## Procedure

1. Run the helper for the first pass (default window is 14 days, all three
   agents):
   ```bash
   transcript-retrospective --days <N>          # text report
   transcript-retrospective --days <N> --json   # machine-readable
   ```
   It prints (a) friction **clusters** with per-tool counts + examples, and
   (b) **repeated short intents (>=3x)** — the muscle-memory phrases (`land it`,
   `is this landed`, `ship and land`, `reset localdev`) that signal a multi-step
   ritual should collapse into one operator verb.
2. Bound any follow-up date range with `find -newermt`, or add a fourth source
   with `--root <tool>:<path>`.
3. Read the cluster examples + top phrases. The strongest signals are: a
   recurring **question** (uncertainty the tooling should answer outright) and a
   recurring **command** (a ritual the tooling should make one step).
4. Cluster by friction type:
   - unclear landed state
   - stale localDev/runtime
   - Omnigent plugin/runtime mismatch
   - browser smoke fragility
   - goal/epic continuation loss
   - DevProjects sandbox refresh gaps
   - DevProject custom-domain/DNS proof gaps
   - TeamCity/release proof ambiguity
   - remote-gateway host/service diagnostics
   - integration-branch conflict replay risk
   - workflow registry/catalog drift
   - agent concurrency/rate-limit pressure
   - repeated command misuse
   - pre-existing red tests or noisy gates
5. For each cluster, propose one of (cheapest first):
   - **collapse a ritual into a worktree-operator verb** — a >=3x repeated short
     command, or a ritual chain like "ship and land" / "is this landed?", maps
     to a `scripts/dev/workflow.mjs` verb. Extend the operator in
     `scripts/lib/worktree-workflow.mjs` + the verb in `scripts/dev/workflow.mjs`,
     and update `bytedesk-worktree-operator/SKILL.md` + `references/commands.md`
     (per `.claude/rules/worktree-lifecycle.md`).
   - enhance an existing skill
   - add a new skill (only when no existing skill can absorb the behavior)
   - add a deterministic script/helper
   - add or tighten a repo rule
6. If asked to implement: do the work in a managed worktree
   (`workflow.mjs new BDP-N-slug`), open one Jira Task, modify the smallest
   relevant surface, and do **not** create a duplicate skill when an existing
   one fits. Each operator verb is its own scoped, TDD'd change — propose the
   batch, build the highest-value one(s) the user greenlights.

## Report Format

```markdown
Evidence window: <dates>
Sources sampled: claude=<n> codex=<n> grok=<n> (user prompts)
Top friction clusters (count [per-tool]):
- <cluster>: <evidence summary> -> <operator verb | skill | rule change>
Repeated rituals (>=3x): <phrase x N>, ...
Proposed enhancements (prioritized):
1. <change> — <signal it addresses> — <effort>
Implemented this pass:
- <path>: <what changed>
Deferred:
- <reason>
```