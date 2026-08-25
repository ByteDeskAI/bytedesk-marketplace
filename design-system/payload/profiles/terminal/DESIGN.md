# ByteDesk Terminal — Design Reference

Canonical source of truth for the cockpit. Read this before touching `src/`.
Last updated: 2026-05-28.

---

## 1. Positioning

ByteDesk Terminal is an **Agentic Development Environment (ADE)** — a GTK4
mission cockpit that unifies every AI coding agent on the machine, every
tmux-backed terminal session, and every external IDE handoff into one
keyboard-driven surface.

It is **terminal-first**, not editor-first. The agent is the primary surface;
the editor is incidental and lives in Cursor / Zed / Windsurf, which the
cockpit launches as external workspaces. This is the Warp / Claude Code lane,
not the Cursor / Zed lane.

### What this is

A conductor for: Claude Code, Codex CLI, Grok Build, GitHub Copilot CLI,
Gemini CLI, Aider, Ollama (sidecar), tmux, gh, git — all already present on
the target environment.

### What this is not

- Not an editor (no buffer; hand off to Cursor/Zed/Windsurf/VSCode).
- Not a tmux replacement (tmux is the engine).
- Not a model gateway (each agent talks to its own provider).
- Not cross-platform v1 (GTK4 + Linux).

---

## 2. Layout (Layout C — dual rails + bottom dock)

```
┌─ BDP-742 fix login regression  ⎇feature/foo ●+2/-0  ↑2↓0   2h ago     ⌘K  ⚙ ─┐ 28
├──────────────────┬───────────────────────────────────────────┬─────────────────┤
│ MISSIONS    7    │ Codex• Claude Tests Logs Shell      + ⋯  │ AGENTS      3/9 │ 24
├──────────────────┼───────────────────────────────────────────┼─────────────────┤
│▾ ACTIVE       3  │┌─Codex (active) ─────────┬─Claude (idle)─┐│●claude   ready │
│▌BDP-742 fix lo..ǁ││$ codex                  │> waiting       ││●codex   12t/s │
│ feature/foo +2 2h││refactor mission store…  │                ││●grok   queued │
│ BDP-501 import b ││                         │                ││○copilot   off │
│ master       1d  ││                         │                ││○gemini    off │
│ BDP-318 jira sy. ││                         │                ││○aider     off │
│ feature/jira 3d  ││                         │                ││○windsurf  gui │
│▾ WAITING      2  ││                         │                │├─ HANDOFF ─────┤
│ BDP-204 docs     ││                         │                ││⇉ Codex→Claude │
│ BDP-188 spike    │├─────────────────────────┴───────────────┤│⇉ broadcast    │
│▾ BLOCKED      1  ││Shell                                     ││⇉ capture→note│
│ BDP-099 ci flake ││$ cargo test --no-default-features        │├─ EXTERNAL ────┤
│▾ DONE         1  ││test storage::tests::store_round_trips ok ││→ Cursor       │
│ BDP-052 cleanup  ││test models::tests::terminal_kind … ok    ││→ Zed          │
│                  ││                                          ││→ Windsurf     │
│ + new mission    ││                                          ││→ VSCode       │
├──────────────────┴──────────────────────────────────────────┴─────────────────┤
│●Thoughts 4  ○Prompts  ○Context  ○Memory  ○Timeline  ○Git  ○Jira  [⇅][—][⤢]   │ 24
├──────────────────────────────────────────────────────────────────────────────┤
│ kind  body                                              age    actions       │
│ now   fix login bug regression flagged by QA            12m   ⇉C ⇉X ✓        │
│ next  add integration test for the auth migration       1h    ⇉C ⇉X ✓        │
│ risk  rusqlite bundled vs system build on noble — CI?   3h    ⇉C ⇉X ✓        │
│ park  evaluate zellij vs gtk paned trees                1d    ⇉C ⇉X ✓        │
│ + capture thought…                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│tmux● ollama● gh● git●  ⎇feature/foo ↑2↓0 +2/-0                         ●voice│ 20
└──────────────────────────────────────────────────────────────────────────────┘
                                                                   1440 × 940
```

### Region contract

| Region | Default size | Resizable | Collapsible | Persists |
|---|---|---|---|---|
| Header | full × 28 | no | no | — |
| Tab strip | full × 24 | no | no | per mission |
| Missions rail | 220 × flex | 180–320 | yes → 32px icon column | per window |
| Workspace | flex × flex | — | — | layout per mission (JSON) |
| Agents rail | 32 default, 264 expanded | 220–360 | smart-collapse (rule below) | per window |
| Dock | full × 140 | 96–360 | yes → 24px tab strip | per mission |
| Status bar | full × 20 | no | no | — |

### Behaviors

- **Agents rail smart-collapse** — 32px icon column when 0–1 agent attached.
  Auto-expands to 264px the moment a 2nd agent attaches. Auto-collapses 10s
  after dropping back to ≤1. Manual `⌘J` overrides smart state until the next
  mission switch.
- **Command palette** — Raycast-style centered overlay, ~560×400, 12% scrim,
  scale-from-0.96 entrance (140ms). `Esc` / scrim-click dismiss. `↑/↓`
  navigate, `↵` run, `⌘↵` run + keep open (chained verbs).
- **New tab** — `⌘T` opens a blank pane with an agent picker centered inside
  it. Unavailable binaries greyed with tooltip on why. Recent agents float to
  top per-mission. `Esc` closes the empty tab.
- **Mission rows** — key-first (`BDP-742 fix login bug`), 2 lines, 22px row
  height. Line 1: key + title (truncated middle). Line 2 in 11px `--fg-muted`:
  `branch · dirty · age`.
- **Active row marker** — 2px left-edge accent stripe (`#7C5CFF`). No fill,
  no glow.
- **Pane title bars** — 18px tall, label + state badge inline, no padding.

### Responsive collapse

- < 1280px wide → agents rail forces icon column.
- < 1024px wide → missions rail also collapses; both reachable as `⌘B` / `⌘J`
  slide-overs.
- < 720px tall → dock collapses to tab strip.

---

## 3. Density rules & design tokens

Dark only in v1. Sharp lines, hairline borders, zero shadows, data-dense.

### Spacing & dimensions

- Spacing scale: **2 / 4 / 6 / 8 / 12** (no looser end).
- Border radius: **0 everywhere**.
- Borders: **1px hairline `--border-subtle`** — every divider. Regions share
  a single line; no double borders.
- Elevation: **flat** — depth comes from background tone, not shadow. Modals
  use a 1px hairline border, not a drop shadow.

### Color tokens

```
--bg-base       #0A0B0F    base
--bg-raised     #11131A    rails, dock
--bg-overlay    #181B25    palette, picker
--fg-primary    #E6E8EF
--fg-secondary  #A0A6B8
--fg-muted      #5C6378
--border-subtle #1E2230
--border-strong #2A2F3F
--accent        #7C5CFF    active marker, primary CTA
--ok            #3DD68C
--warn          #F4B740
--err           #FF6B6B
--info          #5BB6FF
```

Per-agent hues (desaturated; 6px chip use only — never floods UI):

```
claude   #C26849   codex    #0E8E6F   grok     #1A8AD0
copilot  #7A4DC4   gemini   #3A75DB   aider    #BD9760
```

### Typography ladder (final — 5 sizes total)

```
12 / 16  Inter 500            UI body / list rows
11 / 14  Inter 400            meta, secondary, dock body
14 / 18  Inter 600            mission breadcrumb in header
11 / 14  JetBrains Mono 400   terminal content, all numerics
10 / 12  Inter 600 uppercase tracking 0.04em   section labels
```

- Tabular numerics everywhere counts/ages/tok-s appear:
  `font-feature-settings: 'tnum'`.
- Truncation: middle-ellipsis for keys/paths, never end.

### Iconography

- Lucide via SVG GResource bundle. Single stroke weight **1.25**.
- Sizes: **12** and **14** only.
- Outline for inactive, filled for active. No emoji as icons, anywhere.

### Motion

- Tab switch / pane open: 180ms ease-out, `transform`+`opacity` only.
- Palette: 140ms fade+scale from 0.96.
- Agent activity pulse on chip: 1.2s ease-in-out. Respects `prefers-reduced-motion`.
- Never animate width/height of panes; tween `gtk::Paned` position.

---

## 4. Keymap

Carved in stone. Every entry surfaced in `⌘K`.

```
Navigation
  ⌘K           command palette
  ⌘P           fuzzy mission switcher
  ⌘B           toggle missions rail
  ⌘J           toggle agents rail
  ⌘`           toggle dock
  ⌘1..9        jump to tab N

Workspace
  ⌘T           new tab (opens agent picker)
  ⌘W           close pane / tab
  ⌘\           split vertical
  ⌘-           split horizontal
  ⌘⇧Z          zoom active pane
  ⌘⇧F          fullscreen workspace (hide all chrome)
  ⌘⇧↑/↓/←/→   focus pane in direction
  ⌘↑/↓         dock height step

Features (P1.5)
  ⌘;           push-to-talk voice (hold)
  ⌘⇧R          agent race on selected prompt
  ⌘⇧C          focus context bus
  ⌘⇧M          open memory sync editor
  ⌘⇧P          open prompt vault palette
  ⌘V           smart paste (intercepts default)
```

---

## 5. Capability set

### v1 — locked scope

1. **Multiplexing core** — tabs of recursive `gtk::Paned` trees; each pane
   attaches to a tmux session that survives app restarts; layout JSON
   persisted per mission.
2. **Universal context bus** — per-mission scratchpad (`.bdterm/<mission>/context.md`)
   auto-injected into every agent launch. Dock tab `Context`.
3. **Voice → prompt** — push-to-talk `⌘;` → **local whisper.cpp** → text →
   injected at the focused pane. No API fallback in v1.
4. **Agent race / vote** — `⌘⇧R` fans the same prompt across N selected
   agents in parallel panes; verdict bar above panes lets the user accept,
   merge, or re-prompt.
5. **Project memory sync** — one canonical editor writes the dialects already
   present in the repo: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
   `.windsurfrules`, `.github/copilot-instructions.md`. Dock tab `Memory`.
6. **Smart paste** — `⌘V` intercepts clipboard, regex detectors route by
   content (stack trace → fix-this prompt; URL → fetch+summarize; diff →
   review; plain → raw).
7. **Prompt vault** — extends the existing `Thought` model with templated
   prompts, recall via palette. Dock tab `Prompts`.

### Explicitly deferred (v2+)

Diff review surface · Approval queue · Watcher-triggered runs · Session
replay · Inline screenshots → multimodal · MCP server registry · Mission
templates · Floating pane detach · Desktop notifications · Cost & token
telemetry · Light theme · Pair mode · Background runners · Mission knowledge
graph · LLM proxy · Web preview pane.

### Explicit skip list (do not build)

Built-in editor · Cloud agent dashboard · Plugin marketplace · AI-generated
UI for missions · Per-agent "skills" abstraction.

---

## 6. Architecture — pattern map

References: **GoF** (Gang of Four, *Design Patterns*, 1994), **EIP**
(Hohpe & Woolf, *Enterprise Integration Patterns*, 2003), **POSA**
(Buschmann et al.), **PoEAA** (Fowler).

### Cross-cutting forces

- Single-threaded GTK main loop. All "message bus" patterns respect that;
  EIP channels here are `glib::MainContext` / `async_channel`, not Kafka.
- SQLite + JSON-blob = closer to a document store than relational. Resist
  ORM/UoW pull.
- ~1700 LOC today. The hard-coded `match` on `TerminalKind` in
  `integrations.rs:101-146` is the #1 friction point as agents grow.

### Subsystem-to-pattern matrix

| # | Subsystem | Pattern | Source |
|---|-----------|---------|--------|
| A | Agent registry & launch | Abstract Factory + Registry + Strategy | GoF |
| B | Pane lifecycle | State (enum-encoded) | GoF |
| C | Pane tree composition | Composite | GoF |
| D | Cross-pane handoff / race | Scatter-Gather + Aggregator + Recipient List | EIP |
| E | Smart paste pipeline | Chain of Responsibility + Content-Based Router | GoF + EIP |
| F | Memory sync | Adapter + Message Translator | GoF + EIP |
| G | Command palette | Command + Registry | GoF |
| H | Persistence | Repository per aggregate | PoEAA |
| I | UI event flow | Observer over Pub-Sub Channel | GoF + EIP |
| J | tmux supervision | Process Manager / Supervisor + Facade | EIP + POSA |
| K | Configuration | Typed Config aggregate (layered loader) | POSA-lite |
| L | Errors / telemetry seam | Typed errors + Wire Tap (TelemetrySink) | thiserror + EIP |

### A. Agent registry & launch

**Why this, not enum expansion or dylib plugins.** Today every agent is a
`TerminalKind` enum variant with parallel `match` arms in `models.rs`,
`integrations.rs`, `storage.rs`. Adding Gemini means touching all three.
Adapter trait + registry collapses adds to one file + one `register()`.
Dylib/wasm plugins are overkill for an in-tree binary.

```rust
pub trait AgentAdapter: Send + Sync {
    fn id(&self) -> &'static str;                  // "claude", "codex", …
    fn label(&self) -> &'static str;
    fn detect(&self) -> Detection;                 // which + version probe
    fn build_profile(&self, ctx: &LaunchCtx) -> LaunchProfile;
    fn capabilities(&self) -> AgentCaps;           // stdin streaming, MCP, …
}

pub struct AgentRegistry { adapters: Vec<Arc<dyn AgentAdapter>> }
impl AgentRegistry {
    pub fn bootstrap() -> Self;
    pub fn available(&self) -> impl Iterator<Item=&dyn AgentAdapter>;
    pub fn get(&self, id: &str) -> Option<&dyn AgentAdapter>;
}
```

`TerminalKind` collapses to `Shell | Agent(AgentId) | Utility(UtilKind)`.
**Seam:** new agent = `impl AgentAdapter` + `register()`. **Testing:**
`StubAgent` returning a fixed `LaunchProfile` drives the launch pipeline
without `which::which`.

Embedded SDK assistants (e.g. the automatic per-mission "Grok Planner") live
outside the CLI AgentAdapter path. They use direct xAI REST (or xai-sdk) with
a purpose-built system prompt + host tools that mutate Mission/Thoughts/Timeline
directly. Created automatically in `mission_dialog` + `workspace::ensure_planner_for`
on MissionUpserted/Switched (see plan.md for the 2026 integration). The planner
tab is a special non-VTE TabRecord (agent_id="planner") with its own chat widget
and .bdterm/<id>/planner-chat.json persistence. It is the "AI assistant in the
main terminal" whose job is mission planning.

**Auth for the embedded Grok client (no-paste):** `GrokClient::new` resolves the
bearer with strict precedence: `GROK_API_KEY` env (highest), then the access
token from `~/.grok/auth.json` (written by `grok login` OAuth for SuperGrok /
X Premium+ users), then `config.grok.api_key`, then XAI_* fallbacks. The
settings "Grok" page surfaces "Launch Grok OAuth Login" (spawns the official
CLI which drives real browser + its localhost callback/PKCE) + "Import key
from Grok OAuth now". On import (or a short poll after launch) the live
`Arc<GrokClient>` is `update_api_key`'d (so open planners and new chats use it
immediately) and a copy is `save()`d to our config for future runs without the
grok CLI present. The manual paste EntryRow was removed from the UI.

### B. Pane lifecycle

**Why State, not a `bool is_live`.** `Empty → Launching → Live → Dead` has
illegal transitions (`Live → Launching` should require `Dead` in between). A
sealed enum with transition methods returning `Result` localizes the
invariants instead of smearing them across `ui.rs`. Four states; don't reach
for a state-machine crate.

```rust
pub enum PaneState {
    Empty(PickerModel),
    Launching { profile: LaunchProfile, started: Instant },
    Live(LiveSession),                  // vte::Terminal + tmux session id
    Dead(ExitSummary),
}
impl PaneState {
    pub fn launch(self, p: LaunchProfile) -> Result<Self, TransitionErr>;
    pub fn mark_live(self, term: vte::Terminal) -> Result<Self, TransitionErr>;
    pub fn mark_dead(self, summary: ExitSummary) -> Result<Self, TransitionErr>;
}
```

Rendering is a pure `fn(&PaneState) -> gtk::Widget`. Transitions emit
`PaneEvent` to the bus (subsystem I). State transitions tested without GTK.

### C. Pane tree composition

**Why explicit Composite.** A `gtk::Paned` tree literally is the Composite
pattern. Model it explicitly so persistence and palette commands ("split
right", "rotate", "close") operate on the model, not on widgets. Implicit
tree → Warp-style layout restore becomes painful.

```rust
pub enum PaneNode {
    Leaf(PaneId),
    Split { dir: SplitDir, ratio: f32, a: Box<PaneNode>, b: Box<PaneNode> },
}
pub struct PaneTree { root: PaneNode, arena: HashMap<PaneId, PaneState> }
impl PaneTree {
    pub fn split(&mut self, target: PaneId, dir: SplitDir) -> PaneId;
    pub fn close(&mut self, target: PaneId) -> Result<()>;
    pub fn fold<R>(&self, visit: impl FnMut(&PaneNode) -> R) -> R;
}
```

Serializes as JSON blob → `terminal_sessions.layout_json`. Property tests on
split/close invariants.

### D. Cross-pane handoff, broadcast, race

**Why EIP names.** "Send this prompt to claude+codex+gemini, collect outputs,
let the user pick" is textbook Scatter-Gather with a manual Aggregator (the
verdict bar). Use the EIP vocabulary so future contributors recognize the
shapes from the literature.

```rust
pub struct PromptEnvelope {
    pub id: MsgId,
    pub mission: MissionId,
    pub body: String,
    pub correlation: Option<MsgId>,
}

pub trait Channel<T>     { fn send(&self, msg: T); }       // Message Channel
pub trait RecipientList  { fn route(&self, env: &PromptEnvelope) -> Vec<PaneId>; }

pub struct ScatterGather {
    recipients: Box<dyn RecipientList>,
    aggregator: Box<dyn Aggregator>,                       // Aggregator (EIP)
    pending:    HashMap<MsgId, Vec<AgentReply>>,
}
impl ScatterGather { pub fn dispatch(&mut self, env: PromptEnvelope); }
```

`RecipientList` swaps "all live agents" vs "user-selected"; `Aggregator`
swaps "first wins" vs "wait for N" vs "user picks". Correlation ID ties
replies to prompts in the verdict bar. Driven by in-memory channels and fake
panes in tests.

### E. Smart paste pipeline

**Why Chain of Responsibility.** Each classifier (stack-trace, URL, diff,
plain) is independent and ordered by specificity. Chain short-circuits.
God-`match` on regexes rots fast.

```rust
pub enum PasteIntent { FixStackTrace(String), FetchUrl(Url), ReviewDiff(String), Raw(String) }
pub trait PasteClassifier { fn classify(&self, raw: &str) -> Option<PasteIntent>; }
pub struct PasteRouter { chain: Vec<Box<dyn PasteClassifier>> }
```

Table-driven tests on `(input, expected_intent)` tuples.

### F. Memory sync

**Why Adapter.** One canonical `ProjectMemory` AST; each on-disk dialect is
an adapter that (a) detects whether it's in use in the repo and (b) renders.
Add `.aider.conf.md` = new adapter impl.

```rust
pub trait MemoryDialect {
    fn id(&self) -> &'static str;
    fn target_path(&self, repo: &Path) -> PathBuf;
    fn is_active(&self, repo: &Path) -> bool;
    fn render(&self, memory: &ProjectMemory) -> String;
}
pub struct MemorySync { dialects: Vec<Box<dyn MemoryDialect>> }
```

Golden-file tests per dialect; `is_active` tested against fixture repos.

### G. Command palette + action invocation

**Why Command.** "Every cockpit action is a command" is exactly what GoF
Command was invented for: uniform invocation, keybinding, palette display,
later undo seam. Avoid a giant `fn dispatch(name: &str)` switch.

```rust
pub trait Command: Send + Sync {
    fn id(&self) -> &'static str;
    fn title(&self) -> String;
    fn keywords(&self) -> &[&'static str];
    fn enabled(&self, ctx: &AppCtx) -> bool;
    fn run(&self, ctx: &mut AppCtx) -> Result<()>;
}
pub struct CommandRegistry { cmds: Vec<Arc<dyn Command>> }
```

Voice, keybindings, palette, smart paste all funnel through
`CommandRegistry::run(id, ctx)`.

### H. Persistence

**Why Repository per aggregate, no UoW.** SQLite is single-writer; transactions
are short. UoW is ceremony. `AppStore` today is a repository pile; split by
aggregate (Mission, PaneTree, PromptVault, ProjectMemory) so test surfaces
stay narrow. JSON blobs for schema-volatile / document-shaped state
(`PaneTree`, `LaunchProfile` extras) — don't normalize prematurely. Wrap
multi-statement writes in `conn.transaction()` at the call site.

```rust
pub trait MissionRepo {
    fn list(&self) -> Result<Vec<Mission>>;
    fn upsert(&self, m: &Mission) -> Result<()>;
    fn with_thoughts(&self, id: MissionId) -> Result<(Mission, Vec<Thought>)>;
}
pub struct SqliteMissionRepo { conn: Arc<Mutex<Connection>> }
pub struct PaneTreeRepo  { /* JSON blob per tab */ }
pub struct PromptVaultRepo { /* … */ }
```

In-memory fakes via `AppStore::open_memory()` pattern carry over.

### I. UI event flow

**Why Observer over Pub-Sub, not actors.** GTK widgets react to mission
updates, pane state changes, race verdicts. A central typed `AppEvent` enum
with subscribers is the smallest thing that works and avoids `ui.rs`
reaching into `AppStore` directly. GObject custom signals are verbose in
gtk-rs; full actor frameworks duplicate the existing GTK event loop.

```rust
pub enum AppEvent {
    MissionUpserted(MissionId),
    PaneStateChanged(PaneId, PaneStateTag),
    AgentRaceVerdict { prompt: MsgId, winner: PaneId },
    StatusBar(String),
}
pub struct EventBus { tx: async_channel::Sender<AppEvent> }
impl EventBus {
    pub fn publish(&self, e: AppEvent);
    pub fn subscribe<F: Fn(&AppEvent) + 'static>(&self, f: F);   // dispatched on main loop
}
```

UI layer reads via repos and listens on the bus; telemetry (L) is just
another subscriber.

### J. tmux supervision

**Why Process Manager + Facade.** As we add reconciliation ("which DB
sessions are still alive at startup?", "GC sessions of deleted missions"),
we need a long-lived object owning the policy. EIP Process Manager is the
right name — tmux session lifecycle is a stateful conversation. Facade over
the `tmux` CLI keeps the surface testable. Reject libtmux-style protocol
parsing in v1.

```rust
pub trait TmuxBackend {                                 // facade seam for tests
    fn has(&self, name: &str) -> bool;
    fn new_session(&self, spec: &SessionSpec) -> Result<()>;
    fn kill(&self, name: &str) -> Result<()>;
    fn list(&self) -> Result<Vec<String>>;
}
pub struct TmuxSupervisor { backend: Arc<dyn TmuxBackend>, known: HashSet<String> }
impl TmuxSupervisor {
    pub fn ensure(&mut self, spec: &SessionSpec) -> Result<()>;
    pub fn reconcile(&mut self, expected: &[String]) -> ReconcileReport;   // on startup
}
```

`FakeTmux` for tests; `CliTmux` for prod.

### K. Configuration

**Why one typed aggregate, not a dynamic registry.** v1 doesn't need
hot-reload or per-feature dynamic toggles. The hard-coded
`/home/ryan/Documents/...` in `integrations.rs:259` is the smell to fix
first. Layered loader: defaults < `~/.config/bdterm/config.toml` < env
`BDTERM_*`.

```rust
#[derive(Deserialize)]
pub struct AppConfig {
    pub paths: PathsCfg,
    pub agents: AgentCfg,           // enable/disable per agent id
    pub features: FeatureFlags,     // bool flags only
    pub jira: JiraBootstrapConfig,
    pub voice: VoiceCfg,
}
impl AppConfig { pub fn load() -> Result<Self>; }
```

Threaded as `Arc<AppConfig>` through `AppCtx`. Feature flags read at
decision points, never cached far from the check.

### L. Errors & telemetry seam

**Why typed errors + Wire Tap now.** `thiserror` is already a dep; use it
per subsystem instead of letting `anyhow::Error` cross boundaries (anyhow
only at the binary edges). The Wire Tap pattern is the cost-telemetry seam
we're deferring: every `AppEvent` and command result flows past a no-op
`TelemetrySink` today; cost / OTel / Sentry plug in tomorrow without
touching producers.

```rust
#[derive(thiserror::Error, Debug)]
pub enum AgentErr {
    #[error("agent {0} not installed")] NotInstalled(String),
    #[error("tmux: {0}")]                Tmux(#[from] TmuxErr),
    #[error("io: {0}")]                  Io(#[from] std::io::Error),
}

pub trait TelemetrySink: Send + Sync {
    fn event(&self, e: &AppEvent);
    fn error(&self, scope: &'static str, err: &dyn std::error::Error);
    fn span(&self, name: &'static str) -> SpanGuard;     // RAII timing
}
pub struct NoopSink;                                     // v1 default
```

### Pattern overkill — do not build in v1

- Unit of Work for SQLite (use `conn.transaction()`).
- Actor framework for the EventBus (GTK main loop + `async_channel` works).
- Plugin system (dylib/wasm) for agents (revisit at v3).
- Visitor over `PaneNode` (Rust `match` is the idiomatic Visitor).
- DI container (pass `Arc<AppCtx>` explicitly).
- Generic state-machine crate (4 states).
- CQRS / event sourcing (SQLite + timeline table is the 80%).
- MCP-style dynamic config registry (multi-tenant server pattern).
- Strategy pattern for `MissionStatus` rendering (it's an enum).

### Refactor sequence that pays for itself

1. **A + part of K** — extract `AgentRegistry`, move launch `match` into
   adapters. Unblocks adding Gemini / Aider / Ollama / Copilot.
2. **I** — introduce `AppEvent` + `EventBus`. Everything downstream
   (D, L, smart-collapse rail) plugs in.
3. **H** — split `AppStore` into per-aggregate repos. Keeps test surface
   small as schema grows.

Only after those three: multiplexing core (B + C + J), then features.

---

## 7. Schema & migrations

Additive only. v1 introduces three new tables/columns; nothing existing
breaks.

```sql
-- migration 002: pane tree persistence
ALTER TABLE terminal_sessions ADD COLUMN layout_json TEXT;

-- migration 003: prompt vault (extends Thought conceptually; new table for clarity)
CREATE TABLE IF NOT EXISTS prompt_templates (
    id            TEXT PRIMARY KEY,
    mission_id    TEXT REFERENCES missions(id) ON DELETE CASCADE,   -- NULL = global
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    template_vars TEXT NOT NULL DEFAULT '{}',                       -- JSON
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- migration 004: context bus entries (per-mission scratchpad history)
CREATE TABLE IF NOT EXISTS context_entries (
    id          TEXT PRIMARY KEY,
    mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    source      TEXT NOT NULL,            -- 'user' | 'agent:<id>' | 'paste' | 'voice'
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_context_mission ON context_entries(mission_id, created_at DESC);
```

Migrations run at `AppStore::open`, idempotent.

---

## 8. Module layout

```
src/
├── main.rs                          (unchanged entry)
├── app.rs                           (unchanged wrapper)
│
├── models.rs                        + PaneNode, PaneState, PromptTemplate, ContextEntry
├── config.rs                        new — AppConfig (subsystem K)
├── events.rs                        new — AppEvent enum + EventBus (subsystem I)
├── telemetry.rs                     new — TelemetrySink trait + NoopSink (subsystem L)
├── errors.rs                        new — typed errors per subsystem
│
├── agents/                          subsystem A
│   ├── mod.rs                       AgentRegistry + AgentAdapter trait
│   ├── claude.rs                    impl AgentAdapter
│   ├── codex.rs
│   ├── grok.rs
│   ├── copilot.rs
│   ├── gemini.rs
│   ├── aider.rs
│   ├── shell.rs
│   └── handoff.rs                   external IDE handoffs (Cursor/Zed/Windsurf/VSCode)
│
├── tmux.rs                          subsystem J — TmuxBackend trait + CliTmux + Supervisor
│
├── storage/                         subsystem H — split from storage.rs
│   ├── mod.rs                       SqliteConn, migrate()
│   ├── missions.rs                  MissionRepo
│   ├── thoughts.rs                  ThoughtRepo
│   ├── prompts.rs                   PromptVaultRepo
│   ├── context.rs                   ContextRepo
│   ├── pane_trees.rs                PaneTreeRepo (JSON blob round-trip)
│   └── timeline.rs                  TimelineRepo
│
├── commands/                        subsystem G
│   ├── mod.rs                       Command trait + CommandRegistry
│   ├── workspace.rs                 split / close / zoom / new-tab
│   ├── mission.rs                   switch / create / archive
│   ├── handoff.rs                   ⇉ Codex→Claude, broadcast, capture→note
│   ├── race.rs                      ⌘⇧R fan-out + verdict
│   ├── paste.rs                     PasteRouter + classifiers (subsystem E)
│   ├── memory.rs                    open editor, write dialects (subsystem F)
│   ├── voice.rs                     push-to-talk → whisper.cpp
│   └── context.rs                   focus context bus, append entry
│
├── flow/                            subsystem D — EIP message flow
│   ├── mod.rs                       PromptEnvelope, Channel, RecipientList
│   ├── scatter_gather.rs            ScatterGather + aggregators
│   └── verdict.rs                   verdict bar state machine
│
├── memory/                          subsystem F — project memory sync
│   ├── mod.rs                       ProjectMemory + MemorySync
│   ├── claude_md.rs                 MemoryDialect impls
│   ├── agents_md.rs
│   ├── cursorrules.rs
│   ├── windsurfrules.rs
│   └── copilot_instructions.rs
│
├── panes/                           subsystem B + C
│   ├── mod.rs                       PaneTree, PaneNode, PaneId
│   ├── state.rs                     PaneState enum + transitions
│   ├── vte_pane.rs                  (was terminal.rs) — VTE wiring
│   ├── picker.rs                    empty-tab agent picker widget
│   └── persistence.rs               PaneTree <-> JSON
│
└── ui/                              presentation only — never touches Sqlite directly
    ├── mod.rs                       shell orchestrator
    ├── theme.rs                     CSS load, token constants
    ├── shell.rs                     5-zone scaffolding
    ├── header.rs
    ├── status_bar.rs
    ├── missions_rail.rs
    ├── agents_rail.rs               smart-collapse state machine
    ├── workspace.rs                 tab strip + active PaneGroup render
    ├── dock.rs                      7-tab container, resize/collapse/pop
    └── palette.rs                   Raycast overlay
```

`integrations.rs` and `terminal.rs` are deleted by end of refactor.

### Layering rule

```
ui/  →  commands/  →  flow/, agents/, panes/, memory/, storage/, tmux.rs
                                   ↓
                              events.rs, telemetry.rs, errors.rs, config.rs, models.rs
```

`ui/` never imports `storage/`. UI reads via repos held in `AppCtx`,
listens on `EventBus`.

---

## 9. AppCtx

The shared context object threaded through commands and event handlers.
Constructor-injected; no DI container.

```rust
pub struct AppCtx {
    pub config:     Arc<AppConfig>,
    pub events:     Arc<EventBus>,
    pub telemetry:  Arc<dyn TelemetrySink>,
    pub agents:     Arc<AgentRegistry>,
    pub tmux:       Arc<TmuxSupervisor>,
    pub missions:   Arc<dyn MissionRepo>,
    pub prompts:    Arc<dyn PromptVaultRepo>,
    pub context:    Arc<dyn ContextRepo>,
    pub thoughts:   Arc<dyn ThoughtRepo>,
    pub pane_trees: Arc<dyn PaneTreeRepo>,
    pub timeline:   Arc<dyn TimelineRepo>,
    pub memory:     Arc<MemorySync>,
}
```

Tests build an `AppCtx` from in-memory fakes; prod assembles in `app::run`.

---

## 10. Open decisions

- **Window chrome** — defaulting to client-side decorations (modern adw).
  Flag if server-side is preferred on the target distro.
- **Prompt vault vs Thought schema** — currently planned as a separate
  table (`prompt_templates`). If we want full unification later, migrate
  Thoughts to a `kind='prompt'` variant; not in v1.
- **Whisper.cpp model** — `ggml-base.en` (74MB) is a sensible default;
  user can swap via config. First-run prompts to download if missing.

---

## 11. Out-of-scope confirmations (v1)

- No editor surface.
- No light theme in v1.
- No cost telemetry in v1 (TelemetrySink seam exists, NoopSink wired).
- No cloud / pair / replay / approval-queue in v1.
- No cross-platform builds. Linux-only.

---

## 12. v2 surfaces

The v2 cycle aligned the running cockpit with the
[ChatGPT-generated design mockup](../docs/mockup-v2.png) (see filenames
below for paths inside the repo). Each surface here is implemented as of
master — see the V2.1–V2.6 commit range.

### 12.1 Per-pane title bar

Every Live VTE pane is wrapped in a vertical `gtk::Box` whose first child
is an 18px title bar. Bar shows `<agent label>` (tinted in the agent's
hue) on the left and `active` / `idle` state on the right. State flips
on the existing VTE `contents-changed` signal handler (also driving the
status-bar activity clock), decaying back to `idle` after 2s of no output.

Renderer: `vte_pane::render_live_with_title(agent_id, title, &term) -> LivePaneWidgets`.

### 12.2 Mission row count metadata

Mission rail rows show `branch · N agents · M notes · age` on line 2
(when the counts are non-zero). Source: `ctx.sessions.list(mission.id).len()`
and `ctx.thoughts.list(mission.id).len()`, refreshed on the rail's 2s poll.

### 12.3 Dock tab badge counts

Dock tab labels carry a numeric badge when the active mission has data
for that tab (`Thoughts 4`, `Prompts 2`, `Timeline 12`). Zero collapses
to the plain name. Computed at dock build time per active-mission.

### 12.4 Thoughts row inline actions

Each thoughts row appends three glyph buttons after the age column:
`⇉C` (handoff to Claude), `⇉X` (handoff to Codex), `✓` (mark done via
`thoughts.mark_done`). `⇉C` and `⇉X` open the handoff dialog (§12.8)
pre-filled with the thought body.

### 12.5 Status bar middle git zone

Status bar now has three zones: env-health chips (left), git zone
(middle), per-agent activity dots + voice indicator (right). The git
zone renders `⎇branch ●dirty ↑a↓b` for the active mission, sourced
from `IntegrationHub::git_snapshot` on the existing 10s availability
timer.

### 12.6 Empty workspace state

When the active mission has zero tabs (or no mission is selected),
the workspace shows a centered card: `>_` glyph + heading
(`No mission selected` / `No agents yet`) + `+ New Mission` CTA. The
CTA opens the same mission-dialog used by the rail's `+ Mission` button.

### 12.7 Settings dialog

`src/cockpit/settings_dialog.rs::open(ctx, parent)` opens a 620×560 modal
with an `adw::ViewSwitcher` over three `adw::PreferencesPage`s:

- **Paths** — platform_repo, worktree_root, state_dir entries.
- **Voice** — whisper binary path, model path, language code.
- **Features** — switch row per `FeatureFlags` field.

Save action builds a fresh `AppConfig` from the dialog values, persists
via `AppConfig::save()` (TOML to `~/.config/bdterm/config.toml`). The
running app is NOT hot-reloaded; the user restarts to apply. The header
⚙ chip is the production entry point; palette also surfaces the same.

### 12.8 Handoff dialog

`src/cockpit/handoff_dialog.rs::open(ctx, source, target, parent)` opens
a 560×440 modal with header `Handoff: <source> → <target>` (labels tinted
in agent hues). Payload checkboxes:

- **Last output (N lines)** — captures the source agent's tmux session
  via `tmux capture-pane -p -t <session> -S -200`.
- **Diff (N files)** — runs `git -C <worktree> diff`; counts files via
  `diff --git` line scan; attaches full diff if checked.
- **Context (N chars)** — reads the per-mission context.md.
- **Thoughts (N items)** — undone thoughts joined.

A scrollable preview pane regenerates on every checkbox toggle. Send
ensures the target tmux session, then `tmux send-keys -l <text>` +
`Enter` feeds the preview literally. A `TimelineEvent` is logged on
success.

Trigger paths: agents-rail HANDOFF verbs (`⇉ Codex→Claude`,
`⇉ Claude→Codex`, `⇉ broadcast`), thoughts row `⇉C` / `⇉X` glyphs.

### 12.9 Activity Timeline expansion

Dock Timeline tab now has a top toolbar with an `adw::DropDown` filter
(`All agents | claude | codex | grok | live only`); body rows show a
6px agent-hued dot + label + detail + age. "Live only" filters to events
within the last 10 min. Agent inference uses a simple substring match
on the event's label/detail text.

### 12.10 Command Palette categorization

Palette result list groups by category with non-selectable section
headers in fixed order: `MISSIONS · COMMANDS · AGENTS · EXTERNAL`.
Category derived from command id prefix (`launch.*` → AGENTS,
`external.*` → EXTERNAL, `mission.switch.*` → MISSIONS, otherwise
COMMANDS). Within a category: recent-first when query is empty,
alphabetical when query is non-empty. Selection skips headers; ↑/↓
only walks command rows.

### 12.11 Rail row click handlers

- Agent rows in the rail click-launch via `WorkspaceController::launch_agent`.
- HANDOFF rows open the handoff dialog with the appropriate source/target.
- EXTERNAL rows spawn the editor binary (cursor / zed / windsurf / code) on
  the active mission's worktree.
- Header ⌘K chip toggles palette visibility; ⚙ chip opens the settings dialog.

### 12.12 Recursive multi-level pane splits

`⌘\` (Horizontal split — new pane right) and `⌘-` (Vertical split — new
pane below) operate on the currently-focused VTE leaf, walked up to its
pane wrapper, and replace it with a new `gtk::Paned` containing the old
wrapper + a fresh VTE. Nests arbitrarily.

Focus tracking via `gtk::EventControllerFocus` on every VTE updates the
tab's `Rc<RefCell<Option<vte::Terminal>>>`. Restoring a tab's nested
split topology from `PaneTreeRepo` is deferred to v2.6.

**As-built note (see DESIGN-REVIEW.md + ADR 0001)**: The `PaneTree` model, `LayoutSnapshot`, serde, and `SqlitePaneTreeRepo` (layout_json column + roundtrips) are fully implemented and tested. Runtime splits (arbitrary nesting via per-tab `body` Paned replacement + focus tracking) exist in `cockpit/workspace.rs`. However, the model is not yet wired: mutations do not update/persist a `PaneTree`, and restore remains flat (one tab per persisted `TerminalSession`, ignoring snapshots). This is the primary remaining structural gap for the documented Composite.

### 12.13 Round agent dots

Agents-rail rows, status-bar agent chips, and timeline rows all render
their per-agent dots as `gtk::DrawingArea` widgets (cairo arc fill) via
`crate::cockpit::widgets::agent_dot(agent_id, size)` — true circles at
every size. The bullet glyph fallback (`"●"`) is gone.

---

## 13. v2 commands

The cockpit-side `CockpitRegistry` (see `src/commands/cockpit.rs`) now
exposes:

| Id | Action |
|---|---|
| `workspace.new_tab` | Open new tab + agent picker |
| `workspace.close_tab` | Close active tab |
| `launch.<agent_id>` | Per-agent launch (registered per detected adapter) |
| `external.<editor>` | Spawn cursor / zed / windsurf / code on the active worktree |
| `handoff.codex_to_claude` *(planned)* | Open handoff dialog pre-filled |
| `handoff.claude_to_codex` *(planned)* | Open handoff dialog pre-filled |
| `handoff.broadcast` *(planned)* | Send to every live agent |
| `mission.switch.<id>` *(planned, v2.6)* | Direct mission jump in palette |

Commands stay reachable through both the ⌘K palette and the agents rail
rows.

---

## 14. Telemetry seam

`AgentAdapter::parse_telemetry(&self, recent_stdout: &str) -> Option<AgentTelemetry>`
is an optional method on the trait (default `None`). Implementing
adapters extract `tokens_per_sec` and `context_used_pct` from their CLI's
status footer.

Producer side: each Live pane's VTE `contents-changed` handler reads the
last ~4KB of buffer text and passes it to the adapter's parser; non-None
results push into `crate::cockpit::telemetry_store::update(agent_id, t)`.

Consumer side: the agents-rail row decay timer reads
`telemetry_store::get(agent_id)` once per second and renders the chip's
state label as `<tps> t/s · <ctx>%` when fresh, falling back to `ready`
or `off` based on availability.

The parsers are best-effort heuristics — the underlying CLIs do not
expose stable telemetry contracts. Tests verify only that synthetic
fixture strings parse to the expected struct. Real-world tuning is a
follow-up cycle.

---

## 15. v2.1+ deferred

- Multi-level pane splits **persisted** across app restarts (the
  `PaneTreeRepo` + `LayoutSnapshot` machinery exists; the workspace just
  needs to call it on every mutation and walk it at startup).
- Cost telemetry chips in the status bar (TelemetrySink seam exists).
- Team missions / cloud sync / shared memory.
- Approval queue for agent tool-call requests.
- Real-time diff review surface (separate dock tab).
- Light theme.
- Cross-platform builds (Linux-only today).
- `mission.switch.<id>` commands registered per mission (palette
  categorization already reserves the `MISSIONS` section).
