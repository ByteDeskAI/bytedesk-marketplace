# ADR-0046: Hierarchical Authorization for Fleet Sessions

## Status

Accepted - 2026-05-09

## Context

The multi-session Claude system in this repo (the `claude-sessions` dashboard,
the `spawn-claude-feature` launcher, and the `fleet-*` skills) lets a parent
Claude session spawn child sessions that run with `--dangerously-skip-permissions`.
Children inherit the project's `.claude/settings.json` hook configuration but
bypass the standard interactive permission prompts.

The PreToolUse hook in `.claude/hooks/pr-merge-guard.sh` (BDP-367) already
intercepts `gh pr merge` calls and requires the PR number to appear in the
latest user-typed message in the session transcript. That works for a root
session where the "user" is a human, but it creates an awkward problem for
fleet children:

- A child session's "latest user message" is whatever spawn-prompt its parent
  passed at spawn time. The parent often doesn't yet know what PR number the
  child will eventually open — the PR is created mid-work.
- Forcing the parent to send a follow-up `claude-sessions send <child> "merge #N"`
  message after the child reports its PR works, but it imposes synchronous
  coordination on what should be parallel autonomous work.

A code review of BDP-367 surfaced two concrete bypasses in the regex (flag-
before-number and bare `gh pr merge` with branch-inferred PR), but the deeper
question is the authorization model itself: should every gated action require
fresh human authorization, or can a parent agent delegate authority to its
descendants?

## Decision

Authorization in the fleet tree is **hierarchical**. The act of spawning a child
session **is** the authorization for that child's bounded actions. Per-action
human authorization only applies at the root of the tree (depth 0).

### Authorization classes

Every gated action in the fleet system falls into one of four classes. The
class determines whether depth-aware delegation applies.

| Class | Examples | Auth rule |
|---|---|---|
| **Local-blast** | file edits, commits, lints, test runs | No gate (free) |
| **PR-level** | open PR, comment, review, **merge**, label, request changes | Depth-aware: depth 0 → human in transcript; depth ≥ 1 → inherited from spawn |
| **Repo-destructive** | force push, branch delete, history rewrite, `git reset --hard` of remote refs | **Always** require human authorization, regardless of depth |
| **External / blast-radius** | production deploy, secret rotation, cross-tenant DB writes, `kubectl delete` against production, sending external messages (Slack, email) | **Always** require human + per-action explicit authorization |

The taxonomy is the load-bearing artifact. New gates added to the system
declare their class; the depth-aware delegation rule applies for free if the
class is local-blast or PR-level.

### Depth-aware enforcement (PR-level gates)

A hook implementing a PR-level gate reads `CLAUDE_SESSION_DEPTH` from its
environment (set by `spawn-claude-feature` for child sessions; absent and
defaulted to `0` for root sessions started by a human at the terminal):

```text
if depth >= 1:
    allow — parent agent's spawn act is the authorization
else:
    apply transcript-based human-authorization check
```

`spawn-claude-feature` sets the variable explicitly when launching a child:

```bash
export CLAUDE_SESSION_DEPTH='1'   # or '2' for grandchildren, etc.
```

### Repo-destructive and external gates

Hooks implementing these classes do **not** consult depth. They always require
explicit human authorization in the transcript, regardless of who initiated
the action. The threat model here is "any agent at any depth can make a
mistake, and the cost of that mistake is unbounded recovery work."

Concrete examples that fall into Repo-destructive or External today:

- `git push --force` against remote branches → require explicit `force push N`
  authorization in latest human message; depth doesn't matter.
- Any `helm upgrade` / `kubectl apply` against the production cluster context
  (`platform.bytedesk.ai`) → human-only.
- Outbound webhook/Slack/email APIs that send messages externally → human-only.

This ADR introduces the depth-aware model but does not yet implement
enforcement for Repo-destructive or External classes — those are separate
hooks to be added when the corresponding gated actions ship.

## Architecture

```text
                     [ Human user ]
                          │
                          │  prompt with #N or per-action auth
                          ▼
                  ┌──────────────────┐
                  │  Root session    │  CLAUDE_SESSION_DEPTH unset (0)
                  │  (depth 0)       │  Transcript check applies
                  └──────────────────┘
                          │
                          │  spawn-claude-feature --parent <root>
                          ▼
                  ┌──────────────────┐
                  │  Child session   │  CLAUDE_SESSION_DEPTH=1
                  │  (depth 1)       │  Inherits authorization
                  └──────────────────┘
                          │
                          │  (recursion capped at depth 2 today,
                          │   --max-depth raisable per ADR-0045 fleet skills)
                          ▼
                  ┌──────────────────┐
                  │  Grandchild      │  CLAUDE_SESSION_DEPTH=2
                  │  (depth 2)       │  Same delegation rule
                  └──────────────────┘
```

Trust transits along the spawn edge. If the human gives a parent unrestricted
authority via the spawn prompt, the parent transitively gives that authority
to its descendants. The blame surface is the spawn prompt itself.

## Consequences

### Positive

- Fleet children can complete bounded work (open PR, merge own PR, post review)
  without parent-child synchronous coordination. This is what makes parallel
  fleet execution actually parallel.
- The taxonomy makes the security thinking explicit on each new gate. "Is this
  PR-level or Repo-destructive?" is a clear question, not a judgment call.
- The model generalizes — adding a new fleet skill or hook (e.g., for review
  posting, label application, branch deletion) inherits the rule for free
  based on its declared class.
- Root-session enforcement is preserved: human keystroke authority at the top
  of the tree is still mechanically required.

### Negative

- A buggy or malicious parent spawn prompt has transitive blast radius across
  all descendants for PR-level actions. Mitigation: the only thing that
  authors a parent prompt is the human, and the spawn act itself is logged in
  `~/.claude-sessions/<TICKET>.meta`.
- Hooks need to know their own depth, which adds an env-var dependency. If
  `CLAUDE_SESSION_DEPTH` is ever set incorrectly (e.g., by a misconfigured
  spawner), authorization could be wrongly granted. Mitigation: only
  `spawn-claude-feature` sets the variable, and it does so deterministically
  from depth-tracking state in `~/.claude-sessions/<TICKET>.meta`.

### Neutral / Operational

- This ADR explicitly does not address budget caps or extension authorization;
  see BDP-368 (self-tuning budget caps) for the cost-side equivalent.
- Existing hooks remain unchanged unless they implement a PR-level gate. The
  one PR-level hook today (`pr-merge-guard.sh`) is updated in the same change
  that introduces this ADR.

## Implementation

The reference implementation is `.claude/hooks/pr-merge-guard.sh`. It
short-circuits to `exit 0` (allow) when `CLAUDE_SESSION_DEPTH >= 1`, with the
delegation reason logged to stderr for observability. At depth 0 it applies
the existing transcript-based authorization check, after a tightened
PR-number extraction step that handles flag-before-number and bare
`gh pr merge` invocations.

A test fixture at `.claude/hooks/tests/test-pr-merge-guard.sh` covers both
depths and the bypass forms identified by the BDP-367 review.

## References

- BDP-367 — Mechanical PR-merge guard hook
- BDP-368 — Self-tuning budget caps for fleet sessions (sibling — cost-side
  delegation rather than action-side)
- `.claude/rules/fleet.md` — single source of truth for fleet rules,
  including the PR merge authorization rule and spawn discipline
- `.claude/hooks/pr-merge-guard.sh`
- `.claude/hooks/tests/test-pr-merge-guard.sh`
- PR review on #346 that surfaced the bypasses motivating this ADR

## Policy revision — 2026-05-09 (BDM-11)

The depth-aware delegation taxonomy in this ADR is unchanged. The depth-0
transcript-pattern set, however, was widened: a bare word `merge` (without an
accompanying PR#) now authorizes whichever PR the command names, provided the
message contains no negation (`don't merge`, `do not merge`, `never merge`,
or the compound `merge conflict`). The original "mechanical-not-contextual"
property that required a literal PR# in the message is intentionally relaxed
for the bare path; the strict path still applies whenever the user names any
specific PR# (so `merge #999` while the command runs `gh pr merge 346` still
blocks). See `docs/RULES.md` → "PR merge authorization" for the current rule
text and the BDM-11 ticket for the rationale.
