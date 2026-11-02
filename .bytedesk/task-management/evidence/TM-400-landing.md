# TM-400 / TM-347 / TM-348 / TM-349 landing on main

- PR #221 (sync/TM-400-main-into-fix-2) merged into main at 44b030d48cf931703eebf08253a5ea6e0c212f5c. The reviewed head was 30296798, a round-4 merge of #227 that only touches plugin-rsync.
- It delivers fix/ao-local-nats-autostart to main:
  - #184 TM-388
  - #186 TM-382
  - #194 TM-392
  - #196 TM-384
  - #192 TM-347/348/349
  - #212 (sync round 1)
- Independent review: round 2 APPROVE and round 3 APPROVE. Record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221#issuecomment-6071125431
- CI is green at 30296798.
- The main checkout was fast-forwarded to 44b030d4, keeping 622 uncommitted shared-board files with no overlap. The post-merge plugin-rsync covered agent-orchestration, plugin-rsync and task-management. `ao-topology help` lists `manage rework`.
- TM-347, TM-348 and TM-349 code reviews: PR #192, 3 rounds, https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129
