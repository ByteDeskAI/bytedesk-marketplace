# Presence `schemaVersion: 2` — opening the role vocabularies

**Status: DRAFT, awaiting the gateway coordinator's countersignature.** Nothing in this document is
in effect, and the producer still emits `schemaVersion: 1`. Marketplace TM-137.

## 1. What changes, and it is only this

Two closed vocabularies open. Nothing else in the contract moves.

| field | v1 | v2 |
|---|---|---|
| `repoRole` | `lead` \| `reviewer` \| `member` | adds `designer`, `image-gen` |
| `runRole` | seven tokens, no `image-gen` | adds `image-gen` |
| `schemaVersion` | `1` | `1` or `2` |

The six-tuple binding, the counters, the bounds, the grouping rules, `lifecycle`, and every key the
v1 header extension added are untouched.

## 2. Enumeration, not `roleName`-driven rendering — and why

The obvious alternative was to make rendering `roleName`-driven, so the vocabularies never need
opening again. **That was considered and rejected**, because it reverses an obligation the gateway
countersigned in `PRESENCE-HEADER-ADDENDUM.md` §9.5:

> `roleName` is display metadata. Never group on it, never label "Team lead" from it.

`roleName` is producer-supplied free text carrying whatever the agent library happens to say. It was
signed *specifically* as a field a consumer must not derive authority or labels from, and that is
what lets the producer put an unrecognised role there without a consumer acting on it. Reversing it
would make every future library role a silent wire change with no version to negotiate — the exact
property the freeze exists to prevent.

So v2 enumerates. Adding a role stays a version change, which is the cost, and it is the intended
cost: **a closed vocabulary is what makes a rendering rule checkable.**

§9.5 stands unchanged in v2.

## 3. What a consumer may now render

`repoRole` remains the *only* source of repository standing, and contract §10.7 — label from
`repoRole` only, never parse a session name — is unchanged. What changes is that two more values
can appear there:

- `repoRole: "designer"` — a standing designer. Renderable as such.
- `repoRole: "image-gen"` — a standing image-generation agent. Renderable as such.

**"Team lead" is still rendered from `repoRole === "lead"` and from nothing else.** Opening the set
does not weaken that rule; it adds siblings to it.

## 4. What the producer stops doing

Under v1 a standing designer collapses to `repoRole: "member"` and an `image-gen` run agent is
mapped to `runRole: "worker"`, with the truth carried in `roleName` where a consumer may read it but
not act on it. Under v2 both carry their own token and the mapping is no longer needed for these two
roles. The mapping itself **stays** for roles neither side has enumerated — dropping an agent is
still strictly worse than mislabelling one.

## 5. Consumer obligations

Additions to contract §10 and header-addendum §9.

1. A v2 consumer **must keep parsing v1**. `schemaVersion: 1` snapshots do not disappear.
2. Treat an unrecognised `repoRole` or `runRole` as `member` / `null` respectively and render the
   agent, never reject the snapshot. That is what makes v3 survivable.
3. §9.5 is unchanged: `roleName` is still display metadata and still not a label source.

## 6. Fixtures and how to check this

`topology/fixtures/presence-v2/`, stdlib python3 only, exactly as the v1 suites are:

```
python3 topology/fixtures/presence-v2/check.py
```

It asserts three things, each as a command:

1. the **frozen** v1 validator REJECTS every v2 fixture — this is what makes the version bump real;
2. the v2 validator accepts them;
3. **both** validators accept an unchanged v1 snapshot — obligation 1 as a file, not a sentence.

`validate_presence_v2.py` does not reimplement the contract. It imports the frozen v1 validator,
overrides exactly the two vocabularies, and delegates every remaining rule to the frozen code, so it
cannot drift from v1 on anything v2 did not change.

## 7. Countersignature and the negotiated bump

This takes effect when the gateway coordinator countersigns, and the bump must land on both sides in
the same negotiated step — the producer must not emit `schemaVersion: 2` before a v2-aware consumer
exists, because a v1 consumer rejects these snapshots outright, as §6 claim 1 demonstrates.

Until then the producer stays at v1 and a standing designer remains **visible but unlabelled**:
carried in `roleName`, mapped to a legal `repoRole`, never dropped. That is what TM-138 landed, and
it is why this can wait without the operator losing the agent from the header.
