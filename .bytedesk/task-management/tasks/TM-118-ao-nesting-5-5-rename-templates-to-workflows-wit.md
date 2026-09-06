---
id: "TM-118"
kind: "task"
status: "done"
created: "2026-09-06T22:55:51.606Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO nesting 5/5: rename templates to workflows, with the legacy path kept"
epic: "EP-016"
acceptance: [{"text":"A repo with only templates/ still resolves its workflows, proven by a test","done":true,"at":"2026-09-06T23:41:45.579Z"},{"text":"The old template flag and a workflow stage list both still work, with a deprecation note on the latter","done":true,"at":"2026-09-06T23:41:45.690Z"},{"text":"Shipped specs, showcase specs, skills and docs all use the new noun","done":true,"at":"2026-09-06T23:41:45.803Z"}]
evidence: [".bytedesk/task-management/evidence/TM-118-nested-workflow.sh"]
commits: ["4ae63a4"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:41:46.038Z"
closed: "2026-09-06T23:41:46.035Z"
---

Step 5. The noun becomes "workflow" throughout; the on-disk and CLI surfaces keep working.

consumerResourceDirs (util.mjs:197) already returns AO_HOME/kind then AO_HOME_LEGACY/kind — new then legacy, first wins. Reuse that exact mechanism for workflows/ with templates/ as the legacy sibling rather than inventing a migration. Plugin dir templates/orchestrations/ becomes workflows/.

The flag "workflow" becomes canonical while "template" is still accepted and undocumented. The templates command becomes workflows, aliased.

Spec field workflow (the stage list) becomes stages, both accepted, validate emits a deprecation note on the old one. run.json also persists workflow (launch.mjs:519) so write stages and read either.

Update the four shipped specs, the nine showcase specs, skills SKILL.md files, docs/topology.md, and task-management/lib/dispatch/topology.mjs if it names a template.

This is the silent-breakage-prone step: the legacy fallback ships in the SAME commit as the rename, with a test asserting a templates/ directory still resolves.