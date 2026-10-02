# Presence session names — additive addendum (ADR-0030 name shapes)

**Status: in effect for the producer since agent-orchestration 0.13.0; gateway countersignature
requested.** Marketplace **TM-274**, decision **ADR-0030**.
Producer: `bytedesk-marketplace` / `agent-orchestration`.
Consumer: `bytedesk-remote-gateway` orchestration-terminals plugin.

This document sits **beside** the existing presence documents and edits none of them:

| Document | State | sha256 |
|---|---|---|
| `PRESENCE-CONTRACT.md` | frozen, countersigned | `3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5` |
| `PRESENCE-HEADER-ADDENDUM.md` | signed, amended for gateway defect D1 | `e92a54f27596b853e6a88c520ae5ee23c990fc43b4c50bc6bba5940f315d88b3` |
| `PRESENCE-V2-ADDENDUM.md` | in effect (`schemaVersion: 2`) | `7cebfa8b208a8adb56335f9d11e00e903f89c132fd306c231ba1d43be55fe9c5` |
| `PRESENCE-ROLE-ICON-ADDENDUM.md` | in effect, countersignature requested | `4376cf911a8037e66d9490384b28d93a61ab0f1bf5d7f26c13a8b327e673a6ea` |

All of them, and this addendum's own artifacts, are recorded in
`fixtures/presence-session-names/SESSION-NAMES-HASHES.txt`.

---

## 1. Outcome

**The presence snapshot's shape is unchanged.** `schemaVersion` stays `2`. No key is added, removed
or retyped, and the `session.kind` vocabulary (`spawn`, `role-session`, `run`, `external`) and its
meaning are unchanged. Only the **values** in `session.sessionName` change, because every tmux
session ao creates since 0.13.0 has a new name.

**The consumer has nothing it must do**, provided it already follows contract §4.4: read
`session.kind`, never parse `session.sessionName`. This addendum replaces the name-shape table in
contract §4.3–§4.4 with the current shapes, and says what a consumer **may** now do (§7).

## 2. What this supersedes

Contract §4.3 and §4.4 cite `topology/lib/identity.mjs:103` and `:118-121` (`parseSessionName`) and
list three producer name shapes. TM-274 removed `sessionName` and `parseSessionName` from
`identity.mjs`; names are now composed by `topology/lib/session-names.mjs` (`composeSessionName`) and
planned by `topology/lib/launch.mjs` (`planSession`).

This addendum supersedes **only the name shapes and the code citations** in §4.3–§4.4. These rules
stand exactly as written:

- §4.3: `agentId` is 8 characters and stable; one agent may appear more than once with different
  `session` bindings; identity is not incarnation.
- §4.4: **`session.kind` is authoritative; the name is display only.** A consumer must never parse a
  session name.

## 3. Name shapes

Every name ao creates is `[team--]node--repo--role--persona`. A session that holds a team run uses
the **workflow name** as its role segment: `[team--]node--repo--<workflow>--<persona>`.

### 3.1 By `session.kind`

| `session.kind` | Session | New shape | Example | Legacy shape, until it ends |
|---|---|---|---|---|
| `role-session` | a standing lead, reviewer, observer, `session open` | `[team--]node--repo--<role>--<persona>` | `agents1--bytedesk-marketplace--lead--priya` | `ao-<agentId>` (`ao-k3n8vq2a`) |
| `run` | a team run: one session, one pane per agent | `[team--]node--repo--<workflow>--<persona>` | `core--agents1--bytedesk-marketplace--parallel-review--ada` | workflow-derived |
| `run` | a run of one library agent | `[team--]node--repo--<role>--<persona>` | `agents1--bytedesk-marketplace--worker--kenji` | `<agentId>-<7 hex>` |
| `spawn` | a legacy spawn session only (§3.3) | — | — | `<agentId>-<7 hex>` (`b4h6rt1c-1f4c9de`) |
| `external` | an enrolled session ao did not create | anything | `zsh` | anything |

Every pane of a team run shares one session, so two presence entries with different `agentId` can
carry the same `sessionName` (and `sessionId`). They are still two entries, distinguished by the
six-tuple binding (contract §4.1).

### 3.2 Segments and separator

| Segment | Value | Cap |
|---|---|---|
| `team` | the run's team (`--team`, or `team` in the spec); **omitted** when there is none | 16 |
| `node` | `AO_NODE_NAME`, else `node.name` in the ao user config, else the short hostname; also the node's NATS leaf-node name | 24 |
| `repo` | the `origin` remote's repository name, owner stripped; the main checkout's folder name only when there is no remote | 32 |
| `role` | the agent's role, or the workflow name for a team run | 48 |
| `persona` | the agent's generated first name, `first-last` when the first name is taken in the scope; for a team run, a first name held by that run | 24 |

- **Slug rule.** Each segment is lowercased, and every run of characters outside `[a-z0-9]` becomes
  one `-`, trimmed at both ends and capped. A segment therefore matches `[a-z0-9]+(-[a-z0-9]+)*`.
- **Separator.** Segments are joined by `--`. Because no segment can contain `--`, a name has four
  segments without a team and five with one. This is stated so a consumer can **display** the parts;
  it is not permission to derive authority from them (§6).
- **Length.** At most **160** characters (four `--` separators plus the five caps is 152). The
  producer refuses any name over 160 before creating the session. The gateway accepts up to 256.
- **Uniqueness.** There is no numeric collision suffix. An agent holds at most one live session,
  parallel work uses distinct agents, and personas are unique within a team, or within a repository
  slug for solo work. A name is unique on its tmux server; it is **not** a cross-host identifier.

### 3.3 `kind: "spawn"` is reserved for legacy names

The frozen v1 validator, which the v2 validator delegates to, requires a `spawn` entry to have a
seven-hex `spawn` and `sessionName == "<agentId>-<spawn>"`. A new-style name cannot satisfy that, so:

- the producer publishes a run of one library agent under a new-style name as **`kind: "run"`** with
  `spawn: null`;
- `kind: "spawn"` appears only for a legacy `<agentId>-<7 hex>` session that is still alive.

`fixtures/presence-session-names/n01-spawn-kind-new-name.json` shows the v2 validator rejecting the
other combination.

**Known producer defect, stated so it is not assumed away.** `collectPresenceAgents`
(`topology/lib/presence.mjs`) sets `kind: "spawn"` whenever a `run.json` agent record carries a
seven-hex `spawn` token, and since TM-274 accepts that record when the pane's `@ao-agent` matches,
whatever the session is called. Given such a record and a new-style session, it publishes the
invalid combination above. No code in agent-orchestration 0.13.1 writes a `spawn` token into
`run.json`, so ao's own launches do not reach this path. It remains a producer bug to fix on the
marketplace side; it needs nothing from the consumer, which should reject such a snapshot exactly as
it rejects any other that fails the validator.

### 3.4 Legacy names and their sunset

Sessions created before agent-orchestration 0.13.0 keep their names until they end:

- `ao-<agentId>` role-sessions, published as `kind: "role-session"`;
- `<agentId>-<7 hex>` spawns, published as `kind: "spawn"`.

There is no rename. When a legacy role-session ends, the agent's next session is created under the
new shape. A snapshot may therefore mix both generations, for example a lead still in
`ao-k3n8vq2a` beside a reviewer in `agents1--bytedesk-marketplace--reviewer--linus`
(`h02-v2-legacy-lead.json`). There is no fixed date: legacy names disappear as those sessions end.

## 4. Identity is in session options

Since 0.13.0 every session ao creates carries its identity as tmux user options. The same values
are recorded in `identity` in the agent's `session.json` and `session_identity` in `run.json`.

| Option | Value |
|---|---|
| `@ao-id` | the session's ULID (26 characters, Crockford base32) |
| `@ao-agent` | the agent's 8-character id; in a team session, set on each **pane** |
| `@ao-role` | the agent's role slug; `run` for a team session |
| `@ao-repo` | the repository slug, as in the name |
| `@ao-repo-origin` | `owner/repo`, or the main checkout's path when there is no remote |
| `@ao-node` | the node name, as in the name |
| `@ao-team` | the team slug, when there is one |
| `@ao-run` | the run id, for a run session |
| `@ao-workflow` | the workflow name, for a run session |
| `@ao-kind` | `role-session`, `spawn` (a run of one library agent) or `run` (a team run) |

**These options are labels, not proof.** Any process running as the same OS user can set or change
them with `tmux set-option`. Authority still rests on the durable records and on the recorded pane
binding: presence matches every entry by its six-tuple binding (contract §4.1), never by an option
or a name. The producer reads an option in one place only: it refuses to publish a `spawn` entry
whose pane carries an `@ao-agent` that contradicts the record (`TOPOLOGY_PRESENCE_SPAWN`). That
check can only refuse; an option never makes an entry.

**`@ao-kind` and `session.kind` are different vocabularies.** `@ao-kind` says how ao launched the
session; `session.kind` is the contract field. They disagree by design for a run of one library
agent: `@ao-kind` is `spawn`, `session.kind` is `run` (§3.3). TM-274 also fixed an internal bug in
which a team pane's `@ao-role` decided the session kind; `@ao-kind` is now recorded explicitly so
that cannot recur. Neither value changes what presence publishes.

## 5. Gateway caveat: a restored tab has no options

The gateway mints its own tab ids and session names, and they are not covered by ADR-0030. When the
gateway recreates a dead tab, it creates a new tmux session **without any `@ao-*` options**, even if
it reuses a name ao chose. So:

- a session that has an ao-shaped name and no `@ao-*` options is not an ao session;
- it has a new binding, so presence does not match it to any agent record; it can appear only as
  `kind: "external"` if someone enrols it (`n02-lead-name-on-external.json`);
- a consumer must never infer an agent, a role or a lead from a name that looks like ao's.

## 6. The name is display only

- **`session.kind` is authoritative** (contract §4.4, unchanged). `repoRole` and `runRole` remain the
  only sources of standing and authority; "Team lead" is still `repoRole === "lead"` and nothing else.
- **Never derive kind, role, lead, agent or authority from `sessionName`**, including from its role
  segment. Two valid snapshots show why:
  - `n02-lead-name-on-external.json`: an `external` session named
    `agents1--bytedesk-marketplace--lead--priya`, beside the real lead in a legacy `ao-k3n8vq2a`
    session. A name parser finds a second lead.
  - `n03-workflow-named-reviewer.json`: a team run of a workflow called `reviewer`. Its session is
    `agents1--bytedesk-marketplace--reviewer--ada`, and both panes are `runRole: "worker"`,
    `repoRole: "member"`, `kind: "run"`. A name parser finds two reviewers.

  Both pass the frozen and v2 validators. Nothing in the schema stops them, so only the consumer's
  rule protects it.
- **Never group by name.** Two entries share a `sessionName` whenever they are panes of one team run.
  Group runs by `memberships` (contract §6.2).

## 7. What changes for the consumer

**Must do: nothing**, if it already follows contract §4.4 and §10.

**May now do, for display only:**

1. Show `sessionName` as readable text: it now names the node, the repository, the role or
   workflow, and the persona.
2. Split a new-style name on `--` to show its parts, for example as a tooltip, falling back to the
   whole string when it does not have four or five segments. Never feed a part into a role, kind,
   grouping or authority decision.
3. Where the gateway has tmux access to the session, read `@ao-kind` and `@ao-workflow` to label a
   tab (for example "parallel-review run"). Treat both as labels: absent on legacy, external and
   restored sessions; writable by any same-user process; and `@ao-kind` may differ from
   `session.kind` (§4). Where the two disagree, show `session.kind`.

**Should check:** that any length limit, column width or truncation accepts names of up to 160
characters without losing the role or persona segment, and that names over 160 from ao are not
expected (§3.2).

## 8. Producer obligations

Additions to contract §9.

1. Publish `session.kind` from the agent records, never from the session name or an `@ao-*` option.
2. Publish `kind: "spawn"` only for a legacy `<agentId>-<7 hex>` session (§3.3); publish a new-style
   run of one agent as `kind: "run"` with `spawn: null`.
3. Create no session name longer than 160 characters, and none whose segments break the slug rule.
4. Keep `schemaVersion` at `2` for this change; the snapshot shape is unchanged.

## 9. Consumer obligations

Additions to contract §10. They restate what §4.4 already requires.

1. Take kind from `session.kind`, and standing and authority from `repoRole` and `runRole`.
2. Never parse a session name or an `@ao-*` option to decide kind, role, lead, grouping, routing or
   authority.
3. Accept both name generations in the same snapshot, and any name up to 256 characters.

## 10. Evidence

Checked at marketplace commit `60a33288` (agent-orchestration 0.13.1).

- **Presence shape.** `git show dff391e1 -- topology/lib/presence.mjs`, the TM-274 commit, changes
  one statement: the `TOPOLOGY_PRESENCE_SPAWN` invariant now accepts a matching `@ao-agent`. The
  later TM-274 commits do not touch `presence.mjs`. `kind` is still chosen at the `add(...)` calls:
  `role-session` or `external` for standing records, `spawn` or `run` for run records by the
  `spawn` token, `external` for pending enrolments. `schemaVersion` is still `2`.
- **Producer output.** `tests/unit/topology-presence-session-names.test.mjs` publishes a snapshot
  from a standing lead with a new-style name, a reviewer in a legacy `ao-<id>` session, a run of one
  agent whose pane says `@ao-kind: spawn`, a two-pane team run and a pending external session. It
  asserts each `session.kind`, then runs the v2 validator and `check.py --snapshot` over the real
  output.
- **Fixtures.** `fixtures/presence-session-names/check.py` runs the unmodified v1 and v2 validators.

## 11. Acceptance

From `agent-orchestration/`:

```bash
python3 topology/fixtures/presence-session-names/check.py                    # both directions
python3 topology/fixtures/presence-session-names/check.py --snapshot <file>  # name rules over real output
sha256sum -c <(grep -v '^#' topology/fixtures/presence-session-names/SESSION-NAMES-HASHES.txt)
node --test --test-concurrency=1 tests/unit/topology-presence-session-names.test.mjs
```

`check.py` requires:

- each `h*.json` to pass the schema validator for its declared version, unmodified, and the name
  rules, and the `h` set to cover every shape in §3.1, legacy ones included;
- `n01` to be rejected by the schema validator on the legacy spawn-name rule;
- `n02` and `n03` to be **accepted** by both gates and **misread** by a name parser, each for its
  declared reason.

## 12. Countersignature

The request to the gateway's repository lead is `topology/SESSION-NAMES-COUNTERSIGNATURE-REQUEST.md`.

— Marketplace Claude, TM-274 / ADR-0030, 2026-10-02
