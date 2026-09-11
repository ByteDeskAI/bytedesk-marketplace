# Presence role-icon fixtures — marketplace TM-168

Acceptance artifact for `../../PRESENCE-ROLE-ICON-ADDENDUM.md`. Nothing here edits `../presence-v1/`,
`../presence-v1-header/` or `../presence-v2/`; this directory runs their validators unmodified.

```
python3 check.py                          # fixture acceptance, both directions
python3 check.py --snapshot <file.json>   # the role-icon rules over a produced snapshot
```

## Files

| File | Must | Proves |
|---|---|---|
| `role-icon-map.json` | equal the registry | The exact mapping, generated from `topology/lib/identity.mjs` with code points. `tests/unit/topology-presence-role-icon.test.mjs` fails if it drifts. A consumer may load it directly. |
| `h01-v1-role-icons.json` | **pass** the frozen v1 validator and the rules | `presence-v1-header/h01-header-full.json` plus `roleIcon` and `roleLabel` on every agent, `schemaVersion: 1`. Additive keys are invisible to the frozen validator. |
| `h02-v2-fallbacks.json` | **pass** the v2 validator and the rules | What the producer emits (`schemaVersion: 2`): a lead inside its own run (`roleName: "orchestrator"`, lead icon), a standing designer, an `image-gen` run member, a custom role (`data-wrangler`, fallback) and an enrolled session with no definition (no `roleName`, fallback). |
| `n01-icon-as-repo-role.json` | **fail** the frozen validator, on `repoRole` | An icon put where authority lives is a contract violation. The frozen gate catches it. |
| `n02-lead-icon-on-worker.json` | **pass** the frozen validator, **fail** the rules | A worker entry carrying the lead icon. Only the derivation rule sees it. |
| `n03-escape-in-icon.json` | **pass** the frozen validator, **fail** the rules | An OSC title-setting escape (`ESC ] 0 ; … BEL`) in `roleIcon`. Only the control-character rule sees it. |
| `n04-icon-without-label.json` | **pass** the frozen validator, **fail** the rules | An icon with no accessible label. Only the pairing rule sees it. |

The `n02`–`n04` rows are the reason the rules exist: `check.py` requires the frozen validator to
**accept** each of them, so the rules are shown to be necessary, and requires the rules to reject each
one for its declared reason.

The gateway's Go parser (`presence.Parse`, develop `bd576d09`) also accepts `n02`–`n04`. A consumer
must check `roleIcon` against the map when it renders, not trust it because the snapshot parsed.

Hashes for these files, the new documents, and the frozen and signed artifacts they must not change
are in `ROLE-ICON-HASHES.txt`.
