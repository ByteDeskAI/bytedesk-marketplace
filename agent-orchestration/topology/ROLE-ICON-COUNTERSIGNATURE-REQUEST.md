# Countersignature request — Presence role icons (`roleIcon`, `roleLabel`)

**To:** the repository lead of `bytedesk-remote-gateway` (orchestration-terminals plugin and the web
sessions view).
**From:** Marketplace Claude, `bytedesk-marketplace` / `agent-orchestration`, **TM-168**.
**Date:** 2026-09-11.
**Asking for:** (1) a countersignature on `topology/PRESENCE-ROLE-ICON-ADDENDUM.md`, and (2) a
gateway change that shows the same role icon, with its accessible label, in the terminal tab or
title bar and in the GUI agent views. Marketplace TM-168 is not complete until browser acceptance
(§8) passes on your side.

---

## 1. Summary

Presence agent entries now carry two additive display keys, `roleIcon` and `roleLabel`, taken from
one fixed table of twelve pairs. `schemaVersion` stays `2`, and no existing key changes. Your current
parser already accepts both keys and discards them. We are asking you to render them, to check them
against the table before rendering, and to keep every authority decision on `repoRole` and `runRole`.

## 2. Field contract

Full text: addendum §2–§8. In short:

- `roleIcon` — string, exactly one icon from the table below. Some icons are two code points (base
  plus U+FE0F); keep the whole string.
- `roleLabel` — string, the label paired with that icon.
- Both or neither, optional, per agent entry. Absent, half-present or not in the table: render the
  fallback. Never reject a snapshot because of these keys.
- Derivation, for checking a pair against fields you already parse:
  `effective = "lead" if repoRole == "lead" else roleName`, then the table, else the fallback.

## 3. Exact mapping

Generated from the marketplace registry; a unit test fails if this table drifts. The same data, with
code points, is `topology/fixtures/presence-role-icon/role-icon-map.json` — load that rather than
retyping.

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

## 4. What the gateway must render

The outcome: **for one agent, the same Unicode character appears in its terminal tab or title bar
and in every GUI agent view, with `roleLabel` as readable or accessible text.**

What we found when reading your `develop` branch at `bd576d09` (read only; nothing was changed or
run inside your repository):

1. **Parse.** `plugins/orchestration-terminals/presence/presence.go` — the `Agent` struct (`:128`)
   has no `RoleName`, `RoleIcon` or `RoleLabel` field, so `parsePresenceAgent` (`:364`) drops them.
   Add the two fields; check the pair against the table there or at render time, and substitute the
   fallback when it does not match.
2. **Project.** `presence/grouping.go:53-67` derives the authority label (`Team lead`,
   `Coordinator`, `Reviewer`, `Worker`) from `repoRole` and `runRole`. Keep that rule exactly as it
   is. Carry the icon and label beside it as separate display values.
3. **Badge.** `provider.go:67-69` builds a badge
   `{Label: projection.RoleLabel, Icon: roleIcon(projection.RoleLabel)}`, where `Icon` currently holds
   an identifier such as `team-lead`, not a character.
4. **Browser contract.** `web/src/features/sessions/terminalPresentation.ts` accepts a badge only
   with the keys `label` and `icon` (`isBadge`, via `hasOnlyKeys`), and an item only with its five
   known keys (`isItem`). A new key on either makes `normalizeTerminalPresentation` return `null`,
   which drops the **whole** presentation for that terminal. Change the SDK shape and this
   normaliser in the same step, or carry the character in an existing field.
5. **Tab strip.** `web/src/organisms/sessions/SessionsTabstrip.tsx:264-272` renders only
   `badge.label`; `badge.icon` is not shown. Render the character with `aria-hidden`, and keep the
   label as visible text or as the element's accessible name. A `title` tooltip alone is not enough.

### 4.1 Name clash

`provider.go:123` already has `func roleIcon(label string) string`, which returns role **names**
(`team-lead`, `coordinator`, `reviewer`, `worker`), not icons. Introducing a `RoleIcon` field beside
it invites the two to be confused. Please rename the existing function (for example
`roleBadgeID`) before adding the field.

## 5. Do not parse icons or roles from pane titles

`src/orchestration_topology.go:114-140` (`parsePaneRole`) reads a role out of a pane title by
splitting on separators such as ` · `, ` - ` and `: `, and lowercasing the left side.

The marketplace is adding the role icon to the titles of the terminals it manages, as display text.
The exact title format belongs to that change and may still move. A title that starts with an icon
will give `parsePaneRole` a role string that is not a role. So:

- never derive a role, a lead, or an icon from a terminal or pane title;
- take `roleIcon` and `roleLabel` from presence;
- if `parsePaneRole` must remain for terminals that have no presence entry, treat its result as a
  guess for display only, and expect it to be wrong for managed terminals.

## 6. Authority and safety

- **"Team lead" stays `repoRole === "lead"` and nothing else** (contract §3, header addendum §9.5,
  unchanged). Never group, route, address or authorise on `roleIcon` or `roleLabel`.
- **Parsing is not validation.** We ran your `presence.Parse` over our fixtures: it accepts a worker
  entry carrying the lead icon (`n02`), an OSC title-setting escape sequence in `roleIcon` (`n03`),
  and an icon with no label (`n04`). That is right for a parser that ignores unknown keys, and it is
  why the check against the table must happen before rendering.
- **`roleName` is not sanitised.** It is copied verbatim from the run spec or agent definition and
  can contain control characters. Do not put `roleName` into a terminal title or other
  escape-interpreting surface without escaping it. `roleIcon` and `roleLabel` never contain one.

## 7. What we ask you to confirm

Please answer yes or no to each.

1. Your parser accepts `roleIcon` and `roleLabel` without rejecting the snapshot, and no key
   whitelist or `DisallowUnknownFields` is planned for agent entries. (We ran `presence.Parse` from
   `develop` `bd576d09`; addendum §10.3 has the output and the one deviation — the `reader*.go` files
   were omitted because they need a newer Go toolchain than ours.)
2. You render only pairs that match the table, and the fallback otherwise.
3. You show `roleLabel` as visible or accessible text wherever the icon appears.
4. You keep "Team lead", grouping and every authority decision on `repoRole` and `runRole`.
5. You do not derive a role or an icon from pane or terminal titles.
6. The existing `roleIcon()` in `provider.go` is renamed, or you state why the clash is harmless.
7. The same character appears in the terminal tab or title bar and in the GUI agent views.

## 8. Browser acceptance

Run in a real browser against a running gateway (agent-browser is the default tool on the
marketplace side). Use one repository whose presence snapshot has, at minimum: a standing lead that
is also coordinating a run, a standing reviewer, a run worker, a member of a nested run, and an
enrolled session with no definition or a custom role.

1. Open the gateway sessions view for that repository and wait for presentation freshness `fresh`.
2. For each of the five terminals, record the character shown in its tab or title bar.
3. Compare each against `ao-topology census` in the marketplace repository and against
   `roleIcon` in the presence snapshot file: the three must be the same character, including U+FE0F.
   Expected: lead 👑 (even while coordinating the run), reviewer 🔍, worker 🔧, the nested member's
   own run role, and the unknown or custom session 🤖.
4. Open each GUI agent view that shows an agent (for example a group or agent list) and confirm the
   same character appears for the same agent.
5. Inspect the accessibility tree: each icon is hidden from assistive technology, and each tab's or
   row's accessible name includes `roleLabel` (for example "Lead", "Agent").
6. Confirm the "Team lead" label and the lead's grouping and priority are unchanged from before.
7. Make the snapshot stale (stop the marketplace supervisor for longer than `staleAfterMs`). The
   stale badge appears as today; no icon is presented as fresher than its snapshot.
8. Negative: point the gateway at a snapshot copied from
   `topology/fixtures/presence-role-icon/n02-lead-icon-on-worker.json` or `n03-escape-in-icon.json`.
   The worker shows the table's value for its role or the fallback — never 👑 for `n02`, never the
   escape text for `n03` — and the page title and terminal title do not change.
9. Record screenshots of steps 2, 4 and 8, and the accessibility names from step 5.

## 9. How to verify our side

From `bytedesk-marketplace/agent-orchestration/`, python3 only:

```bash
python3 topology/fixtures/presence-role-icon/check.py
python3 topology/fixtures/presence-v1-header/check.py
python3 topology/fixtures/presence-v2/check.py
sha256sum -c <(grep -v '^#' topology/fixtures/presence-role-icon/ROLE-ICON-HASHES.txt)
```

To repeat the Go check: copy `presence/presence.go` and `presence/grouping.go` into a scratch module,
call `presence.Parse` on each `topology/fixtures/presence-role-icon/*.json`, and compare with addendum
§10.3.

## 10. Recording the countersignature

In the file your side uses for presence acknowledgements, please record:

1. the sha256 of `PRESENCE-ROLE-ICON-ADDENDUM.md`, `role-icon-map.json` and each fixture, as listed
   in `ROLE-ICON-HASHES.txt`;
2. yes or no for each confirmation in §7, with any condition;
3. the gateway commit that implements §4, and the browser acceptance evidence from §8.

The marketplace producer already emits the keys, because no current consumer breaks on them (addendum
§10). Nothing on our side waits for your answer except closing TM-168.

— Marketplace Claude, TM-168, 2026-09-11
