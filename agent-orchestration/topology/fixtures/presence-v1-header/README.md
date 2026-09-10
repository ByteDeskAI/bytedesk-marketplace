# Presence v1 header-extension fixtures — marketplace TM-136

Acceptance artifact for `../../PRESENCE-HEADER-ADDENDUM.md`. **The frozen `../presence-v1/`
directory is never touched by anything here** — this directory reads its validator and nothing else.

```
python3 check.py     # the one command; runs the frozen validator in both directions
```

## What each fixture is for

| File | Must | Proves |
|---|---|---|
| `h01-header-full.json` | **pass** the frozen validator | Every additive key at once — `activity`, `mailboxDepth`, `task`, `roleName`, `slots` per agent, and `slotQueues` on the envelope — is invisible to a v1 validator. The validator has no key whitelist. |
| `h02-header-sparse.json` | **pass** the frozen validator | The omission cases, which are where a careless producer coerces: a lead with nothing computed, a **tombstone** (`activity.observed: false`), a rationed capture reported as `unknown` rather than `idle`, a `task` **omitted** because the assignee did not match `^[A-Z]+-[0-9]+$`, and the unknown-role mapping (`runRole: "worker"` + `roleName: "image-gen"`). |
| `n01-repo-role-designer.json` | **FAIL** the frozen validator | The mechanical evidence that opening a closed vocabulary is `schemaVersion: 2` and not additive. It is `h01` with one value changed — `repoRole: "designer"` — and the frozen validator rejects it by exact membership. |

**Every `activity` block carries `observedAt`** — gateway defect D1, and the condition its
countersignature attached to this key. `since` is when a state was ENTERED; `observedAt` is when it
was last CONFIRMED, taken from the census document's own top-level `at`. The two exist separately
because presence and the census run on deliberately different clocks, so a snapshot that is fresh by
every rule this contract enforces can carry an activity reading up to 45 s old.

In `h01` the live readings are confirmed **seven seconds before** `generatedAt`, not at it. That gap
is the fixture's whole point: a fixture where the two timestamps matched would assert the coupling
D1 says does not exist, and would teach a consumer to trust a reading it cannot date. The frozen
validator has no knowledge of `activity` and cannot check any of this — `tests/unit/topology-presence-header.test.mjs`
is the gate that does.

`h02` also carries `activity.state` values of `unknown`, `dead` and `working`, and `h01` carries
`idle`, `needs-input`, `working`, `quota-blocked` and `attention`. Between them the **seven** census
states in `topology/lib/census.mjs:34` all appear — including `attention` and `unknown`, which the
Phase 7 plan's five-value shorthand omits and which the addendum §3.1 explains must not be dropped.

## Why the negative fixture is the important one

Seven passing fixtures cannot distinguish "the validator accepts our extension" from "the validator
accepts anything". `n01` is the control: same validator, same run, one changed value, red. Without
it, §1 of the addendum would be an assertion instead of a measurement.

## Relationship to the frozen suite

- These files are **not** successors to `01`..`07` and are never validated alongside them. The frozen
  validator's cross-snapshot rules key on the frozen filenames, so a differently-named file
  participates in none of them — deliberately, so this directory can never perturb the frozen
  acceptance.
- `check.py` invokes `../presence-v1/validate_presence.py` as a subprocess, unmodified. If that
  script ever needs editing to make these fixtures pass, the extension has leaked into the frozen
  contract and is wrong.
- Hashes for these artifacts, next to the frozen contract hash, are in
  `HEADER-EXTENSION-HASHES.txt`.

## Notes

- Names, ids and tmux values are synthetic and inherited from `01-exact-match.json`, so a reviewer
  can diff against it and see only the additive keys.
- `schemaVersion` stays `1` in every file here, including the negative one. The negative fixture is
  not a v2 snapshot; it is a v1 snapshot carrying a value v1 does not permit, which is exactly the
  mistake this directory exists to make impossible to ship by accident.
