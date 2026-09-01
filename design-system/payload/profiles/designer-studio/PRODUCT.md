# ByteDesk Designer Studio - Product Direction

## Register

product

## Purpose

ByteDesk Designer Studio is a desktop environment for directing a traceable design
workflow from discovery through publication. It coordinates specialist agents, applies
the selected design authority, captures generated artifacts and tool evidence, previews
working surfaces, and keeps independent review findings attached to the work they judge.

## Users

- Product designers directing parallel discovery, identity, direction, and surface work.
- Engineers translating approved direction into token-accurate implementation.
- Reviewers who need to inspect provenance, artifacts, tool activity, validation gates,
  and revision history before publication.
- Design-system maintainers auditing or extending the governing authority.

## Product promises

1. Every run names its project, authority path, immutable authority revision, and stage.
2. Every artifact keeps a run-relative identity and the direction/attempt metadata that
   produced it; colliding basenames never merge.
3. Preview, validation, review, and publication are separate states. One never silently
   implies another.
4. Agent and tool activity is inspectable evidence, not decoration or a substitute for
   human approval.
5. Authority drift, unavailable providers, permissions, failed gates, and incomplete
   work remain visible with a concrete next action.

## Primary journeys

- Open a solution, select or create a project, and resolve its governing authority.
- Direct the ordered design arc and inspect live agent/tool progress without losing the
  brief or selected output.
- Compare generated artifacts, inspect their provenance, and preview HTML surfaces.
- Read independent findings, follow them to the judged artifact, revise, and observe the
  next review round.
- Audit or extend the design authority with an explicit plan and validation result.
- Review the exact deliverables and unresolved gates before publication.

## Product model

- **Solution** contains projects and the authority relationship used to govern them.
- **Project** defines the product/design job and owns its runs.
- **Run** is one immutable execution context with ordered stages and captured evidence.
- **Artifact** is a run-relative output with provenance and optional preview behavior.
- **Agent session** performs bounded stage work through an explicit provider.
- **Tool call** is inspectable evidence with input, result, failure, and review state.
- **Review round** judges named artifacts and gates, producing durable findings.
- **Publication** is a reviewed handoff, never merely the existence of output files.

## Voice

Calm, precise, and accountable. Prefer exact nouns and verbs: `resolve authority`,
`run review`, `open artifact`, `permission denied`, `source changed`, and `publish`.
Name paths, revisions, agents, and gates when they matter. Do not say work is approved,
safe, current, or shipped unless the corresponding evidence exists.

## Success

A user can identify the governing authority and current run, direct the next appropriate
stage, inspect the resulting artifact and evidence, understand every blocking review
finding, and make a deliberate publication decision without leaving the Studio or
guessing which files and revisions were involved.

## Anti-references

- A generic chat client where prompts and prose obscure project state and artifacts.
- A design gallery that hides provenance, failed tool calls, or review gates.
- An autonomous pipeline that publishes because stages completed rather than because
  named outputs were reviewed.
- A monitoring dashboard whose charts or agent topology are unrelated to a decision.
- Another ByteDesk product's shell, identity, or information hierarchy reused as a
  shortcut for Studio's workbench.

