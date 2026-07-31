# knowledge-management

Claude Code (and Codex/Grok) agents re-derive project knowledge every session.
This plugin gives them a **git-tracked OKF v0.2 knowledge bundle** at
`.bytedesk/knowledge/` — the durable half of “what we know,” complementary to
[`task-management`](../task-management/) (“what we’re doing”).

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install knowledge-management@bytedesk
```

Then: `km init` (or let the first skill / SessionStart nudge you).

### The `km` command

Zero-install after `/plugin install`: YAML is **vendored** under `lib/vendor/yaml`
(no `npm ci` / `node_modules` required for CLI, hooks, or MCP).

```bash
./install.sh              # link km into ~/.local/bin (PATH only; no npm)
km where
km init
km concept new "Auth model" --type Architecture --dir architecture
km find auth
km show architecture/auth-model
km validate
km lint
km verify architecture/auth-model
km viz --out .bytedesk/knowledge/viz.html
```

Hooks call `bin/km` by absolute path; the symlink is for humans.

## What it does

**Persists knowledge as OKF.** One markdown file per concept, YAML frontmatter + body:

```
<project>/.bytedesk/knowledge/     # OKF bundle root
  index.md                         # okf_version: "0.2"
  log.md
  architecture/…  apis/…  runbooks/…  decisions/…
  references/
  .km/                             # runtime (not concepts)
    index.json   events.jsonl   config.json   state.json
```

**Captures via hooks** (fail-open): SessionStart / PreCompact inject progressive
disclosure (index-level summary, not full wiki dump); AskUserQuestion can mint
Decision concepts when capture is enabled.

**MCP tools:** `km_search`, `km_show`, `km_validate`, `km_lint`, `km_graph`,
`km_backlinks`, `km_verify`, `km_write_concept`, `km_list`.

**Soft task-management links:**

```bash
km link task TM-014 architecture/auth-model
```

Concepts may carry `tasks: ["TM-014"]`; tasks may gain `knowledge: ["/…"]` when
a TM store is present.

## Relationship to OKF

On-disk format is **Open Knowledge Format v0.2** (Google Cloud open spec).
See vendored [reference/SPEC.md](reference/SPEC.md). This plugin is a **runtime**
(CLI, hooks, MCP, doctor) — not merely a skill that tells the model to write markdown.

| | knowledge-management | task-management |
|--|----------------------|-----------------|
| Owns | What is true | What to do |
| Store | `.bytedesk/knowledge/` | `.bytedesk/task-management/` |
| Unit | Concept (OKF) | Task / epic / ADR |
| Trust | verified / stale_after | acceptance + evidence |

## Tests

```bash
bash knowledge-management/run-tests.sh
```

## Version

`0.1.0` — initial release.
