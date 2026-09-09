# Presence v1 — cross-repository presence contract

**Revision 3 (pre-freeze).** Supersedes revisions 1-2 and PRESENCE-CONTRACT-DRAFT.md.
Producer: `bytedesk-marketplace` / `agent-orchestration` — marketplace **TM-128**, produced under **TM-127 AC 12**.
Consumer: `bytedesk-remote-gateway` orchestration-terminals plugin — **Gateway TM-222**.

Revision 2 applied all six findings in CONTRACT-REVIEW.md, marked **[R#]** where they land.
Revision 3 applies the three concrete corrections Gateway TM-222 raised against revision 2, marked
**[G#]**: strict counter typing and integer ordering, agreed bounds on TTL/skew/depth, and the
cold-start distinction between unknown and standalone. Freeze procedure and hashes are in §11.

---

## 1. Discovery and location

```
${AGENT_ORCHESTRATION_STATE_HOME:-${XDG_STATE_HOME:-~/.local/state}/bytedesk/agent-orchestration}/presence/<repositoryKey>.json
```

This is the plugin's existing state root — `agent-orchestration/src/config.mjs:10-20` already resolves
`stateRoot()` there, honouring `AGENT_ORCHESTRATION_STATE_HOME` first, and using
`%LOCALAPPDATA%/ByteDesk/agent-orchestration` on Windows. No new convention. A `presenceDir` key in
the global config may override the `presence/` directory outright.

One snapshot file per repository. Writes are atomic: write `<repositoryKey>.json.tmp` in the same
directory, `fsync`, `rename`. Readers never see a partial file; a reader that gets `ENOENT` retries
once before concluding the snapshot is missing.

The host restricts reads to this configured directory and matches only registered repositories and
authorized tabs. The consumer **never executes the producer** and reads nothing else under the state
root — mailboxes, prompts and run directories live there too and are out of bounds.

### `repositoryKey`

```
repositoryKey = sha256(realpath(git rev-parse --path-format=absolute --git-common-dir))[0..16]
```

Sixteen lowercase hex characters. The **common** directory is the point: every linked worktree
resolves to the same key, which is the identity the repository lead is keyed on. `repositoryRoot`
carries the main checkout's absolute path alongside it, for display only.

## 2. Envelope

```jsonc
{
  "schemaVersion": 1,
  "repositoryKey": "9f2c41ab77e0d3b5",
  "repositoryRoot": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace",
  "generation": "12",                // persistent monotonic counter, one per producer incarnation
  "revision": "417",                 // decimal string, strictly increasing within a generation
  "generatedAt": "2026-09-09T06:58:41.220Z",
  "staleAfterMs": 30000,
  "clockSkewToleranceMs": 5000,
  "agents": [ /* §4 */ ]
}
```

Unknown envelope keys are **ignored, not rejected** — that is how a v1 consumer survives a v1.x
producer. A `schemaVersion` the consumer does not know is `unknown` (§6), not empty.

### 2.1 Ordering never uses the wall clock **[R5]**

Revision 1 ordered across restarts by `generatedAt`. That is unsafe: a wall-clock adjustment
reorders snapshots, and an arbitrarily future timestamp makes a snapshot look fresh forever.

- **`generation`** is a decimal string holding a **persistent monotonic counter**, incremented once
  per producer incarnation and stored beside the snapshots (`presence/.generation`, written with the
  same atomic replace). It is not derived from any clock. A producer that cannot read or increment
  its generation marker **must not publish** — it stops and reports, rather than emitting an
  unorderable snapshot.
- **`revision`** is a decimal string, strictly increasing **within** a generation, reset to `"0"` on
  a new generation.
- **Both counters are JSON strings of ASCII decimal digits** — `"12"`, never `12`, and never a
  non-ASCII digit. **[G1]** A producer emitting a JSON number is invalid. The distinction matters
  because the values exceed nothing in practice but must survive round-tripping through consumers
  that would otherwise re-serialise them with different numeric precision.
- **Ordering is `(generation, revision)` compared as INTEGERS, never as text.** **[G1]** Text
  comparison sorts `"10"` before `"9"`, silently reversing the order across the tenth restart. Parse
  both components before comparing. That is a total order across restarts with no clock involved.
- `generatedAt` is used **only** for staleness (§2.2), never for ordering.

### 2.2 Staleness has a named clock, and future timestamps are bounded **[R5]**

- `generatedAt` is the **producer's wall clock**, RFC 3339 with an explicit `Z`.
- The consumer compares against **its own wall clock**:
  `stale ⟺ now − generatedAt > staleAfterMs + clockSkewToleranceMs`.
- **Future bound:** if `generatedAt − now > clockSkewToleranceMs`, the snapshot is **invalid** and
  takes the `unknown` path in §6. It is never treated as fresh. This is what stops a bad clock
  pinning a snapshot as current indefinitely.
- `clockSkewToleranceMs` is carried in the envelope, so the producer owns the allowance. Default
  `5000`.
- **Both values are bounded, and a snapshot outside these bounds is INVALID** — it takes the
  `unknown` path in §6, exactly as malformed JSON does. **[G2]** An unbounded skew would re-admit
  arbitrarily future data through the allowance that §2.2 exists to close.

  | Field | Range (inclusive) | Default |
  |---|---|---|
  | `staleAfterMs` | `1000` .. `300000` | `30000` |
  | `clockSkewToleranceMs` | `0` .. `30000` | `5000` |

  Both must be **strict JSON integers**. A JSON boolean is not an integer, and a validator written
  in a language where `true` is an integral type must exclude it explicitly.
- The producer **rewrites the snapshot at least every `staleAfterMs / 3`**, even when nothing
  changed. That heartbeat is what makes the absence of a rewrite meaningful. Default `staleAfterMs`
  is `30000`, so the heartbeat is every 10 s.

## 3. Roles are two fields, not one

The draft proposed a single `role: team-lead|coordinator|worker`. None of those exist in the
producer, which has eight roles (`topology/lib/identity.mjs:29-38`): `lead`, `orchestrator`,
`worker`, `designer`, `judge`, `reviewer`, `researcher`, `implementer`.

One field also cannot carry the distinction the plan requires. `topology/lib/mailbox.mjs:395-397`
documents it: *"a spec has exactly one `orchestrator` and no `lead` role pack, so a repo's lead
appears in its own run as `role: "orchestrator"`."*

- **`repoRole`** — repository standing, read from the agent library at
  `.bytedesk/agent-orchestration/agents/<id>/`. One of `lead` | `reviewer` | `member`.
  `topology/lib/agents.mjs:92-99` (`findLead`) permits at most one `lead` per repo, raising
  `TOPOLOGY_MULTIPLE_LEADS` otherwise; the dedicated persistent reviewer from
  MANAGEMENT-ADDENDUM.md is `repoRole: "reviewer"` under the same at-most-one rule.
- **`runRole`** — the spec role verbatim for the run this session participates in, or `null`.

**"Team lead" is rendered from `repoRole === "lead"` and from nothing else.** `runRole ===
"orchestrator"` is never evidence of repository leadership.

## 4. Agent session entry

```jsonc
{
  "agentId": "k3n8vq2a",
  "displayName": "Priya Raman",
  "title": "Engineering Lead",
  "repoRole": "lead",
  "runRole": "orchestrator",
  "coordinatesOnly": true,
  "enrollment": "enrolled",          // pending | enrolled | detached
  "lifecycle": "ready",              // starting | ready | busy | unresponsive | dead
  "readinessCheckedAt": "2026-09-09T06:58:39.880Z",
  "session": {
    "kind": "role-session",          // spawn | role-session | run | external
    "serverKey": "/tmp/tmux-1000/default",
    "serverPid": 24390,
    "sessionId": "$7",
    "sessionCreated": 1788902620,
    "sessionName": "ao-k3n8vq2a",
    "paneId": "%3",
    "panePid": 25863,
    "spawn": null
  },
  "memberships": [
    { "runId": "run-root-0a", "parentRunId": null, "rootRunId": "run-root-0a",
      "runName": "lead-rollout", "depth": 0, "chain": ["lead-rollout"] }
  ],
  "primaryRunId": "run-root-0a"
}
```

### 4.1 The binding key includes the server and session incarnation **[R2]**

Revision 1 keyed a terminal on `(serverKey, paneId)`. That is insufficient: tmux `%N` pane ids and
`$N` session ids are per-server counters, so a restarted server on the same socket path reuses them
and stale metadata would label an unrelated new process.

**The binding key is the full six-tuple:**

```
(serverKey, serverPid, sessionId, sessionCreated, paneId, panePid)
```

Every component comes from a tmux format string, verified on tmux 3.4 — `#{socket_path}`, `#{pid}`,
`#{session_id}`, `#{session_created}`, `#{pane_id}`, `#{pane_pid}`. No `/proc`, no OS-specific
probing.

`serverPid` changes when the server restarts, which is the common case. `sessionCreated` and
`panePid` change when a session or pane is recreated **within** one server, which `serverPid` alone
would miss. A consumer holding a binding whose six-tuple no longer matches the current snapshot
**must drop it** rather than re-attach the old metadata.

### 4.2 Grouping is by run, never by `agentId` **[R3]**

Revision 1 said the consumer "groups on `agentId`". That is wrong, and it would merge unrelated
groups: one agent can hold different spawns in different runs.

- Each **binding** (§4.1) is placed in exactly one group.
- The group is determined by **repository → the binding's `primaryRunId`'s root run**, or by
  standing / standalone / unresolved status (§6.1).
- **`agentId` never merges groups.** Two bindings sharing an `agentId` in two different runs stay in
  their two run groups. `agentId` identifies *who* a binding belongs to, for display and for
  deduplicating a person's identity in the UI — it is not a grouping key.

### 4.3 Identity is not incarnation

`agentId` is 8 characters, minted once and stable for the agent's life. One agent may appear more
than once in `agents[]` with different `session` bindings. The producer already models this:
`topology/lib/identity.mjs:103` composes a spawn session name as `` `${agentId}-${spawn}` `` where
`spawn` is exactly seven hex characters from `mintSpawn`.

### 4.4 `session.kind` — the consumer must never parse a session name

Three producer-side name shapes exist and are not interchangeable.
`topology/lib/identity.mjs:118-121` (`parseSessionName`) returns `null` for two of them.

| `kind` | Name shape | Example |
|---|---|---|
| `spawn` | `<agentId>-<7 hex>` | `k3n8vq2a-1f4c9de` |
| `role-session` | `ao-<id>` | `ao-k3n8vq2a` |
| `run` | workflow-derived | `p1-slow-20260905-3b` |
| `external` | anything | `zsh` |

A consumer that regex-matches a session name reads a durable role-session as unparseable and
silently drops the repository lead. **`session.kind` is authoritative; the name is display only.**

### 4.5 Ancestry, and `depth` is not capped at 3 **[R4]**

Lineage travels in the environment (`topology/lib/lineage.mjs:34-49`) as `AO_PARENT_RUN_ID`,
`AO_RUN_DEPTH` and `AO_RUN_CHAIN` — where **`chain` is workflow NAMES, not run ids**, deliberately,
because cycle detection needs names. There is no root run id in the environment; the producer
resolves `rootRunId` by walking `AO_PARENT_RUN_DIR` ancestry on disk.

- `MAX_DEPTH = 3` (`topology/lib/lineage.mjs:26`) is the **default limit, not a ceiling**:
  `--max-depth` raises it (`topology/cli.mjs:357,397`). `depth` is therefore **any bounded
  non-negative integer** in the agreed range **`0..64`** **[G2]** — high enough that no configured
  `--max-depth` reaches it, bounded so producer and consumer reject the same values rather than each
  picking a private limit. A consumer **must not reject or hide a run solely because `depth > 3`**;
  it renders deeper ancestry safely, capping *rendering* (nesting indent, label length) rather than
  discarding data. `depth` is a strict integer, booleans excluded.
- A run at `depth: 0` is the root: `rootRunId === runId` and `parentRunId === null`.
- `rootRunId` is `string | null`. **Null means "not resolvable" — never "this is the root".**

## 5. Exclusions — hard

Never present at any version: tokens or credentials, raw environment, provider auth, system-prompt or
template content, mailbox message bodies or subjects, task bodies, file diffs, captured terminal text.

Presence is **read-only metadata**. It is not authority to send a command, change membership, start or
stop a session, or bind a tab.

## 6. Snapshot application and failure semantics **[R1]**

Revision 1 said only `agents: []` clears membership. That was a bug: one remaining worker would
prevent every departed worker from ever leaving its group.

**A valid, fresh snapshot is complete and authoritative for its repository. It REPLACES the
membership set.** A binding present in the previous snapshot and absent from this one is removed.
An entry that reappears with `enrollment: "detached"` is likewise no longer a member.
`agents: []` is simply the degenerate case of that rule, not a special case.

| Situation | Consumer behaviour |
|---|---|
| **Valid + fresh** (any `agents`, empty or not) | **Replace** the membership set wholesale. Bindings absent from it are removed; groups that lose every member disappear. |
| **File missing**, unreadable, malformed JSON, unknown `schemaVersion`, counters not decimal strings, `staleAfterMs`/`clockSkewToleranceMs`/`depth` outside their bounds, or `generatedAt` beyond the future bound (§2.2) | **`unknown`.** Retain the last known grouping, labelled unknown — and where there is none, terminals are `unknown`, **not** standalone **[G3]**. Not a zero-member result. |
| **Present but stale** (§2.2) | Retain the last known grouping, **visibly labelled stale**. Do not reassert it as fresh, do not drop to standalone. |
| **Older than what is already held** by `(generation, revision)` (§2.1) | Ignore entirely. |

### 6.1 Group states

- **standalone** — a terminal, belonging to a registered repository **whose snapshot has been read
  valid and fresh**, whose binding does not appear in it. An unenrolled terminal; a normal state,
  not an error.
- **unknown** — a terminal for which no valid fresh snapshot has been read: the file is missing,
  unreadable, malformed, out of bounds, or stale. Visibly distinct from standalone.

**[G3] At cold start, a registered repository's terminals are `unknown`, not `standalone`.** The two
states are separated by *whether authoritative metadata was successfully read*, never by whether the
consumer happens to hold a prior grouping. Having no previous grouping is not evidence of
non-membership — a freshly opened Gateway that cannot read a snapshot knows nothing, and must say so.
Only a valid, fresh, authoritative snapshot moves a terminal out of `unknown`, into membership or
into `standalone`.
- **standing** — `primaryRunId: null` with `memberships: []`. The repository lead, the dedicated
  reviewer, or any enrolled session outside a run. These form the standing team group.
- **pending** — `enrollment: "pending"`. Observed by the tmux watcher, handshake not completed. Shown
  as pending, **not** as a member, and never described as having been blocked.
- **unresolved** — `rootRunId: null`. See §6.2.

### 6.2 An unresolvable root is never grouped by resemblance **[R6]**

A membership with `rootRunId: null` is rendered **visibly unresolved** and is **not** placed in any
root group. Grouping requires verified parent/run identity.

**Identical `chain`, `runName` or `depth` is not affiliation.** Two runs of the same workflow have
the same chain and different roots by construction — that is precisely why `chain` holds names and
not ids. A consumer that groups on chain similarity manufactures an affiliation that does not exist.
Unresolved entries may be collected in a single "unresolved" bucket for display, but that bucket
asserts no relationship between its members.

Disabling the Gateway plugin removes its contributions and **never closes a terminal**.

## 7. Coverage

`agents[]` contains **both** standing sessions and run participants. A standing session is not
required to appear in any run's `run.agents`.

## 8. Fixtures and the conformance check

Canonical fixtures are in `fixtures/presence-v1/`, with `validate_presence.py` — stdlib only,
runnable by either repo, so "we agree on the schema" is a command rather than an opinion — and
`test_validator.py`, which asserts the validator **rejects** what it must. **[G1][G2]** Seven valid
fixtures cannot detect a validator that accepts a JSON-number counter or an unbounded skew; the
negative suite is what proves the tick means something. Run both:

```
python3 validate_presence.py     # the fixtures conform
python3 test_validator.py        # the validator goes red when it should
```

| File | Case |
|---|---|
| `01-exact-match.json` | Lead + standing reviewer + run implementer + one `pending` external. Full six-tuple bindings. |
| `02-stale.json` | Well-formed, far past `staleAfterMs`. Retain labelled last-known. |
| `03-nested-runs.json` | `depth` 0/1/2, plus a `depth: 5` entry from a raised `--max-depth` **[R4]**, plus a `rootRunId: null` orphan **[R6]**. |
| `04-standing-session.json` | Lead + reviewer only, no run. |
| `05-empty-clears.json` | Valid, fresh, `agents: []`. Clears membership. |
| `06-membership-removal.json` | **[R1]** Successor to `01`: same generation, higher revision, one of the run agents gone and another `detached`. Proves individual removal without an empty list. |
| `07-server-restart.json` | **[R2]** Same socket path, **new `serverPid`**, reused `$`/`%` ids and `panePid`s. Every prior binding must be dropped, not re-labelled. |

The **missing-snapshot** case has no file by definition — delete the file, or point at a
`repositoryKey` with none. Result is `unknown`, contrasted with `05`, which is a successful zero-member
result. A consumer that treats those two the same has the bug this set exists to catch.

Producer commits these into the repo under TM-127 AC 12, at
`agent-orchestration/topology/fixtures/presence-v1/`. This coordinator does not write into
`agent-orchestration/` — that path is owned by the TM-127 worker.

## 9. Producer obligations, summarised

1. Publish atomically; never publish without a readable, incrementable generation marker.
2. Heartbeat at `staleAfterMs / 3`.
3. Emit the complete membership set every time — the snapshot is authoritative, not a delta.
4. Emit the full six-tuple binding for every session.
5. Resolve `rootRunId` or emit `null`; never guess.
6. Emit counters as ASCII decimal **strings**, and `staleAfterMs`/`clockSkewToleranceMs`/`depth`
   within the bounds in §2.2 and §4.5. **[G1][G2]**
7. Never emit anything in §5.

## 10. Consumer obligations, summarised

1. Order by `(generation, revision)`; never by `generatedAt`.
2. Treat a future `generatedAt` beyond tolerance as invalid.
3. Replace the membership set on every valid fresh snapshot.
4. Key bindings on the six-tuple; drop a binding whose tuple no longer matches.
5. Group by repository → root run / standing / standalone / unresolved. Never by `agentId`, never by
   chain resemblance.
6. Render `depth > 3` safely rather than rejecting it.
7. Label "Team lead" from `repoRole` only; never parse a session name.
8. Treat an out-of-bounds or wrongly-typed counter, TTL, skew or depth as **invalid**, not as a
   value to clamp. **[G1][G2]**
9. Show a registered repository's terminals as `unknown` until a valid fresh snapshot is read —
   never as `standalone` merely because nothing has been read yet. **[G3]**

## 11. Freeze **[coordination]**

This is revision 2. To freeze:

1. Gateway (%35, TM-222) reviews §§2.1, 2.2, 4.1, 4.2, 4.5, 6, 6.1, 6.2 — where the review findings
   landed. Revision 3's changes are marked **[G1]**, **[G2]**, **[G3]**.
2. Both sides run `python3 fixtures/presence-v1/validate_presence.py` **and**
   `python3 fixtures/presence-v1/test_validator.py`, and get a clean pass from each.
3. Gateway records in GATEWAY-ACK.md the **sha256 of this file** together with the sha256 of each
   fixture, as printed by `CONTRACT-HASHES.txt` in this directory.
4. Marketplace countersigns in MARKETPLACE-ACK.md. v1 is frozen at that hash set; later changes go
   to `schemaVersion: 2`.

Anything in §§9-10 you need changed, say so in GATEWAY-ACK.md before step 3 — changing it now is free.

— Marketplace Claude, pane %3, 2026-09-09 (revision 3)
