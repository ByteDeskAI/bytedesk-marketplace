# Countersignature request — Presence session names (ADR-0030)

**To:** the repository lead of `bytedesk-remote-gateway` (orchestration-terminals plugin and the web
sessions view).
**From:** Marketplace Claude, `bytedesk-marketplace` / `agent-orchestration`, **TM-274**, decision
**ADR-0030**.
**Date:** 2026-10-02.
**Asking for:** a countersignature on `topology/PRESENCE-SESSION-NAMES-ADDENDUM.md`, which replaces
the name-shape table in contract §4.3–§4.4. **No code change is requested**, unless one of the checks
in §4 finds that your side parses session names.

---

## 1. Summary

Since agent-orchestration 0.13.0, every tmux session ao creates is named
`[team--]node--repo--role--persona`, for example `agents1--bytedesk-marketplace--lead--priya`. A
team run uses the workflow as its role segment:
`core--agents1--bytedesk-marketplace--parallel-review--ada`.

The presence snapshot is otherwise **unchanged**: `schemaVersion` stays `2`, no key is added or
retyped, and the `session.kind` vocabulary and meaning are the same. Only the values in
`session.sessionName` change. Legacy `ao-<agentId>` and `<agentId>-<7 hex>` sessions keep their names
until they end, so a snapshot can mix both.

If your consumer already follows contract §4.4 — take kind from `session.kind`, never parse the
name — it needs no change.

## 2. Name shapes

Full text: addendum §3. In short:

| `session.kind` | New shape | Legacy shape, until it ends |
|---|---|---|
| `role-session` | `[team--]node--repo--<role>--<persona>` | `ao-<agentId>` |
| `run`, team run | `[team--]node--repo--<workflow>--<persona>`, shared by every pane | workflow-derived |
| `run`, one library agent | `[team--]node--repo--<role>--<persona>` | — |
| `spawn` | never a new-style name | `<agentId>-<7 hex>` |
| `external` | anything | anything |

- Segments match `[a-z0-9]+(-[a-z0-9]+)*`, so `--` only separates them: four segments without a
  team, five with one.
- Names are at most **160** characters from ao. You accept 256.
- A run of one library agent under a new-style name is published as `kind: "run"`, `spawn: null`,
  because the frozen validator ties `kind: "spawn"` to the legacy name. Its `@ao-kind` option says
  `spawn`; `session.kind` wins (addendum §3.3, §4).

## 3. Identity options

ao records each session's identity as tmux user options: `@ao-id` (a ULID), `@ao-agent`, `@ao-role`,
`@ao-repo`, `@ao-repo-origin`, `@ao-node`, `@ao-team`, `@ao-run`, `@ao-workflow`, `@ao-kind`
(addendum §4). They are **labels, not proof**: any same-user process can write them. Presence still
matches agents by the six-tuple binding.

**Your restore path matters here.** When the gateway recreates a dead tab, the new session has no
`@ao-*` options, even if it reuses an ao-shaped name. Such a session is not an ao session and must
not be read as one (addendum §5).

## 4. What we ask you to check and confirm

Please answer yes or no to each, with the file and line you checked.

1. **No name parsing.** Nothing in the orchestration-terminals plugin or the web sessions view
   derives kind, role, lead, agent, grouping or authority from `session.sessionName`. In particular,
   nothing matches `ao-`, `-<7 hex>` or splits on `--` to decide anything. (Display-only splitting
   is allowed; addendum §7.)
2. **Kind from `session.kind`.** Your parser reads `session.kind` and accepts all four values,
   including `kind: "run"` for a session whose name looks like one agent's.
3. **Mixed generations.** A snapshot with a legacy `ao-<id>` lead beside new-style sessions parses,
   and the lead is shown as the lead (`h02-v2-legacy-lead.json`).
4. **Shared session names.** Two entries with the same `sessionName` and `sessionId` but different
   panes (a team run) are shown as two agents, not merged (`h01-v2-new-names.json`).
5. **Length.** Names up to 160 characters display without losing the role or persona segment, in the
   tab strip and wherever else a session name appears.
6. **Misleading names.** For `n02-lead-name-on-external.json`, the external session named
   `…--lead--priya` is **not** shown as a lead. For `n03-workflow-named-reviewer.json`, the two panes
   of a `reviewer` workflow are shown as workers, not reviewers.
7. **Restored tabs.** A tab the gateway restores is not presented as an ao agent on the strength of
   its name, and nothing on your side reads `@ao-*` options from it as identity.
8. **`@ao-*` options, if you read them.** If you choose to read `@ao-kind` or `@ao-workflow` for a
   label, you treat them as display text, tolerate their absence, and show `session.kind` where the
   two disagree.

## 5. How to verify our side

From `bytedesk-marketplace/agent-orchestration/`, python3 only:

```bash
python3 topology/fixtures/presence-session-names/check.py
sha256sum -c <(grep -v '^#' topology/fixtures/presence-session-names/SESSION-NAMES-HASHES.txt)
```

To check your parser: run `presence.Parse` (`plugins/orchestration-terminals/presence/presence.go`)
over each `topology/fixtures/presence-session-names/*.json`. Expected: `h01`, `h02`, `n02` and `n03`
are accepted, and `n01` is rejected (a `spawn` entry with a new-style name). Then render `n02` and
`n03` in the sessions view for checks 6 and 4.

## 6. Recording the countersignature

In the file your side uses for presence acknowledgements, please record:

1. the sha256 of `PRESENCE-SESSION-NAMES-ADDENDUM.md` and each fixture, as listed in
   `SESSION-NAMES-HASHES.txt`;
2. yes or no for each check in §4, with the file and line, and any condition;
3. the gateway commit you checked against, and the gateway commit of any fix that check 1, 6 or 7
   required.

The producer has emitted the new names since 0.13.0. Nothing on our side waits for your answer
except closing the contract record for TM-274.

— Marketplace Claude, TM-274 / ADR-0030, 2026-10-02
