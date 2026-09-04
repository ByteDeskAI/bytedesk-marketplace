---
name: orchestration-compose
description: Turn a natural-language description of a multi-agent collaboration ("a Fable conductor, two designers on Codex and Grok, an Opus judge, human sign-off at the end") into a validated tmux orchestration spec, then save it as a reusable template. Use when the user describes agents working together, asks for a new orchestration or team template, or wants to change an existing template.
user-invokable: true
argument-hint: "<what the agents should do together> [--save user|consumer]"
---

# Compose an orchestration from natural language

The spec is a small JSON document (`ao-topology schema` prints the fields). Your job is to map what
the user said onto it, validate it with the CLI, show it back, and save it. You never launch here;
that is `orchestration-launch`.

Resolve `AO` once: the `bin/ao-topology` launcher two directories above this skill
(`../../bin/ao-topology`). Prefer the installed plugin copy over a source checkout unless the user is
developing the plugin.

## Process

1. **Ground yourself in three commands** before drafting:
   - `AO schema` — the fields, roles, and placeholders.
   - `AO providers` — which CLI adapters exist and what each supports (model flag, system prompt,
     auto-approve). An unknown `cli` id still works through the generic adapter.
   - `AO templates` — reuse or extend an existing template instead of starting blank when one is
     close.
2. **Extract the team.** For every agent the user named or implied, decide: `id` (short slug),
   `role` (one orchestrator; others from orchestrator/worker/designer/judge/reviewer/researcher/
   implementer or a custom role that has a `roles/<name>.md`), `cli`, `model` (only if named),
   `skills` (names of SKILL.md folders the agent must read), and one or two sentences of
   `instructions` specific to this run.
   - "Fable" and "Opus" are Claude models: `cli: claude` with `model: fable` / `model: opus`.
   - A model family the user wants kept separate (for an independent judge) is a separate agent
     on a separate CLI.
3. **Extract the workflow** as ordered stages: who sends to whom, what each stage waits for, a
   contract name when the output shape matters, a timeout, and any loop (`loop_until`,
   `max_rounds`). Keep stage names to verbs or nouns the user used.
4. **Extract gates.** Any "I want to approve", "check with me", "before it's final" becomes a
   `gates` entry with `human: true`. Default to one gate before anything is promoted or merged
   when the user did not say otherwise; say you added it.
5. **Extract inputs.** Anything that changes per run (a product, a target path, a ticket) becomes
   an `inputs` entry with a description; reference it as `{{inputs.<name>}}` in instructions and
   session name. Give defaults where sensible. When the user wants to *choose* something at
   launch — which CLI draws, which deliverables, which scope — give the input `options`
   (`[{ "value", "description" }]`, plus `"multi": true` when several may be picked); the
   launcher then shows a menu and the CLI rejects anything outside it. An agent field can be
   driven by an input (`"cli": "{{inputs.designer_cli}}"`, `"model": "{{inputs.designer_model}}"`,
   a skill name in `skills`); the value `none` in `skills` is skipped.
6. **Write the draft** to a temp file and validate: `AO compose --spec <file>`. The error text lists
   every problem; fix them all and re-run until it prints `"ok": true`.
7. **Show the user** a compact table: agent → role, CLI/model, skills; then the stages in order;
   then the gates and inputs. Ask for corrections only if something material is ambiguous
   (which CLI for an unnamed designer, whether a judge should be independent of the designers'
   model family). Otherwise proceed.
8. **Save**: `AO compose --spec <file> --save user` (default; `~/.config/agent-orchestration/templates/`)
   or `--save consumer` (`<repo>/.orchestration/templates/`) when the template belongs to one repo.
   Report the saved path and the launch command:
   `AO launch --template <name> --input <k>=<v> --consumer <repo>`.

## Worked example

User: "Set up a run where Fable orchestrates, Codex and Grok each design a logo for Vault from
the same brief, Opus judges, two revision rounds max, and I sign off before anything is committed."

Draft (abridged):

```json
{
  "name": "vault-logo-tournament",
  "inputs": { "product": { "description": "product slug", "default": "vault" } },
  "session": "brand-{{inputs.product}}-{{run_id}}",
  "agents": [
    { "id": "conductor", "role": "orchestrator", "cli": "claude", "model": "fable", "skills": ["orchestration-conduct", "brand-brief"] },
    { "id": "designer-codex", "role": "designer", "cli": "codex", "skills": ["brand-concept"] },
    { "id": "designer-grok", "role": "designer", "cli": "grok", "skills": ["brand-concept"] },
    { "id": "judge", "role": "judge", "cli": "claude", "model": "opus", "skills": ["brand-judge"] }
  ],
  "workflow": [
    { "stage": "brief", "from": "conductor", "to": ["designer-codex", "designer-grok"], "contract": "brand.brief.v1" },
    { "stage": "concepts", "wait_for": ["designer-codex", "designer-grok"], "timeout": "30m" },
    { "stage": "judge", "from": "conductor", "to": ["judge"], "contract": "brand.scorecard.v1" },
    { "stage": "revise", "from": "conductor", "to": ["designer-codex", "designer-grok"], "loop_until": "judge.verdict == accept", "max_rounds": 2 }
  ],
  "gates": [{ "after": "judge", "human": true }]
}
```

## Rules

- Exactly one `orchestrator`. It conducts; it does not do the workers' jobs.
- Competing agents get the same skills and the same brief; only `cli`/`model` differ.
- Do not invent CLI flags. Model and approval flags come from the adapter, not the spec.
- Skills are referenced by folder name; if the user names a skill that does not exist, keep the
  reference and tell them `launch` will warn until it exists.
- Never put secrets or absolute machine paths into a saved template; use inputs and
  `{{consumer}}` / `{{home}}`.
