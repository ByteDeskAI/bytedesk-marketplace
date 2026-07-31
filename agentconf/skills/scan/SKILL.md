---
name: scan
description: Find every AI coding agent installed on this machine and report which are managed, which are installed but unproven, and which are unrecognised. Use when the user asks what agents are on their system, whether a newly installed tool is covered, or why a tool is not picking up their shared rules.
user-invokable: true
allowed-tools:
  - Bash
---

```
agentconf scan
```

Three groups come back, and the distinction between them is the whole point:

- **managed** — a canary proved the tool reads the shared file. This is the only group where
  "configured" means anything.
- **unmanaged** — installed, with at most a *candidate* path. A candidate is a hypothesis:
  `documented` (the vendor's docs say so), `reported` (another tool writes there, unconfirmed),
  or `unverified` (a guess from the directory layout). **None of them are wired.**
- **unrecognised** — a config directory the catalogue has never heard of. Worth a look.

## Do not offer to wire an unmanaged tool

The obvious next step is "shall I point these at your shared file?" — and it is the one thing
this plugin refuses to do. `rulesync` writes `~/.config/goose/.goosehints` on exactly that
reasoning, and `strings $(command -v goose)` shows no reference to that filename. The file
gets written, goose ignores it, the user believes their rules are live, and nothing anywhere
says otherwise.

The correct offer is [[audit]]: it researches the tool, runs a canary, and returns an adapter
**or no adapter**. Say plainly that it may come back with nothing, and that nothing is the
right answer when the evidence is not there.

## Keeping up to date

`scan` records what it saw. `agentconf check` — which the SessionStart hook already runs —
compares against that record and announces a tool that appeared since, once. So a newly
installed agent surfaces by itself rather than waiting for someone to think to look.

Two limits worth stating when relevant:

- The catalogue only grows when the plugin updates. A tool released last week is `unrecognised`
  until an adapter or catalogue entry ships — which, with commit-SHA versioning, arrives on the
  next session automatically.
- `scan` sees what is on **PATH and in `$HOME`**. A tool installed only inside a container, a
  different user account, or a GUI app bundle will not appear.
