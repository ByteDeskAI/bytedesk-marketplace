# TM-166 closeout — evidence refs, verified on main after merge

Merged as e0e398d (branch tm/TM-166-evidence-refs, eb76594). Verified ON MAIN after the
merge rather than on the branch before it, because a branch that passed is not the same
claim as a store that works.

## Verified (ran it)

    task-management/tests/unit/evidence.test.mjs     30 pass, 0 fail
    task-management/tests/test-store.sh             146 pass, 0 fail

The four TM-166 tests live in tests/unit/evidence.test.mjs (+52 lines), not in
test-store.sh — worth stating because my first check grepped test-store.sh for "TM-166",
found nothing, and that absence would have read as "the tests did not land" if I had
stopped there. The count moving 140 -> 146 was the store suite; the new cases are the
unit suite's. Two different numbers I had been treating as one.

## What changed, by acceptance criterion

1. Cross-id naming. `evidenceDest` now parses the LEADING id-run of the filename
   (`/^TM-(\d+(?:-\d+)*)[-_.]/`) and skips the prefix when this task's number appears in
   that run. `TM-130-131-INTEGRATION.md` attaches to TM-131 as itself, and to TM-130 as
   itself — one file, referenced twice. `TM-1` still cannot claim `TM-14-NOTES.md`,
   because membership is tested against the parsed run, not a string prefix.
2. A source already inside the evidence directory is returned as-is and not re-copied;
   the guard is a resolved-path prefix test with a separator, so a sibling directory
   whose name merely starts the same way does not match.
3. `tm evidence <id> --detach <ref>` is now reachable. `detachEvidence` had always
   existed in lib/evidence.mjs and no verb called it — a capability described in a
   comment is not a capability that is reachable, which is rule 4 of
   verification-that-can-fail.md, found again in a second file.
4. The regression case uses a real shared-artifact name, because that is the shape this
   store actually grows: both surviving doubles in the recent cleanup were cross-id.

## What I only read

The CHANGELOG entry. I did not re-verify its wording against the shipped behaviour.
