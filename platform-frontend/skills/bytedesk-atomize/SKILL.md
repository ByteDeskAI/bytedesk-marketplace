---
name: bytedesk-atomize
description: ByteDesk UI componentization skill using atomic design. Invoke this skill whenever the user wants to extract inline JSX into atoms/molecules/organisms, refactor large page files into smaller components, componentize any area of the ByteDesk frontend, apply atomic design principles to the application, extract repeated patterns into shared components, or clean up a page that's grown too large. Also invoke for "componentize this", "extract this into a component", "break this page into atoms", "apply atomic design to X", "componentize the UI", "run atomize on sales", or any phrasing around structuring the frontend by atomic design layers. Run this over and over until the entire UI is componentized. Use agents to attack different domains in parallel. When in doubt, invoke this rather than doing componentization work directly — it enforces the right placement rules and design system constraints.
user-invokable: true
argument-hint: "[domain] [section] | --path <file-or-dir>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

## Mission

Systematically extract inline JSX from pages and large components into the correct atomic design layer. Run this repeatedly across different UI domains until the entire frontend is componentized. Each run uses parallel agents to maximize throughput.

## Atomic Design Hierarchy (ByteDesk)

| Layer | Directory | Rule |
|---|---|---|
| **Atoms** | `src/components/ui/` | Zero business logic. Pure styling + behavior props. ~40 exist — extend, don't duplicate. |
| **Molecules** | `src/components/shared/` | 2–3 atoms combined. Domain-agnostic. (PageHeader, StatusBadge, EmptyState, etc.) |
| **Organisms** | `src/components/{sales,tools,ai,development,observability,deployments,email,customers}/` | Domain feature owning data/state. Uses molecules + atoms. |
| **Templates** | `src/components/templates/` | ListPage, DetailPage — page-level layout shells. |
| **Pages** | `src/app/(app)/*/page.tsx` | Route entries. Should compose templates + organisms. Thin — <80 lines ideally. |

**Decision rule:** If a JSX block is domain-agnostic → molecule or atom. If it fetches data or owns state → organism. If it's pure layout → template. When uncertain, err toward molecule (easier to move down than up).

## Existence-First Principle

Before creating anything new, check whether it already exists. The goal is convergence — fewer, richer components — not a proliferation of near-duplicates. Follow this order for every candidate extraction:

1. **Scan existing atoms** in `components/ui/` — does any atom already cover this pattern? If yes, replace the inline JSX with the atom. Done.
2. **Scan existing molecules** in `components/shared/` — is there a molecule that matches the structure? If yes, use it (or extend its props if a small gap exists).
3. **Scan existing organisms** in `components/{domain}/` — is there a domain component that already does this? Could it be made slightly more generic to cover this case?
4. **Only then** create something new.

Replacing inline JSX with an existing component is always better than creating a new one — it reduces the total surface area of the system and reinforces reuse.

## Variation Management

Many UI patterns are the same base component wearing different clothes. Recognize this before creating files:

- **Visual variants** (color, size, style) → add a `variant` or `accent` prop to the existing component. Don't create `GreenBadge` and `RedBadge` — extend `Badge` with `variant="green"`.
- **Slot variations** (different icons, labels, actions) → make the base component accept flexible props (`icon`, `action`, `children`). One `ActionCard` beats three near-identical cards.
- **State variations** (empty, loading, error versions of the same layout) → a single component with conditional rendering based on a `state` prop, not separate components.
- **Domain variations** (sales version vs. tools version of the same pattern) → a shared molecule with domain-specific data passed as props.

**Test for variation:** If you find yourself writing two components that share >70% of their structure, they're almost certainly one component with a variant. Merge them. Name the base after the structure, not the color or domain.

When extending an existing atom/molecule with a new variant, update its TypeScript union type and add the variant to the `/dev/components` catalog entry.

## Maximum Parameterization

This goes further than variation management. The goal is: **every component should be expressed at the highest degree of abstraction that still makes sense, and every concrete use should be an instantiation of that abstract form — not a separate component.**

There is no level of abstract-ness that is too much. Even if a component currently appears only once, design it as if it will be called with completely different props tomorrow. This discipline produces components that are genuinely reusable rather than accidentally similar.

### Abstract-first design process

When you encounter any JSX block worth extracting:

1. **Strip it to its skeleton.** Remove all domain-specific data, labels, and colors. What shape is left? That shape is the abstract component.
2. **Parameterize every dimension of variation.** Content → `children` or named slots (`header`, `footer`, `actions`). Data → generics (`<T>`). Appearance → `variant`/`accent`/`size` props. Behavior → callback props (`onAction`, `renderRow`). Config → typed config objects (`columns: ColumnDef[]`, `tabs: TabDef[]`).
3. **Create the abstract base first.** Write the maximally parameterized form.
4. **Express the concrete use as instantiation.** The domain-specific component is just the abstract base called with specific props — often not a new file at all, just usage at the call site.

### Patterns to apply

| Instead of... | Do this |
|---|---|
| `SalesPipelineCard`, `DevelopmentStatusCard` | `ResourceCard<T> { icon, title, subtitle, status, actions, accent }` |
| `ProjectListPage`, `ContactListPage` | `ResourceList<T> { columns, filters, data, renderRow, emptyState }` |
| `NewProjectDrawer`, `NewContactDrawer` | `FormDrawer { title, fields, onSubmit, schema }` |
| `ProjectDetailPage` with hardcoded tabs | `DetailPage<T> { entity, tabs: TabDef[], header }` |
| `UptimeMetricCard`, `ErrorRateCard` | `MetricCard { label, value, trend, accent }` — already exists, just use it |
| Status icon that's always green/red | `StatusDot { ok, label, size }` — parameterize ok vs not-ok, don't hardcode color |

### TypeScript generics as the forcing function

When a component displays data, it should accept `T extends SomeMinimalInterface` rather than a domain type. This forces you to name the minimal contract the component actually needs, which reveals how abstract it truly can be.

```tsx
// Too concrete — only works for one domain
function ProjectCard({ project }: { project: Project }) { ... }

// Maximally parameterized — works for any resource with these fields  
function ResourceCard<T extends { id: string; name: string; status: string }>({
  item, icon, accent, actions, renderDetail
}: ResourceCardProps<T>) { ... }

// Concrete use — just instantiation, possibly not a new file
<ResourceCard item={project} icon={<CodeIcon />} accent="blue" actions={projectActions} />
```

### Flag over-specification

When reviewing existing components, flag any that are more specific than they need to be. A component named after a domain (`SalesMetricGrid`) when the structure is identical to a domain-agnostic pattern (`MetricGrid`) is a candidate for collapse. Report these in your summary as "over-specified candidates" so they can be refactored.

## Concrete Facades Rule

**Abstract components are never rendered directly in pages or organisms.** They are infrastructure. Every use in a page or organism must go through a named concrete component — a thin facade that locks in the presentation decisions.

The concrete facade's only job is to translate a semantic intent (`RunningBadge`, `DestructiveButton`, `ErrorCallout`) into a specific abstract instantiation (`<Badge variant="green" dot live>`, `<Button variant="danger">`, `<Callout variant="error">`). After that, only content varies.

### What belongs at each level

**Abstract (atoms/base components):** Accept every possible visual variant as a prop. Color, size, icon, accent, border style — all parameterized. Never hardcode presentation.

**Concrete facades (named wrappers):** Fix all presentation props. Export a semantic name. Expose only:
- Text content (`label`, `title`, `description`, `children`)
- Data values (`value`, `count`, `items`)
- Callbacks (`onClick`, `onAction`, `onChange`)
- Composable slots where the caller supplies child content

**Pages and organisms:** See only concrete facades. Never set `variant=`, `accent=`, `size=`, icon choices, or color values directly.

### Creating concrete facades

When a needed concrete wrapper doesn't exist, create it — even as three lines:

```tsx
// components/shared/running-badge.tsx
export function RunningBadge({ label = "Running" }: { label?: string }) {
  return <Badge variant="green" dot live>{label}</Badge>;
}

// components/shared/danger-button.tsx
export function DangerButton({ children, onClick }: ButtonBaseProps) {
  return <Button variant="danger" onClick={onClick}>{children}</Button>;
}

// components/shared/error-callout.tsx
export function ErrorCallout({ message }: { message: string }) {
  return <Callout variant="error">{message}</Callout>;
}
```

The name encodes the semantic intent; the abstract base handles the visual rendering; the page just says what it means.

### The test

Scan any page file. If you see `variant=`, `accent=`, an icon component, a raw hex color, or a size literal being set — that belongs in a concrete facade, not at the page level. Extract it.

If you see `<Button variant="primary">Create Project</Button>` in a page, extract to `<CreateProjectButton>` in the domain organisms directory. The only thing left in the page is `<CreateProjectButton onClick={handleCreate} />`.

## Step 1 — Survey (always first)

Before dispatching agents, scan for targets and build a picture of what already exists. Run these in parallel:

```bash
# Pages exceeding 150 lines (prime extraction candidates)
wc -l src/ByteDesk.Web/src/app/\(app\)/*/page.tsx | sort -rn | head -20

# Nested components (co-located in page files — should be extracted)
grep -rn "^function \|^const .* = (" src/ByteDesk.Web/src/app/\(app\)/**/page.tsx 2>/dev/null | head -30

# Token violations in page files (hardcoded colors, inline styles)
grep -rn 'style={{' src/ByteDesk.Web/src/app/\(app\) --include="*.tsx" | grep -v "// legit" | wc -l

# Existing atoms — full inventory
ls src/ByteDesk.Web/src/components/ui/

# Existing molecules — full inventory
ls src/ByteDesk.Web/src/components/shared/

# Existing organisms by domain
find src/ByteDesk.Web/src/components -name "*.tsx" -not -path "*/ui/*" -not -path "*/shared/*" -not -path "*/templates/*" | sort

# Structural near-duplicates across domains (same pattern appearing in 2+ places)
grep -rn "className.*rounded.*border\|className.*flex.*items-center.*gap" \
  src/ByteDesk.Web/src/app/\(app\) --include="*.tsx" -l
```

Pass the component inventory to each agent so they know what already exists before they touch anything.

Categorize each target:
- **Priority 1 — Extract now**: page files >300 lines, inline function components, repeated JSX blocks >30 lines
- **Priority 2 — Clean up**: pages 150–300 lines, minor inline patterns
- **Priority 3 — Polish**: pages <150 lines with token violations

## Step 2 — Domain Assignment

Divide work across agents by domain section. Typical split for a full run:

| Agent | Domain | Page routes | Organisms target dir |
|---|---|---|---|
| Agent A | Sales | `(app)/sales/**` | `components/sales/` |
| Agent B | Development | `(app)/development/**` | `components/development/` |
| Agent C | Observability | `(app)/observability/**` | `components/observability/` (create if needed) |
| Agent D | AI / Deployments | `(app)/ai/**`, `(app)/deployments/**` | `components/ai/`, `components/deployments/` |
| Agent E | Email / Customers | `(app)/email/**`, `(app)/customers/**` | `components/email/`, `components/customers/` |

Adjust based on what the survey found. Spawn all agents in one message so they run in parallel.

## Step 3 — Agent Briefing Template

Each agent receives a prompt following this template (fill in the domain-specific parts):

```
You are refactoring the ByteDesk frontend to apply atomic design principles.
Your domain: {DOMAIN_NAME}

Files to process:
- {LIST_OF_PAGE_FILES}
- {LIST_OF_EXISTING_COMPONENT_FILES_IN_DOMAIN}

Component inventory (from the survey — read these files before doing anything else):
- Atoms: {LIST_OF_EXISTING_ATOMS}
- Molecules: {LIST_OF_EXISTING_MOLECULES}
- All existing organisms across ALL domains: {LIST_OF_ALL_ORGANISMS}

Important: you read globally, you write locally. Check every organism in every domain before creating
anything new — a pattern that already exists in a different domain should be moved to components/shared/
or imported directly, not duplicated. You only create new files inside your domain dir or components/shared/.

Your job:
1. Read every file listed under "Files to process" above.
2. Read the component inventory files so you have a clear picture of what already exists.
3. Identify inline JSX that should be extracted:
   - Function components defined inside a page file → extract to organisms dir
   - JSX blocks >30 lines that repeat or could be reused → extract to molecules or organisms
   - Hardcoded style patterns that should use atoms (<Card>, <Button>, <Callout>, etc.)
4. For each candidate extraction, check existence first (in this order):
   a. Does an atom already cover this pattern? → replace with the atom, no new file needed
   b. Does an existing molecule match the structure? → replace with it (or extend its props for a small gap)
   c. Does an existing organism in ANY domain already do this? → reuse it (move to shared/ if needed, or import cross-domain)
   d. Only if none of the above: create a new molecule or organism
5. Before creating anything new, check for variation patterns:
   - Are multiple similar JSX blocks just the same base structure with different colors, sizes, or icons?
     → That's one component with a `variant` or `accent` prop, not several components
   - Do two things differ only in the data passed to them, not in their structure?
     → That's one generic component with flexible props
   - Does your new component share >70% structure with an existing one?
     → Extend the existing component with a new variant instead of creating a parallel file
5b. Apply maximum parameterization to every component you create or review:
   - Strip the JSX to its structural skeleton, then parameterize every dimension of variation
   - Content variation → `children`, `header`, `footer`, `actions` slots (ReactNode props)
   - Data variation → TypeScript generics (`<T extends MinimalInterface>`)
   - Appearance variation → `variant`, `accent`, `size` union props
   - Behavior variation → callback props (`onAction`, `renderRow`)
   - Configuration variation → typed config objects (`columns: ColumnDef[]`, `tabs: TabDef[]`)
   - Build the maximally abstract form first. Then express the concrete domain use as instantiation at the call site — ideally not a new file at all.
   - Also flag existing domain-specific components that are more specific than they need to be ("over-specified") — e.g., a `SalesMetricGrid` that is structurally identical to `MetricGrid`.
6. Apply the concrete facades rule to every page and organism you touch:
   - Scan for any `variant=`, `accent=`, `size=`, icon component, or color value set directly in a page/organism
   - Each one belongs in a named concrete facade, not at the page level
   - Check if the needed facade already exists (globally — atoms, shared, all domains)
   - If not, create it as a thin wrapper in the appropriate directory
   - The page/organism should only pass text, data, and callbacks to the facade
7. For each actual new file created:
   - Determine the right layer (see layer rules below)
   - Place in the correct directory
   - Update the page/component to import and use it
   - Verify TypeScript types are correct, including union types for any new variants
8. Do NOT touch files outside your domain unless creating a shared molecule/facade in components/shared/.
9. Do NOT create new atoms in components/ui/ — flag them instead.
10. After all extractions, verify: can each extracted component be used in isolation? Does any page still have raw presentation props set inline?

LAYER RULES:
- Zero state + zero API calls + composable props → molecule (components/shared/)
- Has useQuery/useMutation or domain-specific state → organism (components/{domain}/)
- Reuses across 2+ domains → molecule (components/shared/)

DESIGN SYSTEM CONSTRAINTS (non-negotiable):
- No hardcoded hex/rgb/oklch — use var(--color-*) only
- No font names other than IBM Plex Sans / IBM Plex Mono
- No inline style={{}} for standard patterns — use atoms: <Card>, <Button variant="...">, <Callout variant="...">
- Import formatters from @/lib/utils/format — never redefine inline
- Use cn() from @/lib/utils/cn for conditional classes
- Skeletons via <Skeleton> or <SkeletonCard> or .mc-skeleton
- All interactive elements: blue (--color-accent-blue); brand CTAs: orange (--color-accent-orange)
- Labels: <Label> or .mc-label — not manual mono+bold+uppercase

EXISTING ATOMS (use these, don't recreate):
Card, Button (primary/secondary/ghost/danger/brand), Callout (error/info/warning/success),
Input, Textarea, FormField, FilterBar, Dropdown, DataTable, Tabs/TabList/Tab/TabPanel,
Dialog, ErrorBanner, AsyncContent, Skeleton/SkeletonCard, Badge (default/blue/green/amber/red/purple/cyan/orange),
Avatar, Tooltip, Toast, Label, StatusDot, Divider, Stack, Row, MetricGrid, MetricCard,
SectionHeader, ProgressBar, Spinner, Breadcrumb, Collapsible, Toggle, Kbd, TimeAgo, CopyButton

EXISTING MOLECULES (use these, don't recreate):
PageHeader, StatusBadge, EmptyState, Sidebar, Topbar, CommandBar

Report back:
- **Replacements with existing components** — inline JSX swapped for an existing atom/molecule/organism (most valuable — leads to zero new files)
- **Variations merged** — two or more similar patterns collapsed into one component with a new `variant` prop
- **New molecules created** — path + what it is + why nothing existing covered it
- **New organisms created** — path + what it is + domain it belongs to
- **Atoms extended** — existing atom in `components/ui/` where you added a new variant (e.g., `Badge` now has `variant="teal"`)
- **Concrete facades created** — thin wrappers that fixed presentation props (variant/accent/icon/size) so pages see only semantic names; list path + what it wraps + what it fixes
- **Abstract-first wins** — cases where a new component was designed maximally abstract and the concrete use became just instantiation (no extra file)
- **Over-specified candidates** — existing components that are more domain-specific than their structure requires; proposed refactor to a generic base
- **Flagged for discussion** — new atom candidates, ambiguous layer decisions, things skipped with reason
- **Line count before/after** for each page file touched
```

## Step 4 — Collect and Synthesize

After all agents complete:

1. **Read each agent's report** and verify the extractions make sense
2. **Check for conflicts** — two agents creating the same molecule with different names
3. **Check build** — `npx next build` from `src/ByteDesk.Web/` (do not start dev server)
4. **Update the `/dev/components` catalog** if any new atoms were created
5. **Produce a run summary**:

```
## Atomize Run — {DATE}

### What changed
| Domain | Pages touched | Components extracted | Lines removed from pages |
|---|---|---|---|
| Sales | 5 | 8 organisms, 2 molecules | ~420 |
| Development | 3 | 5 organisms | ~280 |
| ... | ... | ... | ... |

### New files created
- `components/sales/pipeline-stage-card.tsx` — organism
- `components/shared/metric-comparison-row.tsx` — molecule
- ...

### Flagged for follow-up
- `(app)/scheduler/page.tsx` still 1200+ lines — needs its own dedicated run
- New atom candidate: `<TimelineMarker>` — appears in 3 domains; nominate for ui/

### Remaining high-priority targets
- scheduler (1574 lines)
- settings (595 lines)
- ...
```

## Running Modes

Parameters define the **work boundary** — the files an agent is allowed to process and modify. The component inventory (atoms, molecules, all organisms across all domains) always remains global regardless of how narrow the boundary is. More parameters = narrower boundary = more focused agent.

### Global mode — no arguments
`/bytedesk-atomize`

Survey the entire application, spawn parallel agents for every domain, work the highest-priority targets across all of `src/app/(app)/`. Right for a fresh run or when you don't know where the biggest problems are.

### Domain mode — one argument
`/bytedesk-atomize {domain}`

Examples: `/bytedesk-atomize sales`, `/bytedesk-atomize observability`

Boundary: `src/app/(app)/{domain}/` and `src/components/{domain}/`

Spawns a single agent focused on that domain. Use when a previous global run flagged one domain as the remaining priority, or when you want a fast mid-sprint cleanup without touching everything.

### Sub-section mode — two arguments
`/bytedesk-atomize {domain} {section}`

Examples: `/bytedesk-atomize sales contacts`, `/bytedesk-atomize development settings`

Boundary: `src/app/(app)/{domain}/{section}/` and any matching component sub-directory

Scopes work to a specific route section within a domain. Useful for deep-diving a known trouble spot — a single high-line-count page area — without touching the rest of the domain.

### Deep mode — three or more arguments
`/bytedesk-atomize {domain} {section} {subsection} ...`

Examples: `/bytedesk-atomize sales contacts [id] opportunities`, `/bytedesk-atomize development [id] logs`

Boundary: the intersected path formed by chaining all parameters as directory segments under `src/app/(app)/`

Each additional argument drills one level deeper into the route hierarchy. Use this for surgical work on a single page or tightly bounded cluster of files — the agent processes only what's inside that specific path.

### Path mode — `--path` flag

`/bytedesk-atomize --path <file-or-directory>`

Examples:
- `/bytedesk-atomize --path src/ByteDesk.Web/src/app/(app)/sales/tasks/page.tsx`
- `/bytedesk-atomize --path src/ByteDesk.Web/src/app/(app)/sales/contacts`
- `/bytedesk-atomize --path src/ByteDesk.Web/src/components/sales/pipelines`

Boundary: exactly the specified file, or all `.tsx` files under the specified directory (recursive).

Use this when you have a specific file path in hand — e.g., after a design review flags a particular page, after a merge conflict resolves to a large file, or when you want to atomize a component subdirectory directly without navigating the route hierarchy. The path can be absolute or relative to the repo root.

Infer the domain for output placement from the path (e.g., a path under `app/(app)/sales/` or `components/sales/` → domain is `sales`, new organisms go to `components/sales/`). If the domain cannot be inferred, default to `components/shared/` for new molecules and ask before creating organisms.

The component inventory (all atoms, molecules, organisms across all domains) remains global regardless of the path boundary.

### Parameter resolution

Parameters map directly to directory path segments. Given `/bytedesk-atomize p1 p2 p3`:

- **Survey scope**: `src/app/(app)/{p1}/{p2}/{p3}/` (line counts, inline component detection)
- **Files to process**: pages and components under that path only
- **Component inventory**: always global — all atoms, all molecules, all organisms from every domain
- **Write scope**: new files go into `src/components/{p1}/` (domain-level) or `src/components/shared/` — never into a deeper component sub-dir unless one already exists

If a path segment contains special characters (like `[id]`), include them literally — the agent uses glob patterns to match dynamic route segments.

The agent briefing template is identical across all modes. The only thing that changes is the "Files to process" list.

## What NOT to Do

- Do not start the dev server (`npm run dev`, `npm start`)
- Do not modify `globals.css` tokens — only consume them
- Do not add business logic to atoms or molecules
- Do not create new atoms in `components/ui/` — flag them instead and discuss
- Do not refactor files that are already well-componentized just to meet a line limit
- Do not batch all changes into one massive commit — smaller, domain-scoped commits

## Iteration Cadence

Run this skill multiple times. Each run should:
1. Start from the survey to find current highest-value targets
2. Focus agents on what remains unfinished
3. Stop when a domain is clean (pages <100 lines composing organisms)

A full application typically takes 4–8 runs to fully componentize. Track progress via the line count table in each run summary.