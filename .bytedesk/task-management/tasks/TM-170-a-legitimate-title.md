---
id: "TM-170"
kind: "task"
status: "done"
created: "2026-09-10T22:11:37.543Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm task new bakes any unrecognised flag into the title"
epic: "EP-018"
acceptance: [{"text":"tm task new refuses an unrecognised flag with 'unknown option <flag>' and its usage line, instead of joining it into the title.","done":true,"at":"2026-09-10T22:16:14.074Z"},{"text":"A legitimate create with --body and --ac still works, and the guard runs after those are spliced out so they are never mistaken for stray flags.","done":true,"at":"2026-09-10T22:16:14.252Z"},{"text":"The three verbs that build a title from positional remainder share one guard shape, and a test covers task new specifically, since it is the one that had none.","done":true,"at":"2026-09-10T22:16:14.415Z"}]
evidence: [".bytedesk/task-management/evidence/TM-170-GUARD.md"]
commits: ["7b91cc0"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "tm/TM-170-task-new-stray-flag"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-170-stray"
updated: "2026-09-10T22:37:38.475Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-170-GUARD.md":{"source":"/tmp/claude-1000/TM-170-GUARD.md","sha256":"cf357c082c6e69c2fb13666e32f560373927109ef92a449f05a811ffd5d625f8","bytes":2346,"at":"2026-09-10T22:16:14.618Z"}}
closed: "2026-09-10T22:16:14.825Z"
---

Found by the tool doing it to me while I was filing TM-169.

`tm task new` splices out --template, --body and --ac, then takes the title as `rest.join(" ")`. Any other flag stays in rest and becomes part of the title. Observed: `--epic EP-018` — a flag this verb has never accepted, since the epic comes from the active epic — became the last four words of TM-169's title, and the create reported success.

This is the THIRD instance of one shape in one file. `tm epic new` grew this guard at line 266 after EP-017 was created with --body baked into its name; `tm edit` grew it at line 1068 after --title was written literally into a title. `task new` — the verb used most — never got it. A guard present in one verb and absent in its siblings is worse than no guard, because the inconsistent half looks like it worked.

Fix is the same two lines the siblings use, so all three now share one shape.

Note on this record: TM-170 was created by accident while testing the fix. I set TM_HOME to a temp dir expecting isolation; the store does not read TM_HOME, it walks up from cwd, and my worktree is inside the repo — so the 'isolated' create landed on the real board as 'a legitimate title'. Rule 2: the isolation removed nothing, and I did not check what it removed before trusting it. Repurposed rather than left as litter.