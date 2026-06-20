---
name: bytedesk-browser-test
description: >-
  Drive the ByteDesk web app through real Chrome via the `agent-browser` CLI to
  prove frontend changes actually render and behave correctly before they ship.
  Required for every PR that touches `src/ByteDesk.Web/**`. Covers login,
  navigation, snapshot-and-ref interaction, screenshot capture, console/error
  inspection, network/HAR/trace capture, React DevTools, web vitals,
  mobile/PWA smoke, and tab management. Invoke for "browser test",
  "smoke the UI", "agent-browser",
  "render check", "frontend smoke", or whenever a PR's diff touches a `.tsx`,
  `.ts`, `.css`, `.json` under `src/ByteDesk.Web/`.
user-invokable: true
argument-hint: "[route or task description]"
allowed-tools:
  - Bash
  - Read
  - Write
---

## What This Skill Does

Wraps the `agent-browser` CLI for the ByteDesk local stack:

1. Opens a named browser session (`workflow-smoke` by default) against the local cluster.
2. Signs in as the local admin if the page bounces to `/login`.
3. Navigates to the route under test.
4. Captures a screenshot, snapshots interactive refs, reads console + page errors, and (optionally) drives an interaction.
5. Returns PASS / FAIL with the screenshot path so the caller can attach it to the PR.

The skill is the only sanctioned way to exercise the UI from a PR-ready or feature-work skill. The raw CLI is fine for ad hoc exploration, but anything that influences a `ship`/`land` decision must go through this skill so login + screenshot + console capture happen consistently.

## Where the CLI lives

`agent-browser` is installed globally on the host; no per-repo install is required. Verify with:

```bash
agent-browser --help
```

If the CLI is missing, install once with `npm i -g agent-browser && agent-browser install`. Never run `npm install agent-browser` inside this repo.

## Local stack defaults (dev only)

| Setting | Value |
|---|---|
| Base URL | `http://platform.bytedesk.localhost` |
| Admin email | `admin@bytedesk.com` |
| Admin password | `Admin123!` |
| Session name | `workflow-smoke` (override per task with `--session <name>`) |

The admin credentials are **dev-only**; production access flows through Identity + Infisical and never through this skill. Do not point the skill at `platform.bytedesk.ai` without removing the hardcoded password first.

## Wait for the web pod to be Ready first (BDP-1491)

When the smoke follows a `land`/roll (or any source-mount change), the web pod is mid-rollout: the old pod is terminating and the new one is still recompiling. Navigating immediately hits **stale code** or a not-yet-recompiled server and fails the gate for the wrong reason. Before the first `open`, block on the freshly-rolled pod being Ready:

```bash
# Re-resolve the pod by label AFTER the roll (the mid-roll selector can miss it),
# then wait for Ready with a bounded timeout. Next.js dev still needs a few
# seconds to compile the first route after Ready — give it a short warm-up.
microk8s kubectl -n bytedesk rollout status deployment/web --timeout=180s
microk8s kubectl -n bytedesk wait --for=condition=Ready pod \
  -l app.kubernetes.io/name=web --timeout=180s
sleep 5   # first-route compile warm-up
```

If the page still shows a transient error on the first hit, reload once after a short wait before treating it as a failure — a single warm-up reload is expected, a persistent error is a real block.

## The canonical loop

```bash
# 1. Open + (re)use a named session — survives across commands
agent-browser open --headed --session workflow-smoke http://platform.bytedesk.localhost/office/workflows

# 2. See what's on the page — only interactive elements, much smaller than full tree
agent-browser --session workflow-smoke snapshot -i

# 3. Act on a ref from the snapshot. Refs (@e1, @e2, ...) are re-assigned every
#    snapshot and become stale the moment the DOM changes — re-snapshot before
#    every ref interaction.
agent-browser --session workflow-smoke click @e3

# 4. Verify
agent-browser --session workflow-smoke screenshot /tmp/after-click.png
agent-browser --session workflow-smoke errors            # page errors
agent-browser --session workflow-smoke console           # console log
```

## Workflow Surface Reliability Rules

Use these rules for `/office/workflows/**`, React Flow, inspector tabs, and any
headed smoke after a long-running agent session.

- Set `DISPLAY=:0` when a resumed shell has no display. Local Xorg is `:0`;
  older Xvfb displays like `:97`/`:98` may exist but are not the default headed
  browser target.
- Always run `snapshot -i` before the first `fill`/`click` in a new session.
  Fresh sessions do not know refs yet, and `fill @e4` before a snapshot fails
  with `Unknown ref`.
- Re-snapshot after every DOM-changing action. Refs are reassigned constantly by
  Next.js recompiles and React Flow updates.
- For React Flow node selection and inspector tab clicks, prefer `eval` that
  finds elements by exact `textContent`/role over stale refs. Ref-clicks drift
  during hot reloads.
- Before debugging a stale UI, prove the source mount:
  `scripts/dev/workflow.mjs status` must show `localDev.repoRoot` pointing at
  the intended worktree, or run `scripts/dev/workflow.mjs use-localdev --services web`.
- After landing or syncing develop, stale browser output often means the mounted
  develop runtime is old. Run `scripts/dev/workflow.mjs sync-develop-runtime --roll web`
  before blaming the component.
- The web hostPath volume name is usually `bytedesk-source`; check it when the
  pod serves code from the wrong checkout.
- Do not rely on `@eN` text in logs. Some snapshots print `ref=e4` instead of
  `@e4`; read the snapshot content and pick by label/text.

## Mobile / PWA Smoke

Use this mode for Office Chat, customer portal, mobile navigation, installable
PWA behavior, service worker changes, badges, and notification UI.

1. Prove the mounted source before opening Chrome:
   ```bash
   scripts/dev/workflow.mjs status
   ```
2. Open a fresh mobile-sized session. Use the browser tool's viewport support
   when available; otherwise resize with `eval` after open.
   ```bash
   SESSION=bdp-mobile-1234
   URL=http://platform.bytedesk.localhost/office/chat
   DISPLAY=:0 agent-browser open --headed --session "$SESSION" "$URL"
   agent-browser --session "$SESSION" eval "window.resizeTo(390, 844)"
   ```
3. Validate the mobile-critical path, not only page load:
   - topbar title and action buttons fit without overlap
   - primary navigation opens/closes
   - keyboard focus is not trapped
   - no horizontal scroll on 390px width
   - service worker or PWA affordance works when relevant
4. Capture mobile proof:
   ```bash
   TMP=/tmp/pr-smoke/$SESSION
   mkdir -p "$TMP"
   agent-browser --session "$SESSION" screenshot "$TMP/mobile.png"
   agent-browser --session "$SESSION" errors > "$TMP/errors.txt"
   agent-browser --session "$SESSION" console > "$TMP/console.txt"
   ```
5. PASS only when text/actions fit at mobile width, the task path works, and
   `errors.txt` is empty.

If the mobile UI still reflects old code after merge, run
`scripts/dev/workflow.mjs sync-develop-runtime --roll web`, wait for Web, and
repeat the smoke before debugging component code.

## Login flow (admin@bytedesk.com / Admin123!)

When the URL bounces to `/login` after `open`, log in once at the start of the session:

```bash
SESSION=workflow-smoke
agent-browser --session $SESSION snapshot -i > /tmp/login-refs.txt
# Read the refs for the two textboxes (EMAIL, PASSWORD) and the SIGN IN button
# from the snapshot — they are typically @e4 / @e5 / @e2 but DO NOT hardcode.
EMAIL_REF=$(grep -oE '@e[0-9]+' /tmp/login-refs.txt | head -1)        # placeholder
PWD_REF=$(grep -oE '@e[0-9]+' /tmp/login-refs.txt | sed -n '2p')      # placeholder
BTN_REF=$(grep -oE '@e[0-9]+' /tmp/login-refs.txt | sed -n '3p')      # placeholder
# In practice: read the snapshot output and pick the correct refs by their
# accessible label (`textbox "EMAIL"`, `textbox "PASSWORD"`, `button "SIGN IN"`).
agent-browser --session $SESSION fill @e4 admin@bytedesk.com
agent-browser --session $SESSION fill @e5 'Admin123!'
agent-browser --session $SESSION click @e2
sleep 3
agent-browser --session $SESSION get url               # confirm /dashboard
```

The session keeps the auth cookie + bearer in the running Chrome instance, so subsequent navigations (`open` against any other URL in the same `--session`) do not re-prompt.

## Verification primitives

Every PR-gating smoke must capture at minimum the **screenshot** and the **errors** stream. Add `console` when chasing a parse/runtime bug; add `vitals` when chasing performance regressions; add `react renders` when chasing a re-render storm.

**Interpreting the result (BDP-1491):** PASS = the target route rendered (screenshot shows the expected UI, the post-nav URL is right) **and** the `errors` stream is empty. A non-empty `errors` stream, a page crash, or an unexpected `/login` bounce is a real FAIL — surface the captured errors + screenshot path in the PR body. Do **not** read a non-zero process exit code as a failure when `errors` is empty and the page rendered: an empty `=== ERRORS ===` block is a PASS regardless of exit code. The screenshot + `errors` stream are the source of truth, not the shell exit status.

```bash
agent-browser --session $SESSION screenshot /tmp/<route>.png
agent-browser --session $SESSION errors                  # JS errors on this page
agent-browser --session $SESSION console --clear         # discard noise
agent-browser --session $SESSION console                 # capture for diagnosis
agent-browser --session $SESSION snapshot -i             # see what's interactable
agent-browser --session $SESSION get text @e7            # read a node's text
agent-browser --session $SESSION get url                 # confirm post-nav URL
agent-browser --session $SESSION network requests --filter "/api/" > /tmp/api.log
agent-browser --session $SESSION vitals --json           # LCP/CLS/INP/TTFB/FCP
```

## Full capability map (from `agent-browser --help`)

Use this as the lookup index; always run `agent-browser <command> --help` for current flags before composing a long sequence.

### Core
| Verb | Purpose |
|---|---|
| `open <url>` | Launch + navigate. Aliases: `goto`, `navigate`. Flags: `--headed`, `--session`, `--headers <json>`, `--init-script`, `--enable react-devtools`. |
| `click <sel>` / `dblclick <sel>` | Click / double-click. `<sel>` accepts CSS or `@ref`. |
| `type <sel> <text>` / `fill <sel> <text>` | Type into / clear-and-fill an input. |
| `press <key>` | Send a key chord: `Enter`, `Tab`, `Control+a`, etc. |
| `keyboard type <text>` / `keyboard inserttext <text>` | Raw keystrokes / insertion without key events. |
| `hover` / `focus` / `check` / `uncheck` / `select <sel> <val…>` | Pointer + form-control helpers. |
| `drag <src> <dst>` | Drag and drop between refs. |
| `upload <sel> <files…>` / `download <sel> <path>` | File I/O. |
| `scroll <dir> [px]` / `scrollintoview <sel>` | Viewport movement. |
| `wait <sel\|ms>` | Wait for element or timeout. Also `wait --load networkidle\|domcontentloaded\|load`. |
| `screenshot [path]` / `pdf <path>` | Captures. |
| `snapshot` | Accessibility tree with refs. `-i` filters to interactive elements only. |
| `eval <js>` | Run JS in the page. Returns the last expression. |
| `connect <port\|url>` | Attach via CDP to an external Chrome. |
| `close [--all]` | Tear down the active session (or every session). |

### Navigation
| Verb | Purpose |
|---|---|
| `back` / `forward` / `reload` | Standard history controls. |
| `pushstate <url>` | Next.js / SPA client-side nav (uses `window.next.router.push` when present, else `history.pushState` + `popstate`). |

### Read state
`agent-browser get <what> [selector]` — `text`, `html`, `value`, `attr <name>`, `title`, `url`, `count`, `box`, `styles`, `cdp-url`.

### Predicate checks
`agent-browser is <what> <selector>` — `visible`, `enabled`, `checked`.

### Locators
`agent-browser find <locator> <value> <action> [text]` — locators: `role`, `text`, `label`, `placeholder`, `alt`, `title`, `testid`, `first`, `last`, `nth`.

### Mouse
`agent-browser mouse <action>` — `move <x> <y>`, `down [btn]`, `up [btn]`, `wheel <dy> [dx]`.

### Browser settings
`agent-browser set <setting>` — `viewport <w> <h>`, `device <name>`, `geo <lat> <lng>`, `offline [on|off]`, `headers <json>`, `credentials <user> <pass>`, `media [dark|light] [reduced-motion]`.

### Network
`agent-browser network <action>` — `route <url> [--abort|--body <json>] [--resource-type <csv>]`, `unroute [url]`, `requests [--clear] [--filter <pattern>]`, `har <start|stop> [path]`.

### Storage
- `cookies [get|set|clear]` — set supports `--url`, `--domain`, `--path`, `--httpOnly`, `--secure`, `--sameSite`, `--expires`; or `cookies set --curl <file>` for cURL / JSON / Cookie-header dumps.
- `storage <local|session>` — get/set keys in `localStorage` / `sessionStorage`.

### Tabs
`agent-browser tab [new|list|close|<n>]` — manage tabs in the running browser.

### Diff
- `diff snapshot` — compare current accessibility tree against the last snapshot.
- `diff screenshot --baseline <path>` — pixel-diff vs a baseline image.
- `diff url <u1> <u2>` — compare two pages.

### Debug
`trace start|stop [path]`, `profiler start|stop [path]`, `record start <path> [url]` / `record stop`, `console [--clear]`, `errors [--clear]`, `highlight <sel>`, `inspect` (open DevTools), `clipboard <op> [text]`.

### Streaming
`stream enable [--port <n>]` / `stream disable` / `stream status` — runtime WebSocket streaming.

### React (requires `open --enable react-devtools`)
- `react tree` — full component tree.
- `react inspect <id>` — props, hooks, state, source for one fiber.
- `react renders start` / `react renders stop [--json]` — re-render profile via `onCommitFiberRoot`.
- `react suspense [--only-dynamic] [--json]` — Suspense boundary report.

### Performance
`agent-browser vitals [url] [--json]` — LCP, CLS, TTFB, FCP, INP + React hydration timing when a profiling build is detected.

### Skills
`agent-browser skills [list]` / `skills get <name> [--full]` / `skills path [name]` — the upstream skill catalog (electron, slack, vercel-sandbox, agentcore, dogfood, core). This ByteDesk skill **wraps** those; do not re-document them, just delegate when needed:

```bash
agent-browser skills get core --full        # full upstream usage guide
agent-browser skills get dogfood --full     # exploratory bug hunt patterns
```

## When this skill is required (PR-ready integration)

`bytedesk-pr-ready` runs this skill automatically whenever the PR diff touches any of:

```
src/ByteDesk.Web/**
```

The smoke must:

1. Identify the **changed route(s)** from the diff (`src/ByteDesk.Web/src/app/(app)/<route>/page.tsx` → URL `/<route>`).
2. Open each route with this skill, log in if redirected, and capture a screenshot per route under `/tmp/pr-smoke/<BDP-N>/<route>.png`.
3. Capture `agent-browser errors` per route — any non-empty errors stream blocks the ship.
4. Paste the screenshot path + errors summary into the PR body so reviewers (and the next person to break it) can see the visible state.

If the local cluster isn't reachable (`agent-browser open` 5xx / 502 / ECONNREFUSED), STOP — do not ship. Surface the cluster outage instead.

## Common ByteDesk routes

| Route | Notes |
|---|---|
| `/dashboard` | Default post-login landing. |
| `/office/workflows` | Library page (DB-backed admin list). |
| `/office/workflows/library/<id>` | Detail page — renders `WorkflowSurface mode="read"`. |
| `/office/workflows/library/<id>/edit` | Editor — mounts `WorkflowEditor` + Architect sidebar. |
| `/office/workflows/runs/<runId>` | Run mode — live SignalR via `workflow:<id>:run:<runId>`. |
| `/office/workflows/trigger-tester` | Trigger-phrase tester. |
| `/office/workflows/analytics?window=7d` | Per-workflow run analytics. |
| `/dev/components` | Atomic-design catalog (use to verify new atoms render). |

## Cleanup — mandatory before the skill exits (stronger rules after the 2026 laptop stability work)

Every invocation owns a unique `--session <name>` and writes temp artifacts under a session-scoped directory. **Before returning** (success, failure, or interruption) the skill **must** leave zero leaked Chrome processes.

### Required cleanup steps (in order)

1. Stop any recorders:
   ```bash
   agent-browser --session "$SESSION" har stop 2>/dev/null || true
   agent-browser --session "$SESSION" trace stop 2>/dev/null || true
   agent-browser --session "$SESSION" profiler stop 2>/dev/null || true
   agent-browser --session "$SESSION" record stop 2>/dev/null || true
   ```

2. Close the session normally:
   ```bash
   agent-browser --session "$SESSION" close 2>/dev/null || true
   ```

3. **Aggressive Chrome process tree kill** (this is the new rule added to stop the 45+ leaked instances problem):
   - Kill every Chrome process whose user-data-dir matches this session or the generic agent-browser pattern.
   - Only processes owned by the current user are touched.
   ```bash
   pkill -9 -f "user-data-dir.*${SESSION}" 2>/dev/null || true
   pkill -9 -f "/tmp/agent-browser-chrome-" 2>/dev/null || true
   # Nuclear option for this session only (use when the above is insufficient)
   # pkill -9 -f "agent-browser.*chrome" 2>/dev/null || true
   ```

4. Remove the temp directory:
   ```bash
   rm -rf "/tmp/pr-smoke/$SESSION"
   ```

### Recommended pattern (copy this)

```bash
SESSION="laptop-stability-2026"
TMP="/tmp/pr-smoke/$SESSION"
mkdir -p "$TMP"

cleanup() {
  agent-browser --session "$SESSION" har stop 2>/dev/null || true
  agent-browser --session "$SESSION" trace stop 2>/dev/null || true
  agent-browser --session "$SESSION" profiler stop 2>/dev/null || true
  agent-browser --session "$SESSION" record stop 2>/dev/null || true
  agent-browser --session "$SESSION" close 2>/dev/null || true

  # Hard kill of any leaked Chrome trees for this session (critical after 2026 memory crisis)
  pkill -9 -f "user-data-dir.*${SESSION}" 2>/dev/null || true
  pkill -9 -f "/tmp/agent-browser-chrome-" 2>/dev/null || true

  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

# ... your smoke steps ...
```

**Preferred global tool**: Use `scripts/dev/browser-reaper.sh` (created as part of the laptop stability work) when you want to clean up leaks outside of a single smoke:

```bash
# Dry run (safe)
scripts/dev/browser-reaper.sh

# Actually kill everything leaked by agent-browser
scripts/dev/browser-reaper.sh --force

# Target one specific previous session
scripts/dev/browser-reaper.sh --session laptop-stability-2026 --force
```

**Exception for artifacts**: When a smoke produces a failure screenshot the PR body needs, copy it to a durable location *before* the trap runs, then let cleanup finish.

The old "just call close + rm -rf" pattern is no longer sufficient. The aggressive pkill step (or the dedicated reaper script) is now mandatory.

## Anti-patterns

- **Don't hardcode `@eN` refs across commands** — they reset on every snapshot. Always re-snapshot, then re-pick.
- **Don't `npm install` agent-browser inside this repo** — host CLI only.
- **Don't trigger JavaScript `alert()`/`confirm()`** — they block the extension and stall the session. Use `console.log` + `read_console_messages` style instead.
- **Don't reuse another agent's session id** — sessions are per-task; collisions corrupt cookies. Use a fresh `--session <name>` per BDP key.
- **Don't ship without the screenshot + errors capture.** A green build is not proof the page renders.

## Quickstart — full PR smoke recipe

```bash
SESSION=bdp-1234
URL=http://platform.bytedesk.localhost/office/workflows/library/<workflow-id>
TMP=/tmp/pr-smoke/$SESSION
mkdir -p "$TMP"

# Cleanup on any exit
cleanup() {
  agent-browser --session "$SESSION" har stop 2>/dev/null || true
  agent-browser --session "$SESSION" trace stop 2>/dev/null || true
  agent-browser --session "$SESSION" profiler stop 2>/dev/null || true
  agent-browser --session "$SESSION" record stop 2>/dev/null || true
  agent-browser --session "$SESSION" close 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

# 1. Open + login if bounced
agent-browser open --headed --session "$SESSION" "$URL"
if agent-browser --session "$SESSION" get url | grep -q '/login'; then
  agent-browser --session "$SESSION" snapshot -i      # read EMAIL / PASSWORD / SIGN IN refs
  # use the actual refs printed above:
  agent-browser --session "$SESSION" fill @e4 admin@bytedesk.com
  agent-browser --session "$SESSION" fill @e5 'Admin123!'
  agent-browser --session "$SESSION" click @e2
  sleep 3
  agent-browser --session "$SESSION" open "$URL"
fi

# 2. Capture (write under $TMP so the trap removes it)
agent-browser --session "$SESSION" screenshot "$TMP/detail.png"
agent-browser --session "$SESSION" errors > "$TMP/errors.txt"
agent-browser --session "$SESSION" console > "$TMP/console.txt"

# 3. Decide. On failure, copy the screenshot somewhere durable before the trap nukes $TMP.
if [ -s "$TMP/errors.txt" ]; then
  cp "$TMP/detail.png" "$HOME/$SESSION-failure.png"
  echo "BLOCK: page errors — screenshot: $HOME/$SESSION-failure.png"
  cat "$TMP/errors.txt"
  exit 1
fi
echo "OK — smoke green ($TMP/detail.png will be cleaned up on exit)"
```
