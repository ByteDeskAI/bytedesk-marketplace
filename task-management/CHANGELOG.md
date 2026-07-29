# Changelog

## Unreleased

### Added

- **`tm export [md|csv|json|pm]`** — the capability the README has promised since v0.2.
  `md` is a report to paste into a PR or a standup; `csv` is RFC 4180 with Jira's column
  names and status vocabulary; `json` is the whole store as one document (`--events` to
  include the log); `pm` emits `pm_issue_create` payloads for the `project-management`
  plugin in this marketplace, plus the follow-up `transitions` that call cannot express,
  since it always creates at `TODO`. Filters: `--epic`, `--status`, `--open`; `--out
  <file>`, defaulting to stdout so it pipes. CSV escaping is verified against a title
  containing both a quote and a comma, a multi-line body, and multi-line criteria.

- **`tm doctor [--fix]`** — store integrity. Markdown-in-git is what makes the board
  readable and mergeable, and also why it drifts; `tm reindex` rebuilds the cache *from*
  the files, so it reproduces whatever is wrong with them. Checks dangling and one-sided
  dependency edges, one-sided and dangling Jira links, unknown link types, orphaned epic
  and parent references, dependency and subtask cycles, tasks left `blocked` with nothing
  blocking them, `done` tasks with unticked criteria, missing evidence files, duplicate
  `nativeId`s, claims on tasks that are gone / parked / finished, `in_progress` work
  nobody claimed, and `index.json` drift. **Exits 1 on any error-level finding**, so it
  gates a commit hook or a CI step. `--fix` applies only the unambiguous repairs, reports
  each one, and repeats until the store stops changing; cycles and unmet criteria are
  decisions, not typos, and are reported rather than touched.

- **A keyboard for the board, and a command palette.** The dashboard was mouse-only —
  cards moved by HTML5 drag and nothing else. `j`/`k`/`h`/`l`/`g`/`G` move a cursor,
  `1`–`5` move the focused card to that column (the number is printed in the column
  heading), `[`/`]` reorder within a column, `x` selects, `w` watches, `o`/`Enter` opens,
  `c` creates, `/` searches, `?` lists everything. `⌘K`/`Ctrl-K` opens a palette over
  every board action and every visible task. Cards became real focusable list items with
  `aria-label`s and a roving tabindex, so `Tab` and `j`/`k` agree. Shortcuts stay quiet
  while you type or while a dialog is open, and no modifier chord except `⌘K` is
  intercepted. Keyboard reordering needed no drag-and-drop library: `[`/`]` call the same
  `rank` endpoint the drop gesture already called.

- **`tm why <id>`** — why a task is not startable, walked to the root of its dependency
  chain rather than one hop deep. Reports the reason at each hop (a parked blocker's
  written reason, a claim another session holds, a hand-written `tm block`, the WIP limit,
  a dependency cycle, a `blockedBy` pointing at nothing) and names the work at the bottom
  as `roots`. `parked` is reported but not counted as blocking, because `tm start` resumes
  a parked task. Also available over MCP as `tm_why`.
- **`tm graph`** — the dependency graph as Mermaid, fenced so GitHub renders it inside a
  PR diff. `--epic` scopes it (blockers from outside the epic are still drawn, since they
  still explain the block), `--all` includes done work, `--raw` drops the fence, `--json`
  gives `{nodes, edges}`.
