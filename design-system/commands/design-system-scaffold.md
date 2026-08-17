---
description: Create a NEW site already wrapped in the ByteDesk design system
argument-hint: "<target-dir> <app-slug> [--accent <product>] [--name \"Display Name\"]"
---

# Design System Scaffold

Create a new site that is wrapped in the family design system from its first
commit. For an existing repository that only needs tokens and its profile, use
`/design-system-sync` instead — scaffolding is for greenfield sites.

Follow the `design-system-scaffold` skill for the full procedure: settle the
slug, the product accent, and the display name before running anything, then
verify the generated site builds.

The generator lives in a checkout of `ByteDeskAI/design-system` (it carries the
starter templates, which are too large to embed in this plugin):

```bash
node scaffold/create.mjs <target-dir> <app-slug> --accent <product> --name "Display Name"
```

Parse `$ARGUMENTS` into that call. If no design-system checkout is available,
say so plainly rather than improvising a scaffold by hand.

Then, in the new site, vendor the delivery payload instead of adding a
submodule:

```bash
node scaffold/create.mjs <target-dir> <app-slug> --accent <product> --no-submodule
cd <target-dir>
node ${CLAUDE_PLUGIN_ROOT}/scripts/design-system-sync.mjs --app <app-slug>
npm install && npm run build
```

`--no-submodule` matters: this plugin's delivery contract is vendored committed
files, not a submodule pin. The scaffolded `globals.css` imports tokens from
`.context/design-system/tokens/…`, which is exactly what the sync writes.
