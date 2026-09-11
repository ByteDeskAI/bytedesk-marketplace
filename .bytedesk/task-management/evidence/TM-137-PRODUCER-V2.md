# TM-137 — producer flipped to schemaVersion 2

## The condition that gated this, and how it was met

The gateway's acceptance had to be **committed**, not countersigned in prose. Verified in
their repository rather than from their message:

    bd8cefc0 on develop
    presenceSchemaVersionMin = 1, presenceSchemaVersionMax = 2
    return presenceRepoRoles[role] || (schema >= 2 && presenceRepoRolesV2[role])

Genuinely version-scoped: a v1 snapshot naming `designer` or `image-gen` stays invalid.

The producer guard test could not have stopped a premature flip, because flipping the
producer *is* changing the thing it guards. That is why the hold had to be a decision
rather than a check.

## What changed

| edit | file |
|---|---|
| `schemaVersion:1` → `2` on the wire | `presence.mjs` |
| `ROLES` gains `image-gen` — emitted, not mapped to `worker` | `presence.mjs` |
| `REPO_ROLES_V2 = {designer, image-gen}`, consulted after lead/reviewer | `presence.mjs` |
| the "producer has NOT started emitting v2" guard inverts | `topology-presence-header.test.mjs` |

`REPO_ROLES_V2` is its own set, mirroring the gateway's separate table. Merged into the v1
literals, the new values would be indistinguishable from ones v1 always allowed, and a v1
snapshot naming them would become retroactively legal — the contract both sides refused.

## Consequences the bump forced, each keeping its property

- `image-gen` asserted as `image-gen` where it was asserted as `worker` — the visible half.
- The *"an unrecognised role must appear, mapped, rather than vanish"* guarantee re-anchored
  on `lead`, which is outside v2's vocabulary too. **Opening a vocabulary is not removing
  the fallback that protects it**, and without this the next reader would assume the
  guarantee was retired along with the mapping.
- Four validator call sites over the producer's real output move to the v2 validator; two
  now **also assert the frozen v1 validator REFUSES** it. That refusal is what makes this a
  version bump rather than an additive change, so it is asserted rather than assumed.
- The call validating the frozen 7-snapshot corpus deliberately **stays** on the v1
  validator — it is the control proving the frozen fixtures are untouched. Moving it would
  have deleted the control.

## Verified (ran it)

| gate | result |
|---|---|
| **falsifiability**: revert only the wire version to 1 | both frozen-refuses tests go **red**; restore → green |
| `topology-presence-header.test.mjs` | 10 pass, 0 fail |
| `topology-presence.test.mjs` | 18 pass, 0 fail |
| full topology unit suite | 383 pass, 0 fail |
| full unit suite | 560 tests, 556 pass, 4 skipped, **0 fail** |
| frozen v1 validator + `test_validator.py` | pass, **files untouched** |
| `presence-v2/check.py` | ok, including claim 1b |
| `build:check`, `roadmap:check` | 0, 0 |

The falsifiability row is the one that matters. Without it these assertions would pass for
as long as nobody changed anything — the exact failure mode this epic spent the week on.

## Not done here

Retiring `PRESENCE-V2-ADDENDUM.md`'s draft status and the countersignature request document
is bookkeeping for whoever closes the contract thread; the wire change and its guards are
complete.
