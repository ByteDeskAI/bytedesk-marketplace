# Dashboard frontend contract

The contract six parallel feature workers code against. Backend routes and shapes are in
`dashboard-api.md`; this file covers the SPA. Read both before writing a line.

## 1. Stack and layout

React 18 + Vite 5 + TypeScript (strict). Hand-rolled router and store (no react-router, no
TanStack Query). Plain CSS files against ByteDesk `--bd-*` tokens (no `@atlaskit`, no
`@compiled`, no Tailwind, no CSS-in-JS). `lucide-react` is the only new runtime dependency.
Charts are inline SVG. Markdown renders through `markdown.mjs` → React elements (no
`dangerouslySetInnerHTML`). `dist/` is committed; keep the single `vendor` chunk in `vite.config.ts`.

```
dashboard/
  public/fonts/                  IBM Plex Sans 400/500/600, Mono 400/500 (woff2, OFL)     FE-shell
  index.html                     theme-color from tokens; keyframes; reduced-motion         W8
  build-pwa.mjs, sw.js           colours read from the token JSON, never literal hex        W8
  metrics.mjs                    unchanged
  src/
    main.tsx                     mount, token stylesheet import, theme attrs, router        FE-shell
    app/  Shell.tsx Rail.tsx CommandBar.tsx Inspector.tsx Palette.tsx routes.ts Help.tsx    FE-shell
    styles/  tokens.css base.css shell.css ui.css  (+ one <screen>.css per feature)         FE-shell (+ owners)
    components/ui/               the primitives in §5, one file each                        FE-shell
    lib/   router.ts store.ts api.ts types.ts filters.ts keys.mjs lanes.mjs liveness.mjs
           markdown.mjs useBoardKeys.ts                                                     FE-core
    pwa/   queue.mjs outbox.mjs notify.mjs prefs.mjs usePwa.ts (unchanged logic)            FE-ops
    features/
      board/ backlog/ epics/                                                                FE-board
      task/ decisions/ capabilities/ plans/                                                 FE-detail
      graph/ activity/ standup/ reports/ doctor/ sessions/ search/                          FE-ops-screens
      sprints/ settings/ help/                                                              FE-ops
```

Ownership is exclusive: a worker writes only inside its directories plus its own
`styles/<screen>.css`. Shared files (`lib/`, `components/ui/`, `app/`) are FE-core / FE-shell;
request changes there through the lead, do not edit them. No worker runs git.

Preserved verbatim from the current source: `keys.mjs`, `lanes.mjs`, `liveness.mjs`,
`markdown.mjs`, `metrics.mjs`, `pwa/*.mjs`, `sw.js`, the `Filters` keys in `filters.ts` (extended
with `status`, `kind`, `id`, `goal`), the document-capture Escape fix for inline edits
(`TaskDrawer.tsx:204-265` today), `data-tm-card`, `#root`, `#tm-palette-list`.

## 2. Screen map

Canvas = main content. Inspector = the right panel (`--bd-size-shell-inspector`, 360 px) that an
entity route opens over the list route it came from; slide-over sheet 720–1199 px; full screen
< 720 px. Every list route accepts `?q=` in `tm find` syntax (see `vocab.findFields`).

| Route | Purpose | Data | Writes | Empty state | Responsive | Keys |
|---|---|---|---|---|---|---|
| `/` → `/board` | Six-column kanban, optional group-by-epic lanes, filters in URL `?q=` | `/api/board`, `/events` | transition, rank, bulk, create | "No epic is active" + primary **Create epic** | ≥1200 six columns; 720–1199 scroll-snap, 3 visible; <720 one column + status segmented control | `keys.mjs` verbatim: `1–6`, `j/k/h/l`, `x`, `w`, `[`/`]` |
| `/backlog` | Ranked list, sprint commit, rank drag, WIP/points | `/api/backlog`, board | rank, sprint, priority, bulk | "Backlog is empty — every task is scheduled" | table → stacked rows <720 | `[`/`]` rank, `s` commit to sprint |
| `/tasks/:id` | Inspector: identity header, body, Answer (decision cards), AC, blockers + **Why chain**, links, evidence viewer, comments, worktree, **history**, live WorkStream | `/api/task/:id`, `/evidence`, `/why`, `/handoff`, `/time`, `/entity/:id/history`, `/stream` | every task action; stop reason is an inline field | 404 panel "TM-999 is not on this board" | full screen on phone; WorkStream becomes a tab | `Esc` closes to background route; `e` edit title |
| `/epics`, `/epics/:id` | Epic list with progress, plan chip, decision-map sections; inspector: body, children, ADRs, plan | board, `/api/epic/:id`, `/api/plans/file` | create/activate/close/reopen/plan, `PATCH /api/epic/:id` | "No epics yet" | cards grid → list | `a` make active |
| `/graph` | Dependency DAG (layered SVG), epic filter, cycle highlight, click → inspector, copy Mermaid | `/api/graph` | dep remove from edge menu | "No dependencies drawn — add one with `tm dep`" | pan/zoom canvas; <720 list of edges | arrows walk nodes |
| `/activity` | Event timeline, kind/actor/session filters, per-session grouping, collapse noise | `/api/events?after&limit&kind&id` | none | "Quiet board" | list | `n`/`p` |
| `/standup` | Done / doing / stuck since T, copy as markdown | `/api/standup?since` | none | "Nothing moved since …" | prose | `c` copy |
| `/sprints`, `/sprints/:id` | Sprint list + burndown by points, commit/uncommit, close | board, `/api/sprint/:id` | create, activate, add/rm, done, `PATCH` | "No sprint — create one" | chart → KPI tile | |
| `/capabilities`, `/capabilities/:id` | Ranked cards (score 1–27), propose form, accept/ship (evidence picker)/drop (reason field) | board, `/api/capability/:id` | propose, accept, ship `{evidence}`, drop, `PATCH` | "Run /enhance to propose" | grid → list | |
| `/decisions`, `/decisions/:id` | ADRs: create, accept, supersede, edit body + deciders | board, `/api/adr/:id` | create, accept, supersede, `PATCH /api/adr/:id` | "No decisions recorded" | | |
| `/plans` | Plans inbox, preview, link to epic | `/api/plans`, `/api/plans/file` | epic plan set | "Approve a plan in Claude Code and it lands here" | | |
| `/sessions` | Live agents: claims table (session/actor/worktree/branch/age/expiry), WIP vs `wipLimit`, worktrees, **parallel batches**, stale work | board.state, `/api/claims`, `/api/sessions`, `/api/worktrees`, `/api/parallel?epic`, `/api/stale` | release, sweep (confirm), claim, worktree create/rm with `force` toggle | "No session holds a claim" | table → cards | |
| `/doctor` | Findings grouped error/warning, fixable badge, **Fix all unambiguous** (confirm), per-finding fix, reindex | `/api/doctor` | `doctor/fix`, `reindex` | success tile "Store is consistent" | | |
| `/search` | `tm find` syntax with field chips, negation, kind facets; saved views | `/api/find?q=` | save view (`/api/settings`) | "No hits for …" + syntax help | | `/` focuses |
| `/reports` | Cycle time (median/mean/oldest), throughput, time-in-status; **Export** md/csv/json with filters | `/api/time`, `/api/task/:id/time`, `/api/export` (download link) | none | "Not enough history" | KPI tiles stack | |
| `/settings` | Catalog form with dirty state + Save/Reset, browser notifications, ntfy **test send**, override, config view | `/api/settings`, `/api/ntfy`, `/api/override`, `/api/meta.config` | settings, override, ntfy test | | | |
| `/help` | Shortcuts from `keymapByGroup()`, skills catalog with copyable `/task-management:*` commands, CLI cheatsheet | `/api/skills` | none | | | `?` opens |

Unknown route → 404 panel inside the shell. Each screen owns its own skeleton, empty state and
error panel (§8).

## 3. App shell (`src/app/`)

- **Rail** (left, 48 px `--bd-size-shell-rail`, Lucide icons, tooltips on hover/focus; 196 px
  labelled sidebar at ≥1600). <720 px: bottom tab bar Board · Backlog · Sessions · More.
- **Command bar** (36 px): project name; active-epic and active-sprint lozenges (click → inspector);
  `● live` / `○ reconnecting` (dot **and** word); search input (`/` focuses, submits to `/search`);
  notifications popover (today's PwaBar content); actor avatar menu (`board.me`, Settings, theme).
- **Inspector**: renders the entity route over the list route it was opened from (`/board` stays
  underneath `/tasks/TM-014`); `Esc` navigates back; focus moves to its heading on open and returns
  to the opening card on close.
- **Palette** `⌘K`/`Ctrl-K` (`#tm-palette-list` kept): route jumps, focused-card actions first,
  board actions, then every visible entity; ranking via `keys.mjs filterCommands`.
- **Theme**: `<html data-bd-theme="dark"|"light">` from `prefers-color-scheme`, overridable in
  Settings, persisted in board settings (`board.theme`) with localStorage as the cache.
  `<html data-bd-product="task-management">`. Dark is the token default.
- **Live region**: one `aria-live="polite"` node for write results, refusals and SSE narration
  ("TM-014 moved to done by codex").
- **Toasts**: refusals surface as a toast **and** inline at the control that caused them.
- **Reduced motion**: `prefers-reduced-motion` disables the live-write pulse and all transitions.

## 4. `lib/` public API (code against these signatures; FE-core implements them)

```ts
// lib/router.ts
export type RouteMatch = { name: string; params: Record<string, string>; query: URLSearchParams; path: string };
export const ROUTES: Array<{ name: string; pattern: string }>;   // "/tasks/:id" etc, in app/routes.ts
export function matchRoute(path: string): RouteMatch | null;
export function navigate(path: string, opts?: { replace?: boolean }): void;
export function useRoute(): RouteMatch;                          // useSyncExternalStore on popstate
export function useQuery(): [URLSearchParams, (next: URLSearchParams, replace?: boolean) => void];
export function Link(props: { to: string; replace?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
export function backgroundRoute(m: RouteMatch): string;         // "/tasks/TM-1" → "/board" (or ?from=)

// lib/store.ts  — module singleton fed by SSE, reconciled by GET /api/board
export interface Snapshot { board: Board | null; meta: Meta | null; events: StoreEvent[]; live: boolean; stale: boolean; loadedAt: number }
export const store: {
  get(): Snapshot;
  subscribe(cb: () => void): () => void;
  ingest(e: StoreEvent): void;              // SSE "store" frame → dirty id or board refetch (debounced)
  apply(id: string, patch: Partial<Task | Epic | Adr | Sprint | Capability>): () => void; // optimistic; returns rollback
  reconcile(): Promise<void>;               // GET /api/board (+ ETag), GET /api/events
  resync(): Promise<void>;                  // after SSE "resync" or reconnect
};
export function useBoard(): Board | null;
export function useMeta(): Meta;                                // suspends/throws until /api/meta loaded once
export function useEntity<T = Task>(id: string | null): { data: T | null; loading: boolean; error: string | null; refresh(): void };
export function useEvents(filter?: { id?: string; kind?: string; session?: string; since?: string }): StoreEvent[];
export function useLive(): { live: boolean; stale: boolean };
export function useWrite<A extends unknown[]>(fn: (...a: A) => Promise<unknown>, opts?: { optimistic?: (...a: A) => () => void; announce?: string })
  : { run: (...a: A) => Promise<void>; pending: boolean; error: string | null; clear(): void };
export function usePendingByTask(): Record<string, "queued" | "refused">;   // from pwa/outbox

// lib/api.ts — every fetcher + the `write` object (existing methods kept; new ones below)
export const write: {
  /* existing */ create, createEpic, closeEpic, reopenEpic, epicPlan, createAdr, acceptAdr, supersedeAdr,
  proposeCap, acceptCap, shipCap, dropCap, edit, act, settings, bulk, transition, dep, activeEpic,
  createSprint, closeSprint, activeSprint,
  /* new */ claim(id, steal?), release(id), sweep(), override(reason), ntfyTest(event?), goalImport(body),
  doctorFix(), reindex(), deleteTask(id, why?), restoreTask(id), patchEpic(id, p), patchAdr(id, p),
  patchSprint(id, p), patchCap(id, p), writeTemplate(name, p), patchTemplate(name, p), touches(id, add)
};
export function fetchMeta(): Promise<Meta>;
export function fetchWhy(id): Promise<Why>; fetchGraph(q): Promise<Graph>; fetchStandup(since): Promise<{since,text}>;
export function fetchHandoff(id); fetchTime(); fetchTaskTime(id); fetchStale(); fetchHistory(id); fetchFind(q);
export function fetchClaims(); fetchSessions(); fetchParallel(epic?); fetchDoctor(); fetchOverride(); fetchNtfy(); fetchSkills();
export function exportUrl(format, filters): string;              // href for a download link
export class WriteError extends Error { status: number }        // message = server's own text
export function subscribe(onEvent, onLive, onResync): () => void; // EventSource with Last-Event-ID
```

`types.ts` keeps every existing interface and adds `Meta`, `Why`, `Graph`, `Claims`, `Sessions`,
`ParallelBatch`, `DoctorFinding`, `TimeSummary`, `TaskTime`, `FindHit`, `Skill`, `NtfyInfo`,
mirroring `dashboard-api.md`. `Status` gains nothing; `deleted` stays hidden from lists.

Store rules: per-entity event kinds (`update, edit, assign, labels, prioritise, estimate, comment,
link, unlink, dep, undep, subtask, rank, ac_met, ac_unmet, ac_removed, claim, release,
worktree_new, worktree_rm, git_link, sprint`) mark the id dirty → one debounced (150 ms)
`GET /api/entity/:id` merge. Structural kinds (`create, done, deleted, moved, unblocked, reopened,
epic_*, cap-*, doctor_fix, claims_swept, plan_captured, goal_imported, settings`) and unknown
kinds → one debounced `GET /api/board`. Reconcile every 60 s while visible, on `visibilitychange`,
and on SSE reopen. Optimistic `apply` only for known-shape field writes (transition, priority,
assignee, labels, rank, estimate, sprint, AC tick); creates and gated actions (done, claim,
worktree, doctor fix) are not optimistic. Rollback on `WriteError`; the toast shows `error.message`.

## 5. UI primitives (`components/ui/`, props sketches)

| Primitive | Props | Notes |
|---|---|---|
| `Button` | `variant: "primary"\|"secondary"\|"ghost"\|"danger"`, `size: "sm"\|"md"\|"touch"`, `icon?`, `loading?`, `href?` | `--tm-accent`, focus ring `--bd-focus-ring`; touch = 44 px |
| `Chip` | `kind: "status"\|"priority"\|"label"\|"count"\|"actor"`, `value`, `dot?` | status/priority always **dot + word**; colours via `--tm-status-*` only |
| `Card` | `interactive?`, `selected?`, `live?`, `as?` | `--bd-shadow-card`, `--bd-radius-lg`; never nested |
| `Inspector` / `Sheet` | `title`, `onClose`, `actions?`, `width: "wide"\|"full"` | grid `auto 1fr`, sticky header, body `overscroll-behavior: contain`, `[data-tm-drawer]` on the root |
| `Modal` | `open`, `onClose`, `title`, `initialFocus?` | native `<dialog>`; `#root` gets `inert` while open |
| `Select` | `value`, `options:[{value,label}]`, `onChange`, `placeholder?`, `clearable?` | native `<select>` |
| `Combobox` | `values`, `options`, `onChange`, `creatable?`, `multiple?`, `catalog?` | listbox with roving focus, typeahead; used for labels/links |
| `Field` | `label`, `help?`, `error?`, `required?`, children | wraps any control; error text inline |
| `TextField` / `TextArea` | standard + `mono?` | Plex Mono for ids/paths/SHAs |
| `InlineEdit` | `value`, `onSave`, `multiline?`, `placeholder` | Escape cancels via document-capture listener (do not close the inspector) |
| `Tabs` | `items:[{id,label,count?}]`, `active`, `onChange` | `role=tablist`, arrow keys |
| `Table` | `columns:[{key,label,align?,mono?}]`, `rows`, `renderCell?`, `stackBelow=720` | semantic `<table>`; stacks to definition rows below breakpoint |
| `KpiTile` | `label`, `value`, `delta?`, `hint?` | Plex Mono value; never colour-only delta |
| `Progress` | `value`, `max`, `label` | `role=progressbar` |
| `Sparkline` / `Bars` / `Burndown` | `series`, `width?`, `height?`, `ariaLabel` | inline SVG, `--bd-chart-series-*`; load the `dataviz` skill first |
| `Dag` | `nodes`, `edges`, `onSelect`, `highlight?` | layered layout, keyboard-walkable nodes |
| `Toast` + `LiveRegion` | `toast.show({ text, kind, action? })` | one `aria-live="polite"` region in the shell |
| `EmptyState` | `title`, `body?`, `action?`, `art?` | art = the direction piece, decorative `aria-hidden` |
| `Skeleton` | `shape: "board"\|"list"\|"detail"\|"table"` | matches the screen's real layout |
| `Kbd`, `Avatar`, `Tooltip`, `Menu`, `Toggle`, `Checkbox` | conventional | `Tooltip` shows on focus too; `Menu` is `role=menu` with arrow keys |
| `Markdown` | `source` | `markdown.mjs` blocks → elements, classes only |

## 6. Token rules

- Colour, space, radius, type, shadow, motion come **only** from `var(--bd-*)` or the semantic
  aliases `var(--tm-*)` in `styles/tokens.css`. No hex, `rgb()`, `hsl()`, `oklch()` literals
  anywhere under `src/`. Gate: `grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(' dashboard/src` returns nothing.
- `build-pwa.mjs` reads its three colours from `.context/design-system/tokens/bytedesk.tokens.json`.
- The token stylesheet is `.context/design-system/tokens/css/bytedesk.css`, imported once from
  `styles/app.css` (the `@import` line `bd-design init` writes). Dark is `:root`; light is
  `[data-bd-theme="light"]`.
- Semantic aliases (`--tm-*`, defined once in `tokens.css`, both themes):
  surfaces `--tm-bg-base/-subtle/-surface/-elevated/-overlay`; text `--tm-text/-2/-3/-disabled`;
  borders `--tm-border/-strong`; accent `--tm-accent/-hover/-subtle/-text`;
  status × 6 (`backlog, todo, progress, blocked, parked, done`) each `--tm-status-<s>`,
  `--tm-status-<s>-bg`, `--tm-status-<s>-line`; priority `--tm-priority-<p>` (highest…lowest);
  live `--tm-live`, stale `--tm-stale`; `--tm-focus`, `--tm-shadow-card/-shell/-focus`;
  `--tm-radius-sm/-md/-lg`; space ladder `--tm-space-0…11` = `0 2 4 6 8 12 16 20 24 32 40 48`;
  `--tm-font-sans` (IBM Plex Sans), `--tm-font-mono` (IBM Plex Mono); `--tm-duration-fast/-base`,
  `--tm-ease`.
- Plex Mono for ids, SHAs, timestamps, paths, session ids, branch names, machine values.
- Product scope `data-bd-product="task-management"` inherits the family accent (interactive blue);
  orange is the mark only.

## 7. Keyboard map and palette

From `dashboard/src/keys.mjs KEYMAP` (verbatim — the help sheet renders from the same array):

| Keys | Action | Label | Group |
|---|---|---|---|
| `j`, `ArrowDown` | down | next card | Move |
| `k`, `ArrowUp` | up | previous card | Move |
| `h`, `ArrowLeft` | left | column left | Move |
| `l`, `ArrowRight` | right | column right | Move |
| `g` | first | first card in the column | Move |
| `G` | last | last card in the column | Move |
| `Enter`, `o` | open | open the card | Card |
| `1`–`6` | status | move to column 1–6 (`COLUMNS` order) | Card |
| `[` | rankUp | rank above the card before it | Card |
| `]` | rankDown | rank below the card after it | Card |
| `x` | select | select / deselect (for the bulk bar) | Card |
| `w` | watch | watch — notify me if this is blocked or taken | Card |
| `c` | create | new task | Board |
| `/` | search | search | Board |
| `?` | help | this list | Board |
| `⌘K` / `Ctrl-K` | palette | command palette (opens from inside fields too) | — |
| `Esc` | escape / blur | close inspector or leave a field | — |

Rules from `resolve()`: modifier chords other than `⌘K` are left to the browser; nothing fires
while typing in a field or while a dialog is open. Screen-local keys (`a`, `s`, `n`/`p`, `e`,
`c` copy) are declared per feature in the same `{ keys, action, label, group }` shape and merged
into the help sheet. Palette commands: `{ id, title, group, keywords[], run() }`; focused-card
commands first, then board, then route jumps, then entities; matched by `filterCommands`.

## 8. Accessibility and UX bar

- Board columns are `role="list"`, cards `role="listitem"` with `aria-label` carrying what the
  chips show, roving `tabindex` (exactly one card at `0`), visible `--bd-focus-ring`.
- Inspector: focus to heading on open, back to the opener on close; `Esc` closes; `inert` on the
  canvas behind a `Modal`; no focus traps that drop keyboard users.
- Status, priority, liveness: dot/icon **and** word; AA contrast in both themes.
- Touch targets 44 px below 720 px (`--bd-size-hit-target-touch`), 28 px pointer.
- Per-screen `Skeleton`, `EmptyState`, `ErrorPanel`; inline refusal text at the control plus a
  toast; **zero `window.prompt`/`confirm`/`alert`** — stop reasons, bulk assign/label, drop
  reasons, sweep/fix confirmations are inline fields or `Modal`s.
- Motion only from `--tm-duration-*`; `prefers-reduced-motion` honoured; the live-write pulse is
  the only ambient animation and it carries information.
- 200 % zoom holds; no horizontal body scroll at any breakpoint (wide content scrolls in its own
  container).
- All strings are the server's own wording for refusals; never a generic "something went wrong".

## 9. Test invariants and verify commands

Keep so the existing browser scripts need selector tweaks only:
- `[data-tm-card="<id>"]` on every card, `role="listitem"`, `tabindex="0"` on the cursor card,
  `aria-label` starting with the id; columns `role="list"`; the six `COLUMNS` in order.
- `#root` mount; `#tm-palette-list` inside the open palette; a `button[aria-label^="Open TM-"]`
  on each card; the inspector root `[data-tm-drawer]` with an `overflow-y: auto|scroll` body and the
  id as the first text node of its header (`tests/browser/drawer.mjs`).
- Search input `input[type=search][name=q]` (`tests/browser/keyboard.mjs` types `j` into it).

Verify per worker (run before reporting; paste output tails):
- Everyone: `npm --prefix task-management/dashboard run typecheck` and the hex grep in §6 (empty).
- FE-core: `node --test task-management/tests/unit/{keys,lanes,motion,markdown,metrics,pwa-queue,pwa-outbox,pwa-notify}.test.mjs`.
- FE-board: `node --test task-management/tests/unit/{keys,lanes}.test.mjs`; served build → `node task-management/tests/browser/keyboard.mjs`.
- FE-detail: served build → `node task-management/tests/browser/drawer.mjs`.
- FE-ops / FE-ops-screens: typecheck + screenshots at 1440/1024/390 via `playwright screenshot`.
- W8: `npm --prefix task-management/dashboard run build` (vendor chunk single file; no `__TOKEN__` left in `sw.js`).
- Lead (integration): `npm --prefix task-management/dashboard run build && task-management/run-tests.sh && node task-management/tests/browser/keyboard.mjs && node task-management/tests/browser/drawer.mjs && node .bytedesk/design-system-check.mjs`.
