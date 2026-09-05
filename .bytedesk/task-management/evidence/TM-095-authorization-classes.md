# Authorization classes for spawned agents

Salvaged from the `fleet` plugin before its retirement (TM-095). The taxonomy originated in
`fleet/docs/adr/0001-hierarchical-authorization.md` (ADR-0046, accepted 2026-05-09) and its rule
text in `fleet/docs/RULES.md`; fleet's own wording is preserved wherever it was already precise,
because this is documentation salvage and accuracy beats rewriting. What is new here is the fifth
class — **external inbound** — and its mapping onto the cross-repo routing that now exists in
`agent-orchestration/topology/lib/routing.mjs`.

Nothing in `agent-orchestration` enforces classes one through four today. Fleet's hooks did, and
they go with the plugin. This document is the specification the hierarchy work (TM-094) implements
against; it is not a description of running code, except where it says so explicitly.

## The model

> Authorization in the fleet tree is **hierarchical**. The act of spawning a child session **is**
> the authorization for that child's bounded actions. Per-action human authorization only applies
> at the root of the tree (depth 0).

Trust transits along the spawn edge. If a human gives a parent unrestricted authority via the spawn
prompt, the parent transitively gives that authority to its descendants for the bounded classes.
The blame surface is the spawn prompt itself.

## The four classes

| Class | Examples | Auth rule |
|---|---|---|
| **Local-blast** | file edits, commits, lints, test runs | No gate |
| **PR-level** | open PR, comment, review, **merge**, label, request changes | Depth-aware: depth 0 → human in transcript; depth ≥ 1 → inherited from spawn |
| **Repo-destructive** | force push, branch delete, history rewrite, `git reset --hard` of remote refs | **Always** require human authorization, regardless of depth |
| **External / blast-radius** | production deploy, secret rotation, cross-tenant DB writes, `kubectl delete` against production, sending external messages (Slack, email) | **Always** require human **and** per-action explicit authorization |

The taxonomy is the load-bearing artifact. A new gate declares its class; the depth-aware
delegation rule applies for free if the class is local-blast or PR-level.

## The depth rule

`CLAUDE_SESSION_DEPTH` carries the depth. **`spawn-claude-feature` was the only authoritative
writer of it** (`fleet/docs/RULES.md`: "Do not read it from any other source"), computing it as
parent depth + 1 from the parent's meta file and rejecting a spawn past `--max-depth 2` unless
`--allow-recursion` is passed (`fleet/bin/spawn-claude-feature:117-135`). It reached the child in
the tmux `send-keys` prelude alongside the ticket and results dir
(`fleet/bin/spawn-claude-feature:234`). Absent, it means depth 0 — a session a human started at a
terminal.

A hook implementing a **PR-level** gate reads it and short-circuits:

```text
if depth >= 1:
    allow — parent agent's spawn act is the authorization
else:
    apply transcript-based human-authorization check
```

The reference implementation is `fleet/hooks/pr-merge-guard.sh:50-56`: at depth ≥ 1 it logs
`merge-guard: depth=N, parent-delegated authorization — allow` to stderr and exits 0; at depth 0 it
runs the transcript check. Depth-0 enforcement has two paths (widened by BDM-11, 2026-05-09):

- **STRICT** — if the user's most recent message names a specific PR in any recognized form
  (`#N`, `merge N`, `PR N`, `pull/N`), the command's PR number must match. This catches "merge #999
  in the message but the model runs `gh pr merge 346`".
- **BARE** — if the message names no PR at all, a bare word `merge` authorizes whichever PR the
  command names. It does not fire on `don't merge` / `do not merge` / `never merge`, nor on
  `merge conflict` (compound noun, not imperative). Other phrasings without the literal word —
  `ship it`, `approve it`, `yes`, `lgtm` — still block.

Bypass forms are handled at depth 0 by extracting the last bare-digit token from the command and
falling back to `gh pr view --json number` for a branch-inferred PR.

Hooks implementing **repo-destructive** and **external** gates do **not** consult depth. They
always require explicit human authorization in the transcript, regardless of who initiated the
action. The threat model is "any agent at any depth can make a mistake, and the cost of that
mistake is unbounded recovery work." Fleet's ADR introduced the depth-aware model but never
implemented enforcement for these two classes; that is still true.

### Fail-safe contract

A gate that cannot decide must block. Fleet's rule: when state required for a decision (transcript,
env var, external lookup) is missing or unreadable, default to `exit 2` on safety-relevant gates and
`exit 0` on observability-only hooks, and document the choice in the hook header. Keep matchers
tight (`"matcher": "Bash"`, not `".*"`) so unrelated tool calls do not pay hook latency.

## The fifth class: external inbound

A message arriving from an agent in **another repository** is not covered by any of the four. The
four classes all gate an action a session is about to take; this one gates an *instruction a session
is about to receive*. Depth does not describe it: an outsider has no spawn edge into this repo, so
there is no inherited authority to read. It needs its own row.

| Class | Examples | Auth rule |
|---|---|---|
| **External inbound** | a message from an agent in another repo, addressed to an agent in this one | **Repo-scoped**: the repo's lead is the only address an outsider may reach directly. Reaching any other agent requires a delegation this repo itself issued, still backed by this repo's own store. Unvouched contact is redirected to the lead, never silently delivered and never silently dropped. Depth is not consulted. |

The rule is enforced, and it is enforced at the mailbox rather than in a prompt, because it depends
on live state. `routeMessage` in `topology/lib/routing.mjs` decides where a message actually goes:

- **Same project** — straight through. Cross-repo is the only case this class covers.
- **Addressed to the lead** — straight through. The lead is the front door.
- **Covered by a delegation** — straight through, with the token and the store's verdict recorded
  in the decision's `reason`.
- **Otherwise** — redirected to the lead, with `intended_for` preserved in the envelope, a
  `route.redirect` journal event (`topology/lib/mailbox.mjs`), a note prepended to the delivered
  message explaining why it arrived, and an acknowledgement back to the sender. A message that
  silently changes recipient is the failure mode the layer exists to avoid.

### Delegation tokens

A lead issues a delegation when it hands work to one of its own agents and expects an outside agent
to coordinate directly on it: `issueDelegation` mints an 8-byte token naming
`(task, external_agent, local_agent, issued_by, expires_at)` with a 7-day default TTL, stored under
this repo's own `delegations` resource dir. Two refusals at issue time:

- **`TOPOLOGY_COORDINATOR_NOT_A_WORKER`** — work cannot be delegated to a `coordinates_only` agent.
  A coordinator is not a worker, and this has to be refused mechanically rather than described in a
  prompt, because the token is what the outside repo will later present.
- **`TOPOLOGY_DELEGATION_UNBACKED`** — the token must be backed by this repo's task-management store
  at the moment it is minted.

**The token is a pointer, not a permission.** The permission is the `tm` claim it names, and that
claim lives in the receiving repo's own store — the one store the sender cannot forge.
`verifyAgainstStore` re-reads `.bytedesk/task-management/` off disk on every use and fails closed:
a task the store has never heard of, a task in a terminal status, or a task held by somebody other
than the named local agent authorises nothing. A record that exists but no longer holds is not
treated as absent — it is named in `decision.delegation_rejected`, because an operator otherwise
stays certain the delegation works while every message goes to the lead. This mirrors `tm collect`'s
rule that the store gets the last word, and it is why there is deliberately no second delegation
store.

### Loop and hop guards

- **`wouldLoop(via, leadId)`** — if the `via` chain already contains this repo's lead, the message
  has been here; `routeMessage` sets `blocked: "loop"` and refuses to forward rather than
  redirecting. Wired.
- **`hopExceeded(via)` / `MAX_HOPS = 4`** — a cap on chain length independent of loops, for the
  lead-to-lead ping-pong that never repeats a single id. Enforced in `sendMessage`
  (`topology/lib/mailbox.mjs`), which refuses a send whose incoming `via` chain is already at the
  cap, before routing runs. The chain itself travels in the message frontmatter, so the guard
  survives a provider swap the way every other mailbox fact does.

### How external inbound composes with the other four

Passing the routing check authorizes *delivery*, nothing else. An instruction that arrives legally
is still subject to every class above when the receiving agent acts on it: a delegated outsider
asking for a force push does not get one, because repo-destructive ignores provenance exactly as it
ignores depth. Delivery authority and action authority are separate gates and must stay separate.

## Forward to the agent hierarchy (TM-094)

TM-094 builds the per-repo team: `role: lead`, `coordinates_only`, `reports_to`, delegation tokens
against `tm` claims, the `via` chain and a hop limit, and an observable lead inbox depth. This
document is that work's authorization substrate. Three specific hand-offs:

1. **`coordinates_only` must be a capability fact, not an instruction.** In class terms: a
   coordinator holds no local-blast authority at all — no write permission, no worktree, no
   implementation skills — rather than being told not to use it. `issueDelegation` already refuses
   to route work to one (`TOPOLOGY_COORDINATOR_NOT_A_WORKER`); the launcher must make the same
   statement true of the running process.
2. **Depth needs a topology-native writer.** `CLAUDE_SESSION_DEPTH` had exactly one authoritative
   writer, and that writer retires with fleet. Per ADR-0001 the topology layer is the authoritative
   orchestration layer, so `topology/lib/launch.mjs` inherits the obligation: set the variable when
   an agent spawns another, derive it from the spawning agent's recorded depth, cap recursion, and
   keep it the single source. A gate reading a depth nobody authoritatively writes grants authority
   by accident — the failure mode fleet's own ADR named as its main negative consequence.
3. **`reports_to` is the spawn edge, made durable.** Fleet's tree existed only in per-session meta
   files; the agent library holds the same relation as stored state, so an inherited-authority check
   can be answered from the roster rather than from an environment variable that only survives while
   the pane does.

## Sources

- `fleet/docs/adr/0001-hierarchical-authorization.md` — ADR-0046, the origin of the four classes.
- `fleet/docs/RULES.md` — rule text, hook conventions, spawn discipline, event format.
- `fleet/hooks/pr-merge-guard.sh` — the one implemented PR-level gate.
- `fleet/bin/spawn-claude-feature` — the only authoritative writer of `CLAUDE_SESSION_DEPTH`.
- `agent-orchestration/topology/lib/routing.mjs` — external inbound, as running code.
- `agent-orchestration/docs/adr/0001-authoritative-orchestration-layer.md` — which layer inherits
  the obligations above.
