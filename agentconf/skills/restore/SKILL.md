---
name: restore
description: Undo an agentconf change by putting back a backup it took before writing. Use when a wire went wrong, when a tool started behaving differently after a config change, or when the user wants their previous instruction file back.
user-invokable: true
allowed-tools:
  - Bash
  - Read
---

```
agentconf restore
```

Lists every backup of a managed file, newest first. Then:

```
agentconf restore <timestamp>
```

## Before restoring

Show the user what will change. `Read` the backup and the current file and describe the
difference — a timestamp is not informed consent, and the whole point of an undo is that the
user knows what they are getting back.

Restoring **backs up the current state first**, so an undo is itself undoable. Say so; it
makes the operation easy to agree to.

## Two things to watch

- The list may include backups **agentconf did not write** — other tools leave `.bak` files
  beside the same paths. Restoring one is allowed, but say whose it is if the name is not an
  agentconf timestamp (`YYYYMMDD-HHMMSS`).
- Restoring an instructions file usually **breaks the wiring**, because it replaces a symlink
  with a regular file. That is expected. Run `agentconf check` afterwards and tell the user
  whether they now want [[wire]] again or meant to stay unwired.
