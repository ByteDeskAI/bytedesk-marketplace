---
id: "ADR-0027"
kind: "adr"
status: "accepted"
created: "2026-09-28T19:56:40.656Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Lifetime lead authorization: the marketplace lead lands, integrates and records landings without per-plan grants"
epic: "EP-019"
deciders: ["Ryan Helms"]
date: "2026-09-28"
updated: "2026-09-28T19:56:40.663Z"
---

## Context

ADR-0022 moved landing authority to repository leads, gated by a checkable plan grant (TM-234,
TM-248). Grants are operator-only and capped at 14 days. Since TM-248, a lead session is
always a managed session, so `manage record-landing` and `manage integrate` refused without a
grant, and every landing waited on Ryan.

## Decision

Ryan, directly in the marketplace lead's session (fd2b831f) on 2026-09-28, verbatim:

> 1. I am authorizing you to create the plan grant and anything you need to do in the future.
> record this as a lifetime authorization. 2. Yes, turn it on 3. Yes, install the lead
> permissions rules

> And recording landings should NEVER need my grant/permission. The lead should be able to do that

So, for the repository lead of this repository:

1. **Lifetime authorization.** The lead may integrate (merge) and record landings for any task
   in this repository without a per-plan grant, with no expiry, until Ryan revokes it.
2. **Recording a landing never needs a grant.** `manage record-landing` from the lead is always
   allowed. It records a merge that already happened on the server.
3. `management.integrate_via` is `"pull-request"` in this repository.
4. The lead's permission rules (TM-243) are installed.

How it is implemented, not by faking the operator-only grant channel:

- The authorization is a committed repository policy on the server's default branch (reviewed
  PR, protected main). The lead's identity is proven by its pane ancestry (TM-234). Workers and
  other agents remain refused.
- Every other integrate guardrail stays: the approved head, green CI, an independent review
  verdict, the base branch, mergeability, and no `--admin`.

## Consequences

- Landings no longer wait on Ryan, which is the operating model ADR-0022 asked for.
- Authority rests on the lead's proven identity plus the server-side policy. It no longer rests
  on per-plan operator intent. A compromised lead session could merge any reviewed, green PR.
  Faro's review, CI and GitHub branch protection remain the backstop.
- Revoking means removing the policy from the default branch.
