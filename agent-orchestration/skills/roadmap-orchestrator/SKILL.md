---
name: roadmap-orchestrator
description: Govern and evolve ROADMAP.md with the repository roadmap validator. Use when asked to enhance the roadmap, extend the roadmap, select the next roadmap work, or act on task, unlock, trajectory, gap, or goal IDs.
---

# Roadmap Orchestrator

Treat roadmap edits as governed planning, never execution authority.

## Inspect

1. Resolve a writable source checkout containing `ROADMAP.md` and `scripts/roadmap.mjs` from the active user workspace. When several checkouts or worktrees match, use only the user-selected active checkout and confirm both paths resolve inside it before editing. Treat an installed plugin cache as read-only reference and discovery content; never edit it or use its process directory as the consumer repository.
2. Read `ROADMAP.md` completely.
3. Run `npm run roadmap:check` before changing it. Stop on validation failure and report the broken invariant.
4. When no target is named, show at most five eligible actions with their IDs, prerequisites, expected unlocks, and rationale. An executable action is eligible only when its task has `status: "planned"` and derived `readiness: "ready"`; a roadmap-only refinement may also be offered but must be labeled non-executable. List executable actions first. Do not edit until the user selects one.

## Change one target

- **Task:** Refine its outcome, boundaries, evidence, and completion test without changing its ID or silently widening scope.
- **Unlock:** Implement it as a connected child task. Link the parent unlock to the child and the child back to its origin.
- **Trajectory:** Extend it with the smallest coherent connected step. Preserve its goal, evidence, gaps, and reciprocal lineage.
- **Gap:** Fill by distance:
  - At one hop, add one task and its expected unlock.
  - At two or more hops, extend the current trajectory with the smallest connected task, or add a child trajectory when the gap needs multiple bounded milestones.
  - At unknown distance, add a bounded research task with evidence requirements and stop conditions.
- **Goal:** Rank connected trajectories by evidence, confidence, distance, risk, and expected unlock. Advance the best supported path; propose a connected trajectory only when existing paths are inadequate.

Prefer refining or connecting existing records over adding new ones. Reject disconnected additions, duplicate aspirations, circular lineage, false readiness, and changes whose reciprocal edges cannot be maintained. Preserve every existing ID. Allocate a new ID as the next unused numeric suffix in that record kind and namespace; never renumber, recycle, or backfill an earlier hole. When identity must change, create a same-kind replacement, mark the old record's kind-specific lifecycle `superseded`, and set its `supersededById` to the replacement. Keep every supersession chain same-kind, acyclic, and terminating at a live replacement. Retired historical records may retain evidence and lineage; apply active projection constraints only to live records.

## Govern commitment

- Keep strategic additions `proposed` until a human roadmap steward approves them.
- Never let a goal or trajectory execute work, spend budget, reserve capacity, mutate a workspace, or silently become a commitment.
- Record uncertainty, omissions, dissent, evidence, and approval boundaries explicitly.
- Require renewed review when material scope, provider, policy, capability, acceptance, or dependency drift changes an approved proposal.

## Persist and validate

After editing canonical records, follow this order exactly:

1. If new IDs were added, run `npm run roadmap:append-inventory`. Append immutable identities only; never rewrite, remove, recycle, or backfill inventory entries.
2. Run `npm run roadmap:refresh-views`. Never hand-edit generated Mermaid blocks or the trajectory index.
3. Run `npm run roadmap:refresh-sources` only when referenced source content changed or source anchors were intentionally added, removed, or changed. Review the manifest diff; never refresh it to hide unexplained drift.
4. Reread affected lineage in both directions, then run `npm run roadmap:check` again.

The initial check in **Inspect**, the edit, and these four steps form the required safe enhancement sequence. Report preserved and appended IDs, reciprocal links, eligibility changes, view regeneration, source-manifest effects, and remaining gaps.
