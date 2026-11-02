# TM-382 landing

- PR #186 (tm/TM-382-foreign-blockers) merged into fix/ao-local-nats-autostart at 7c7e6130b64ec45d962458c82998665591cf5cd8, at the reviewed head 2e7fdd7c.
- Independent review: 3 rounds (CHANGES_REQUESTED, CHANGES_REQUESTED, APPROVE). Record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/186#issuecomment-5993493920
- Checks at 2e7fdd7c: task-management unit suite 1602/1602 pass, exit 0; CI check SUCCESS. test-mcp.sh 76/1 is pre-existing on base 7be05521 (TM-390).
- Delivers: foreignBlockers[] (never blockedBy); unresolved foreign blockers are unmet in dependenciesMet, unblockDependents, nextTasks, doctor and why; `tm upstream-resolved <ref> --landed <sha>`; `tm task new --filed-by` with the decision:intake veto; refs stored as written and matched with foreignKey; `tm dep` refuses stray flags.
