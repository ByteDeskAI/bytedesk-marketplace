# bytedesk-designer

An eval-driven design suite for Claude Code. It runs the whole arc — product idea →
design brief → identity → art direction → token-accurate HTML surfaces → published
storybook → independent review — with Claude directing and the [Codex
CLI](https://github.com/openai/codex) producing.

The suite carries **no taste of its own**. It reads *your* design authority — your
tokens, your per-product profiles, your rules about what generated art may be — live,
every run. If you don't have one yet, it will build you one.

## Why it looks like this

Claude has a design eye and no hands. Codex has a native image tool and takes whatever
direction it is given. Alone, one produces descriptions of work and the other produces
confident wrong work. Paired — Claude briefs, Codex renders, **Claude looks at what came
back** and re-briefs — they produce something neither would.

Two rules hold the whole suite together, and both exist because they were learned the
expensive way:

- **Look before promoting.** No stage may promote an artifact it has not inspected.
- **Round 1 diverges, rounds 2–3 converge.** Seeing the wrong answer beside the right one
  is how the right one becomes obvious.

See [`references/claude-codex-collaboration.md`](references/claude-codex-collaboration.md).

## Requirements

- Claude Code
- `codex` on `PATH`, installed and signed in — **required, not optional.** Every producing
  stage pairs the two models, and a stage that quietly ran without Codex would produce an
  artifact whose recorded provenance is a lie. The suite fails at preflight and tells you
  how to fix it.

## The members

| Skill | Owns |
|---|---|
| `bytedesk-designer` | Orchestrator. Routes the arc, owns the run folder, fans out per surface. |
| `bytedesk-designer-authority` | Bootstraps or extends your design-authority repo. |
| `bytedesk-designer-discovery` | Product idea → design brief: audience, surfaces, constraints, voice. |
| `bytedesk-designer-identity` | Marks and icons. Generate to think, draw to deliver. |
| `bytedesk-designer-direction` | Art direction — abstract pieces that establish the visual world. |
| `bytedesk-designer-surface` | Token-accurate HTML surfaces built against your authority. |
| `bytedesk-designer-publish` | Storybook, screenshots, provenance, manifest. |
| `bytedesk-designer-review` | Independent gate. Runs Codex as a *blind critic*, then reconciles. |

Stages couple through files on disk, never through each other's internals — see
[`references/run-folder-contract.md`](references/run-folder-contract.md). No member reads
another member's directory, so any one of them can be run alone, out of order, or twice.

The four shared contracts live at the plugin root rather than inside each skill, because
plugin distribution ships the whole repo and one copy cannot drift from another. The
tradeoff is that a skill extracted on its own as a `.skill` bundle loses them — install
this as a plugin, not as eight separate skills.

## Install

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install bytedesk-designer@bytedesk-marketplace
```

Then just describe what you're designing. The orchestrator picks up from wherever you are —
including from nothing at all.

## License

Apache-2.0
