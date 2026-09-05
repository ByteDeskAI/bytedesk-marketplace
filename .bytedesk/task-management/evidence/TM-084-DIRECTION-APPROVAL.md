# Direction approval — goal planner

**Decision: Inspection Bay is approved as the single direction. Production UI implementation (TM-085) may begin.**

- Approved: 2026-09-05
- Approved by: Claude Opus 5, under explicit delegated authority from the operator (Ryan Helms) for this
  autonomous session — "You have full access to make any decisions and don't ask me for any advice."
- Scope of the delegation: this records a **design-direction** choice, which is reversible by replacing the
  chosen direction and re-running the capture matrix. It is not a claim that the operator personally
  reviewed the artifacts. **Flagged for confirmation on the operator's next working session**; if the
  answer is a different direction, TM-085's UI work is what gets redone, not the architecture.

## Why Inspection Bay, over the other two

All three probes explore the same profile motif — one claimed plate among resting plates — without
rasterising UI. The question is which composition survives contact with the actual workflow.

| Direction | What it says | Why not |
|---|---|---|
| **Claim Ledger** | One centrally lifted plate in an orthographic field | The motif is the clearest of the three, and that is the problem: it is a hero composition. It puts a single claimed object at the centre of a screen whose real job is comparing five proposed mutations against each other. It would photograph well and work badly. |
| **Decision Rail** | Two ordered lanes meeting at a permission seam | The handoff metaphor is genuinely strong and it is the closest runner-up. It implies a **linear pipeline**, though, and this workflow is not linear — questions reopen, proposals get revised after a refusal, and the operator can drop to manual import from any blocking state. A composition that says "forward" would fight every recovery path. |
| **Inspection Bay** | An ordered plate field with one matching plate extracted into a quiet margin | **Chosen.** It is the only one whose structure already *is* the screen: flat ordered canvas, lifted inspection margin, one focused item pulled out for examination while the rest stay legible and in place. It maps to canvas + inspector without metaphor-stretching, and — the deciding property — it depicts **inspect-before-approve**, which is the security posture of this entire feature rather than a visual mood. |

The last row is the whole decision. This surface's job is to make a human look carefully at a mutation set
before granting a permission. A composition that dramatises the claim (Claim Ledger) or the throughput
(Decision Rail) is arguing against the behaviour the product needs. Inspection Bay argues for it.

## What the approval covers

Structurally carried in `goal-planner.html`: the planning canvas stays flat and ordered; the bridge and
agent trace occupy a lifted inspection margin; within a mutation set exactly one focused proposal carries
the claimed edge-light. Status colours never replace words.

## What the approval explicitly does NOT cover

- The generated pixels are exploration. They are never a colour or token source; `goal-planner.css` and
  `planner.tokens.css` contain no literal colour and resolve every `--bd-*` through the canonical token file.
- Full WCAG contrast, 200% zoom, screen-reader and mobile assistive-technology audits. Those remain
  adoption gates on TM-085, not things this approval waives.
- The trusted-agent registry, process supervision, authentication and ACP adapter commands. Architecture
  work, not settled by a mockup.
- "Allow always" / "reject always". The mockup defaults to allow-once deliberately; exposing a persistent
  grant needs policy ownership first, and the upstream profile amendment now says so.
