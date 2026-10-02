# Presence session-name fixtures — marketplace TM-274 / ADR-0030

Acceptance artifact for `../../PRESENCE-SESSION-NAMES-ADDENDUM.md`. Nothing here edits
`../presence-v1/`, `../presence-v2/` or any other hashed fixture; this directory runs their validators
unmodified.

```
python3 check.py                          # fixture acceptance, both directions
python3 check.py --snapshot <file.json>   # the session-name rules over a produced snapshot
```

## Files

| File | Must | Proves |
|---|---|---|
| `h01-v2-new-names.json` | **pass** the v2 validator and the name rules | Every new shape at once: a lead and a reviewer `role-session`, a run of one agent (`kind: "run"`, `spawn: null`), a two-pane team run sharing `core--…--parallel-review--ada`, and an `external` `zsh`. |
| `h02-v2-legacy-lead.json` | **pass** the v2 validator and the name rules | Both generations in one snapshot: a lead still in `ao-k3n8vq2a`, a legacy spawn `b4h6rt1c-1f4c9de`, beside new-style sessions. |
| `n01-spawn-kind-new-name.json` | **fail** the v2 validator, on the spawn-name rule | `kind: "spawn"` with a new-style name. The frozen rule reserves `spawn` for `<agentId>-<7 hex>`, so the producer publishes a new-style one-agent run as `run`. |
| `n02-lead-name-on-external.json` | **pass** both gates, and be **misread** by a name parser | An `external` session named `…--lead--priya` beside the real lead in `ao-k3n8vq2a`. Parsing the name finds a second lead. |
| `n03-workflow-named-reviewer.json` | **pass** both gates, and be **misread** by a name parser | A team run of a workflow called `reviewer`: both panes are workers, the name says `reviewer`. |

`n02` and `n03` are valid snapshots. That is their point: the schema cannot stop a misleading name,
so only the consumer's rule — read `session.kind`, never the name — protects it.

`check.py` also checks that the `h` set covers every shape in addendum §3.1, so a pass cannot come
from a fixture set that is missing one.

Hashes for these files, the new documents, and the frozen and signed artifacts they must not change
are in `SESSION-NAMES-HASHES.txt`.
