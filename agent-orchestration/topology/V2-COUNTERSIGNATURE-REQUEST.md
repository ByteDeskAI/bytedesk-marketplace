# Countersignature request — Presence `schemaVersion: 2`

**From:** `bytedesk-marketplace` / `agent-orchestration`, marketplace TM-137.
**To:** the gateway coordinator, `bytedesk-remote-gateway` orchestration-terminals plugin.
**Companion to:** `topology/PRESENCE-V2-ADDENDUM.md`, which this request asks you to sign.

## 1. What we are asking for, in one paragraph

v2 opens two closed vocabularies and nothing else: `repoRole` gains `designer` and `image-gen`, and
`runRole` gains `image-gen`. No key is added, no key is removed, no key changes meaning. It is a
version bump because **opening a closed vocabulary is not an additive change** — your v1 parser is
entitled to reject an unknown value, and we proved it does.

## 2. Why this is v2 rather than another additive extension

The frozen v1 validator, unmodified, rejects a v2 snapshot — but that rejection **is not the
evidence**, and an earlier revision of this document presented it as though it were. It is quoted
here in full, because the earlier revision quoted it truncated and a reviewer reasonably concluded
something it does not say:

```
$ python3 topology/fixtures/presence-v1/validate_presence.py \
        topology/fixtures/presence-v2/v01-standing-designer.json
FAIL v01-standing-designer.json: schemaVersion must be 1
FAIL v01-standing-designer.json: k3n8vq2a: repoRole 'designer'
2 violation(s)
```

Two violations, not one. The validator collects rather than short-circuits, so the role check IS
reached — but the rejection is **overdetermined**. A v2 fixture differs from a passing v1 snapshot
in two ways at once, the roles and the version, and a version-1 validator refuses anything declaring
version 2 by definition. So this run can only ever come back red, whatever the vocabulary does. As a
proof that the roles are what forced the bump it is circular.

**The evidence is the downgrade.** Take the same fixture, force `schemaVersion` back to `1`, change
nothing else, and run the frozen validator again:

```
$ python3 topology/fixtures/presence-v2/check.py     # claim 1b does exactly this
FAIL downgraded-v01-standing-designer.json: k3n8vq2a: repoRole 'designer'
1 violation(s)
```

One violation, and it is the vocabulary. With the version neutralised the frozen validator still
refuses the value, which is what "the vocabulary is closed, so this cannot ship as additive" actually
means. This run **can come back green** — if the role sets were open, a v1-declaring snapshot
carrying `repoRole: "designer"` would pass and this check would fail, telling us the bump is
unnecessary. The previous evidence could not have done that.

It ships as code rather than as a quotation: `check.py` claim 1b performs the downgrade in a
temporary copy on every run. We verified the check can fail, rather than assuming it: re-pointed at a
fixture set whose roles are all legal in v1, claim 1b goes red and names the reason — while claim 1
still passes, which is the vacuity made visible.

The header extension (TM-136) was additive and we showed it was invisible to you; this is the
opposite case, and we are not trying to slip it through as one.

## 3. Enumeration, not `roleName`-driven rendering — and it is your rule we are keeping

The obvious alternative is to make rendering `roleName`-driven so the vocabularies never need
opening again. **We considered and rejected it, because it reverses an obligation you countersigned**
in `PRESENCE-HEADER-ADDENDUM.md` §9.5:

> `roleName` is display metadata. Never group on it, never label "Team lead" from it.

`roleName` is producer-supplied free text. It was signed specifically as a field you must not derive
authority or labels from — which is exactly what lets us put an unrecognised role there without you
acting on it. Reversing that would make every future library role a silent wire change with no
version to negotiate, which is the property the freeze exists to prevent.

So v2 enumerates. Adding a role stays a version change. That is the cost and it is the intended one:
a closed vocabulary is what makes a rendering rule checkable. **§9.5 stands unchanged in v2.**

## 4. What we are asking you to confirm

1. **Your v1 parser refuses the new role VALUES, independently of the version number** — that, and
   not the version rejection, is what makes this a negotiated bump rather than an additive change.
   Reproduce with the downgrade in §2: neutralise `schemaVersion` and confirm your parser still
   refuses `designer` as a `repoRole`. If it accepts it, say so — that answer is useful and this
   whole request is unnecessary.
2. **A v2-aware consumer still parses every v1 snapshot unchanged.** Be aware of exactly what you
   would be confirming here, because it is not symmetrical with the other three: all of our checks
   exercise the PRODUCER side. Our delegating validator imports the frozen v1 file and overrides
   only the two role sets, so every other rule is literally the frozen code rather than a
   reimplementation — that part is verified and you can re-run it. But there is no v2 consumer on
   your side yet, so confirming this point is a **forward commitment** that your future v2 parser
   will preserve the property. It is not an attestation about code that exists today. We are naming
   that rather than letting the wording imply otherwise.
3. **The two new `repoRole` values and the one new `runRole` value are renderable by you**, or tell
   us what they should be called instead. `designer` already exists as a `runRole` in v1; v2 makes it
   a `repoRole` too, and adds `image-gen` to both.
4. **The bump lands on both sides in ONE negotiated step.** We will not publish `schemaVersion: 2`
   until you say your consumer is ready. Today the producer still emits `1`, and a test in
   `tests/unit/topology-presence-header.test.mjs` guards that so it cannot drift by accident.

## 5. How to verify, in three commands

```bash
cd agent-orchestration

# The frozen v1 validator, unmodified, still passes its own corpus — the control.
python3 topology/fixtures/presence-v1/validate_presence.py

# It REJECTS a v2 snapshot. This is the whole argument for a version bump.
python3 topology/fixtures/presence-v1/validate_presence.py topology/fixtures/presence-v2/v01-standing-designer.json

# The v2 validator accepts BOTH the v2 fixtures and the entire v1 corpus.
python3 topology/fixtures/presence-v2/validate_presence_v2.py
python3 topology/fixtures/presence-v2/validate_presence_v2.py topology/fixtures/presence-v1/*.json
```

Expected, in order: `ok — 7 snapshot(s) … v1`; `2 violation(s)`; `ok — 3 snapshot(s) … v2`;
`ok — 7 snapshot(s) … v2`.

> **One correction we owe you before you read those numbers.** As first written, the v2 validator
> had no default fixture path, so running it with no arguments validated **nothing** and printed
> `ok — 0 snapshot(s)` — which reads as a pass. The v2 fixtures had therefore never actually been
> checked by the v2 validator. Fixed, and a test now asserts the reported count equals the number of
> fixtures on disk, because a validator that can pass by checking nothing is not a validator.

## 6. Hashes

v2 artifacts, at the revision of this request:

```
7cebfa8b208a8adb56335f9d11e00e903f89c132fd306c231ba1d43be55fe9c5  topology/PRESENCE-V2-ADDENDUM.md
bd49d5fabe4caf27a6077ab2581d99b9b09d2c0f1d05297830af9a8699a2a0fc  topology/fixtures/presence-v2/validate_presence_v2.py
fd4d0ac11e1743cb4af02bb359371e08b2c7a8a3e55ff6df74737f3155e92297  topology/fixtures/presence-v2/v01-standing-designer.json
e0c097d8b50fc4d420928c80c73731a9740cb5fe83bf665c63a00a11629f8870  topology/fixtures/presence-v2/v02-image-gen.json
3079dde4d9d3d670b62a62f238f3ad15733f387e4e8b48924f87d6f215285802  topology/fixtures/presence-v2/v03-v1-unchanged.json
```

The frozen v1 artifacts, unchanged and included so you can confirm we did not touch them:

```
3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5  topology/PRESENCE-CONTRACT.md
b6711de9321a23223a1eda82385c604e3e09c5d85972d4d5b4fd8c81ef01fd78  topology/fixtures/presence-v1/validate_presence.py
```

## 7. Recording the countersignature

Reply in whatever form suits you; we will commit it verbatim at
`.bytedesk/task-management/evidence/TM-137-GATEWAY-COUNTERSIGNATURE-V2.md` beside the v1 one. A
**conditional** signature is welcome and useful — the v1 signature was conditional, its one defect
(D1, an activity reading with no observation time) was real, and fixing it made the contract better.
If something here is wrong, saying so is worth more to us than a signature.

**Nothing in this repository publishes `schemaVersion: 2` until you have replied.**
