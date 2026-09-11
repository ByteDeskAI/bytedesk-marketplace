# Presence role icons — additive extension (`roleIcon`, `roleLabel`)

**Status: in effect for the producer; gateway countersignature requested for the rendering
obligations.** Marketplace **TM-168**.
Producer: `bytedesk-marketplace` / `agent-orchestration`.
Consumer: `bytedesk-remote-gateway` orchestration-terminals plugin.

This document sits **beside** the existing presence documents and edits none of them:

| Document | State | sha256 |
|---|---|---|
| `PRESENCE-CONTRACT.md` | frozen, countersigned | `3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5` |
| `PRESENCE-HEADER-ADDENDUM.md` | signed, then amended for gateway defect D1 | `e92a54f27596b853e6a88c520ae5ee23c990fc43b4c50bc6bba5940f315d88b3` |
| `PRESENCE-V2-ADDENDUM.md` | in effect (`schemaVersion: 2`) | recorded in `fixtures/presence-role-icon/ROLE-ICON-HASHES.txt` |

`schemaVersion` stays `2`. No existing key changes type, meaning or vocabulary.

**A note on the header addendum's hash.** TM-136 recorded `6f15b383…` (commit `387e4ec`). The D1
amendment the gateway asked for (`830c983`, adding `activity.observedAt`) changed that document and
the `presence-v1-header` fixtures, and no hash record was updated afterwards. The hash above is the
file as it stands at `6bf4faa`, where this change began. This change does not modify it;
`ROLE-ICON-HASHES.txt` records both states.

---

## 1. Outcome

Every presence agent entry now carries two optional display keys:

- `roleIcon` — one Unicode icon for the agent's effective role;
- `roleLabel` — the short readable text for the same role.

The pair is computed by one registry (`topology/lib/identity.mjs`, `roleVisual`). It is the same pair
the marketplace shows in terminal title bars, `run.json` and the CLI, so a person sees one icon for
one agent everywhere. It is **display only**: nothing reads it back to decide a role, a route, a
grouping or an authority.

The producer emits both keys **now**. Section 10 shows that the frozen v1 validator, the v2
validator and the gateway's own Go parser all accept them unchanged. The countersignature requested
in `ROLE-ICON-COUNTERSIGNATURE-REQUEST.md` is for how the gateway **renders** them, not for whether
it can parse them.

## 2. Field contract

```jsonc
"roleIcon":  "👑",    // string, exactly one value from the mapping in §4
"roleLabel": "Lead"   // string, the label paired with that icon in §4
```

- **Both or neither.** A producer emits the two keys together. A consumer that finds one without the
  other treats the pair as absent.
- **Optional.** An older producer omits both. Absent means "not known", and a consumer renders the
  fallback of §5 — it never rejects the snapshot.
- **A closed set of pairs.** `roleIcon` is always one of the twelve icons in §4 and `roleLabel` is
  always its paired label. Some icons are two code points (a base character plus U+FE0F, the emoji
  variation selector). A consumer must keep the whole string; dropping U+FE0F changes how the icon
  renders.
- **Per agent entry.** There is no envelope-level key.

`fixtures/presence-role-icon/role-icon-map.json` is the machine-readable form of §4, with code
points. It is generated from the registry and a unit test fails if it drifts. A consumer may load it
directly rather than retype the table.

## 3. Derivation

The registry decides the effective role in this order, first match wins:

1. **Nested team** — a nested workflow participant is a team. It has no pane and therefore no
   presence entry (contract §4), so this icon never appears on a presence entry. It is listed so the
   mapping is complete for the surfaces that do show teams.
2. **Repository lead** — `repoRole === "lead"`. A lead keeps the lead icon while it coordinates a
   run, so its terminal and every view agree.
3. **The run's declared role**, when the agent is a member of a run.
4. **The library role** from the agent definition.
5. **Fallback** — any other, custom or missing role (§5).

On the wire, steps 3 and 4 are exactly `roleName` (header addendum §3.4): it carries the run's
declared role for a run member and the library role otherwise. So a consumer can check a pair
against fields it already has:

```
effective = "lead" if repoRole == "lead" else roleName
expected  = mapping[effective] if effective is in the mapping else fallback
```

`fixtures/presence-role-icon/check.py` applies exactly this rule.

**The producer computes the pair after every membership is settled.** When a standing agent first
joins a run, the producer moves its `roleName` to the run role (`topology/lib/presence.mjs`, the
first-join overwrite in `collectPresenceAgents`). The icon is computed after that step, so it follows
the run role and never disagrees with `roleName`. A unit test fails if the icon is computed earlier.

## 4. Exact mapping

Generated from `ROLE_ICON_MAP` and `roleVisual` in `topology/lib/identity.mjs`. A unit test renders
this table from the registry and fails if the text below differs.

<!-- role-icon-map:begin -->
| Effective role | `roleIcon` | Code points | `roleLabel` |
|---|---|---|---|
| `lead` | 👑 | U+1F451 | Lead |
| `orchestrator` | 🎼 | U+1F3BC | Orchestrator |
| `reviewer` | 🔍 | U+1F50D | Reviewer |
| `observer` | 👁️ | U+1F441 U+FE0F | Observer |
| `worker` | 🔧 | U+1F527 | Worker |
| `implementer` | 🛠️ | U+1F6E0 U+FE0F | Implementer |
| `designer` | 🎨 | U+1F3A8 | Designer |
| `image-gen` | 🖼️ | U+1F5BC U+FE0F | Image generation |
| `researcher` | 🔬 | U+1F52C | Researcher |
| `judge` | ⚖️ | U+2696 U+FE0F | Judge |
| nested team (no pane; never on a presence entry) | 👥 | U+1F465 | Nested team |
| any other, custom or missing role | 🤖 | U+1F916 | Agent |
<!-- role-icon-map:end -->

## 5. Fallback and nested teams

- **Fallback.** An agent whose effective role is not in the table — a custom role such as
  `data-wrangler`, an enrolled session with no library definition, or a hostile role string — gets
  the fallback icon and the label `Agent`. The role string itself is **never** copied into
  `roleIcon` or `roleLabel`.
- **Unknown icon from a producer.** A consumer that receives a `roleIcon` it does not find in the
  table, or a pair that does not match the table, renders the fallback. It never renders the
  received string.
- **Nested team.** Never on a presence entry (§3, step 1). A consumer that receives it anyway renders
  it with its paired label; it is not an error.

## 6. Accessibility

- **The icon is never the only way to learn the role.** Wherever `roleIcon` is shown, `roleLabel` is
  available as text: visible beside the icon, or as the element's accessible name (for example
  `aria-label`, or visually hidden text), with the icon itself hidden from assistive technology
  (`aria-hidden`).
- A tooltip alone (`title`) is not enough, because it is not reliably announced and does not appear
  on touch devices.
- The marketplace's own terminal surfaces follow the same rule: `formatCensus` prints the icon beside
  the agent name with the label as readable text, and keeps its separate **state** glyph in the first
  column.

## 7. Not authority

- **"Team lead" is still rendered from `repoRole === "lead"` and from nothing else** (contract §3,
  header addendum §9.5). `roleIcon` and `roleLabel` do not change that rule and are not a second
  source for it.
- Never group, route, address, admit, filter or authorise on `roleIcon` or `roleLabel`. Repository
  standing is `repoRole`; run standing is `runRole`.
- The marketplace enforces this on its own side: broadcast addressing (`topology/lib/addressing.mjs`)
  reads `repoRole` and `runRole` only. `tests/unit/topology-addressing.test.mjs` gives a worker's
  presence row the lead icon and label and asserts that `@role:lead` does not reach it, and that an
  icon is refused as an address.
- **Never derive a role or an icon from a terminal title.** The marketplace is adding the icon to
  managed terminal titles as display text. A title is not a contract field; take the pair from
  presence.

## 8. Sanitisation

- **Producer.** Emits only registry values. A role string never reaches either key, so neither key
  can carry control characters or terminal escape sequences, whatever an agent definition or run
  spec contains. A unit test gives both a library role and a declared run role an OSC title-setting
  escape sequence and asserts the fallback, with no control character in either key.
- **Census.** The census never copies a pair from the presence roster or from its own previous
  document. It recomputes `roleIcon` and `roleLabel` for every row, carried-forward tombstones
  included, from that row's `repoRole`, `runRole` and `roleName`, with the same precedence as the
  producer. `formatCensus` prints that recomputed pair. So a hand-edited or stale census document
  cannot put escape bytes on a terminal through these keys, and no code reads an icon back.
- **Consumer.** Check the received pair against §4 before rendering (§5). The gateway's parser
  accepts a snapshot whose `roleIcon` contains escape bytes (§10.3), so parsing is not validation.
- **Out of scope here, stated so it is not assumed.** `roleName` (header addendum §3.4) is not
  sanitised by this change. The producer copies the declared run role or the library role verbatim,
  so a hostile definition can put control characters into `roleName`. Do not render `roleName` into
  a terminal title or other escape-interpreting surface without escaping it.

## 9. §5 justification

Contract §5 excludes tokens, credentials, raw environment, provider auth, prompt or template content,
mailbox bodies or subjects, task bodies, diffs and captured terminal text.

`roleIcon` and `roleLabel` are values from a fixed, producer-side table of twelve pairs, selected by a
role token. They carry no prose, no user-authored text and no terminal capture. The role string that
selects them is not copied into them (§5, §8). They are therefore on the permitted side of §5 by the
same argument that admits `roleName`, and more narrowly, because their value set is closed.

## 10. Why emission is on: the three parsers accept the keys

Checked at marketplace commit `6bf4faa` plus this change, and gateway `develop` at `bd576d09`.

### 10.1 The frozen v1 validator — accepts

`fixtures/presence-v1/validate_presence.py` has no key whitelist. `check_one` (`:58`) checks named
fields and rejects ten named keys (`EXCLUDED`, `:27-28`, checked at `:88-89`). `roleIcon` and
`roleLabel` are not among them.

Evidence: it accepts `fixtures/presence-role-icon/h01-v1-role-icons.json` (exit 0), which is
`presence-v1-header/h01-header-full.json` plus the two keys on all five agents.

### 10.2 The v2 validator — accepts

`fixtures/presence-v2/validate_presence_v2.py` overrides only the two role vocabularies (`:43-44`)
and delegates every other rule to the frozen `check_one` (`:68`).

Evidence: it accepts `h01-v1-role-icons.json` and `h02-v2-fallbacks.json` (exit 0).

### 10.3 The gateway's Go parser — accepts, and drops the values

`plugins/orchestration-terminals/presence/presence.go`:

- `Parse` (`:440`) decodes into `map[string]any` (`:442-444`) and never calls
  `DisallowUnknownFields`;
- `parsePresenceAgent` (`:364`) reads named keys only, and its one key-presence check is the ten-name
  exclusion list (`presenceExcludedKey`, `:52`, checked at `:395`);
- the `Agent` struct (`:128`) has no `RoleName`, `RoleIcon` or `RoleLabel` field, so the values are
  accepted and then discarded. Rendering them needs a gateway change.

Evidence: the package's `presence.go` and `grouping.go` were extracted read-only from `develop` into
a scratch module and `presence.Parse` was run over the fixtures. The four `reader*.go` files were
left out because they use `os.Root`, which the local Go 1.22 toolchain lacks; `Parse` does not use
them. Results:

```
ACCEPT h01-v1-role-icons.json: schema=1 agents=5 wireRoleIcon=5
ACCEPT h02-v2-fallbacks.json: schema=2 agents=5 wireRoleIcon=5
REJECT n01-icon-as-repo-role.json: presence snapshot invalid: s2v7ho3j: repoRole 👑
ACCEPT n02-lead-icon-on-worker.json: schema=1 agents=5 wireRoleIcon=5
ACCEPT n03-escape-in-icon.json: schema=1 agents=5 wireRoleIcon=5
ACCEPT n04-icon-without-label.json: schema=1 agents=5 wireRoleIcon=5
```

`wireRoleIcon` counts entries carrying the key, so `ACCEPT` cannot mean the keys were absent. The
controls behave as expected: the existing `presence-v1-header/h01-header-full.json` is accepted and
`n01-repo-role-designer.json` is rejected on `repoRole`.

The last three lines matter for the consumer: the parser accepts a wrong icon, an escape sequence and
a missing label. That is correct for a parser that ignores unknown keys, and it is why §5 and §8 put
the check at render time.

## 11. Census

The census document (`<stateRoot>/census/<repoKey>.json`, `topology/lib/census.mjs`) is not a
cross-repository contract, but it carries the same pair so the CLI and presence agree:

- each row, and each carried-forward tombstone, copies `roleIcon` and `roleLabel` from the presence
  roster (checked as in §8);
- `CENSUS_SCHEMA_VERSION` stays `1`; the keys are additive;
- the first-column state glyph is unchanged. It is a **state** glyph, not a role icon.

## 12. Producer obligations

Additions to contract §9 and header addendum §8.

1. Emit `roleIcon` and `roleLabel` together, and only as a pair from §4.
2. Compute them with the precedence in §3, after every membership and first-join overwrite.
3. Never copy a role string, a title, a display name or any other text into either key.
4. Never read either key back to decide a role, route, grouping, admission or authority.

## 13. Consumer obligations

Additions to contract §10 and header addendum §9.

1. Treat both keys as optional. Absent, half-present or not in §4: render the fallback. Never reject
   a snapshot because of them.
2. Render the icon only after checking the pair against §4. Never render a received string that is
   not in the table.
3. Show `roleLabel` as text or as the accessible name wherever the icon is shown (§6).
4. Keep "Team lead" and every grouping and authority decision on `repoRole` and `runRole` (§7).
5. Never derive a role or an icon from a terminal or pane title.
6. Keep the whole icon string, including U+FE0F.

## 14. Acceptance

From `agent-orchestration/`:

```bash
python3 topology/fixtures/presence-role-icon/check.py                   # both directions
python3 topology/fixtures/presence-role-icon/check.py --snapshot <file> # rules over real output
sha256sum -c <(grep -v '^#' topology/fixtures/presence-role-icon/ROLE-ICON-HASHES.txt)
node --test --test-concurrency=1 tests/unit/topology-presence-role-icon.test.mjs
```

`check.py` requires:

- each `h*.json` to pass the schema validator for its declared version, unmodified, and the rules;
- `n01` to be rejected by the frozen validator on `repoRole` — an icon where authority lives;
- `n02`–`n04` to be **accepted** by the frozen validator and **rejected** by the rules, each for its
  declared reason. The first half shows the rules are necessary; the second shows they work.

`ROLE-ICON-HASHES.txt` records the frozen contract, the frozen v1 fixtures, the signed header
addendum and its fixtures, the v2 addendum and its fixtures, and every new artifact. The unit test
recomputes all of them.

## 15. Countersignature

The request to the gateway's repository lead, with the specific confirmations asked for and the
browser acceptance steps, is `topology/ROLE-ICON-COUNTERSIGNATURE-REQUEST.md`.

— Marketplace Claude, TM-168, 2026-09-11
