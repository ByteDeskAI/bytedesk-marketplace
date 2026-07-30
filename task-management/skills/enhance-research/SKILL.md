---
name: enhance-research
description: Research for the capability loop — internal code seams plus external analogues and competitors — written to a dated pack under .bytedesk/task-management/research/. Use for the /enhance research step or a standalone "research similar products" / "what do comparable tools do" request.
user-invokable: false
---

# Enhance — research

Two halves. The internal half always runs; the external half runs when this host has web tools.

## Steps

1. Read `.bytedesk/task-management/product-state.md`. If it is missing or stale, run
   [[enhance-capture]] first — researching against a wrong picture wastes the whole pass.
2. **Internal** (always). Hunt for seams where the product already almost does something:
   - friction markers: TODO/FIXME, skipped or quarantined tests, `console.log`/`JSON.stringify`
     left in a UI, error paths that swallow
   - durability gaps: state that does not survive a restart, a reconnect, a second window
   - operator paths: the manual step someone repeats, the check that only exists in someone's head
   - each finding gets a path. A finding without a path is a memory, not research.
3. **External** (when web tools exist). 3–8 comparable products or analogues. For each:
   what it does, the URL, and the specific gap it implies against `product-state.md`.
   Analogues from adjacent categories beat direct competitors — they show the move nobody
   in this category has copied yet.
4. Write `.bytedesk/task-management/research/<YYYY-MM-DD>-<slug>.md`: internal findings,
   external analogues, and a closing list of candidate problems worth proposing.

## Offline

Still write the pack, named `<date>-<slug>-internal-only.md`, and end it with the external
questions a later pass should answer. Say plainly in your reply that the external half did
not run — a pack that looks complete but is half-blind is worse than one that admits it.
