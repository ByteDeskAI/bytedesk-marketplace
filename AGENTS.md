<!-- bytedesk-design-system:start -->
## ByteDesk design context

Read design authority in this order:

1. `.context/design-system/foundation/DESIGN.md`
2. `.context/design-system/apps/task-management/DESIGN.md` and adjacent `PRODUCT.md`
3. This repository's root `DESIGN.md` for local implementation details and explicit exceptions

Managed design-system files are read-only. Canonical changes land in `ByteDeskAI/design-system` first.
<!-- bytedesk-design-system:end -->

## Rule: a plugin hosts its own scripts

**Every script a plugin runs lives inside that plugin, in `<plugin>/scripts/`.** That covers hook
scripts, monitor commands, guards, checks, and the tests for them. A plugin is copied on its own into
the plugin cache, so a path that reaches outside its directory (`../scripts/...`, or the marketplace's
root `scripts/`) is simply absent after install and fails with no error.

- Reference them from the plugin's manifests as `${CLAUDE_PLUGIN_ROOT}/scripts/<name>`, and have one
  script find another relative to itself (`import.meta.url`, `dirname "$0"`), never by an absolute path.
- The root `scripts/` directory is only for work that is **shared** across plugins or about the
  marketplace itself (`validate-marketplace.mjs`, the `sync-*.mjs` importers). If a script serves one
  plugin, it moves into that plugin. If a second plugin needs it, keep it in the owning plugin and
  have the other call the owning plugin's CLI; do not symlink across plugins (a link that leaves the
  plugin is skipped on install).
- Check a move by copying only the plugin's own directories to a temp location and running its tests
  there. A test that passes only in the checkout proves the checkout, not the plugin.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
