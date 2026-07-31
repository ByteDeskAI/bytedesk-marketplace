---
id: "ADR-0002"
kind: "adr"
status: "proposed"
created: "2026-07-31T05:35:52.099Z"
board: "bytedeskai/bytedesk-marketplace"
title: "A board is a repo; the person is recorded beside it, not as it"
epic: "EP-004"
deciders: []
date: "2026-07-31"
updated: "2026-07-31T05:36:06.845Z"
---

## Context
The request behind TM-041 was that board identity should come from "the git user for the current
directory", and be read-only when git supplies it. TM-041 shipped the read-only part, but kept the
identity as the *repo* — `owner/name` from the origin remote — rather than the person.

That deserved a decision rather than a commit-message aside, because the two readings are not
interchangeable:

- `git config user.name` / `user.email` identify **who is committing**. On this machine that is one
  person across every repo.
- The origin remote identifies **which project**. That is what TM-036 needs: the guard exists
  because `bytedesk-persona` collected 25 `bytedesk-marketplace` pull-request URLs, and the two
  repos share a git user. Keying identity on the person would make those two boards the same board
  and re-open the exact leak, with tests to prove it.

## Decision
**The board is the repo.** `boardId` stays `owner/name` from the origin remote, and the cross-board
guard keeps reading it.

**The person is recorded beside it, not as it.** `owner` is a separate field derived from
`git config user.name` and `user.email` for the store's directory, read-only for the same reason
`boardId` is: it is derived, so writing it would change a file and change nothing else.

Both answer "who owns this board" without either one weakening the other.

## Consequences
- The guard is unchanged, so TM-036 and its tests stand.
- A store now says who set it up, which nothing recorded before. That is useful in a shared repo and
  costs one line of config.
- `owner` is *not* an access control. It records a fact, and anyone with the repo can write the
  board — the same as before.
- Two people on one repo will each see their own git user; the recorded owner is whoever ran
  `tm init`. Drift there is not interesting enough to report, unlike a changed `boardId`, which
  re-labels every entity.
