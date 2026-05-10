---
name: fleet
description: Chat-friendly snapshot of the multi-session Claude command center. Shows every running agent grouped by state (working / needs-input / error / done / idle), with branch, last activity, and a one-line peek at what each is currently doing. Use when the user asks "what's my fleet doing", "fleet status", "what are my agents working on", "/fleet", or any phrasing about checking the parallel-session dashboard.
user-invokable: true
argument-hint: "[--peek N]    # peek N pane lines per session (default 3)"
allowed-tools:
  - Bash
---

## What this skill does

One-shot status report on every active session in the multi-session command center. Reads `claude-sessions` and `claude-sessions peek <ticket>` to build a chat-readable summary grouped by state, with the most-attention-needed sessions first.

## Steps

1. Run `claude-sessions` to get the table of active sessions.
2. If there are zero sessions, say so and exit.
3. Parse the table; for each session, also run `claude-sessions peek <ticket> 3` (or N if `--peek N` was passed) to grab the last few output lines.
4. Group sessions by state in this priority order: `error`, `needs-input`, `done`, `working`, `idle`, `starting`, `gone`.
5. Format and print to chat using the layout in **Output format** below.
6. End with the dashboard URL (`http://127.0.0.1:7681/`) and the next likely commands.

## Output format

```
🚨 Needs attention (1)
  BDP-372 · feature/BDP-372-deploy-history-filter · 8m ago
    > Should I treat the date filter as inclusive or exclusive?

❌ Errored (1)
  BDP-388 · feature/BDP-388-portal-billing · 14m ago
    > error: branch already exists

✅ Done (1)
  BDP-381 · feature/BDP-381-portal-billing-link · 23m ago

⚙️  Working (2)
  BDP-364 · feature/BDP-364-react-arborist-postmerge · 4s ago
    > npm install ... 12 packages added
  BDP-401 · feature/BDP-401-deploy-tab-grid · 1m ago
    > generating deploy-grid-view.tsx

Total: 5 sessions  ·  Browser: http://127.0.0.1:7681/

Next:  /fleet:cleanup   (sweep merged sessions)
       claude-sessions attach BDP-372   (handle the question)
```

If only one or two sessions exist, drop the section headers and just list them inline.

## Constraints

- Read-only — never kills, sends, or mutates anything. Just reports.
- Don't truncate ticket keys, branch names, or peek lines below 80 chars; let chat wrap them.
- If `claude-sessions` itself fails (e.g. the plugin isn't installed and `claude-sessions` isn't on `$PATH`), tell the user the command center isn't installed and link them to the Confluence doc.

## Examples

```
/fleet
/fleet --peek 5
```
